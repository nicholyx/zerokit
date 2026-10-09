# -*- coding: utf-8 -*-
"""白名单 HTTP/HTTPS 正向代理 + 命令行管理工具（单文件，无需其他依赖）

start_proxy.bat 只做两件事：找到 Python、把参数原样交给本文件。
所有功能都在这里：启动 / 停止 / 重启 / 状态 / 开机自启 / 改配置。

用法
    python proxy.py                    打开交互菜单（双击 bat 即可）
    python proxy.py run                前台运行（调试用，Ctrl+C 停止）
    python proxy.py start              后台启动
    python proxy.py stop               停止
    python proxy.py restart            重启
    python proxy.py status             查看状态（含开机自启状态）
    python proxy.py autostart on|off   开关开机自启
    python proxy.py config show        查看配置
    python proxy.py config domain add example.com
    python proxy.py config port add 8443
    python proxy.py config auth basic user pass
    python proxy.py config auth none
    python proxy.py help               查看全部命令

配置文件
    由 zerokit 拉起时放在插件数据目录（跨插件更新保留）；直接 python
    proxy.py 跑时与本文件同目录。首次运行自动生成。
    允许域名、允许端口、鉴权方式与密钥、监听地址端口、日志目录都在里面，
    不用改本文件。改完后「域名 / 端口 / 鉴权」在 2 秒内自动生效，
    「监听地址端口 / 日志目录」需要 restart。

日志（默认 <本文件目录>/logs，JSON 一行一条）
    proxy.log    运行日志：启动、异常、拦截告警
    allowed.log  能正常代理出去的：HTTP 转发成功 / CONNECT 隧道建立
    denied.log   被拒绝或失败的：域名拦截 / 端口拦截 / 未鉴权 / 上游故障
"""

import base64
import copy
import ctypes
import hmac
import json
import logging
import logging.handlers
import os
import re
import socket
import ssl
import subprocess
import sys
import threading
import time
from urllib.parse import urlparse

# ---------------------------------------------------------------------------
# 路径与常量
# ---------------------------------------------------------------------------
BASE_DIR = os.path.dirname(os.path.abspath(__file__))
SCRIPT_PATH = os.path.abspath(__file__)


def _resolve_config_path():
    """配置文件位置。

    优先级：PROXY_CONFIG（测试用）> ZEROKIT_PLUGIN_DATA_DIR（zerokit 注入的
    插件数据目录，跨更新保留）> 本文件目录（直接 python proxy.py 跑时）。

    老版本把配置放在插件目录里：发现新位置还没有、老位置有，就继续用老的
    （不搬家），避免升级 zerokit 后配置「消失」。
    """
    env = os.environ.get('PROXY_CONFIG')
    if env:
        return os.path.abspath(env)
    data_dir = os.environ.get('ZEROKIT_PLUGIN_DATA_DIR')
    if data_dir:
        fresh = os.path.join(data_dir, 'my_config.json')
        legacy = os.path.join(BASE_DIR, 'my_config.json')
        if not os.path.exists(fresh) and os.path.exists(legacy):
            return legacy
        return fresh
    return os.path.join(BASE_DIR, 'my_config.json')


CONFIG_PATH = _resolve_config_path()
# pid 文件跟配置文件放一起，互不干扰
PID_FILE = os.path.join(os.path.dirname(CONFIG_PATH), 'proxy.pid')

# 日志也跟着配置走：配置在数据目录时日志也在那里（跨更新保留）
DEFAULT_LOG_DIR = os.path.join(os.path.dirname(CONFIG_PATH), 'logs')
BUF = 65536
RUN_LOG_BACKUP_DAYS = 30        # proxy.log 保留天数
CONFIG_RELOAD_INTERVAL = 2.0    # 两次检查配置变动的最小间隔（秒）

# 开机自启：当前用户的 Run 键，不需要管理员权限
AUTOSTART_KEY = r'Software\Microsoft\Windows\CurrentVersion\Run'
AUTOSTART_NAME = 'JlcProxy'

# Windows 进程创建标志
DETACHED_PROCESS = 0x00000008
CREATE_NEW_PROCESS_GROUP = 0x00000200
CREATE_NO_WINDOW = 0x08000000

# 逐跳（hop-by-hop）头，转发时必须剥掉
HOP_BY_HOP = {
    'connection', 'keep-alive', 'proxy-authenticate', 'proxy-authorization',
    'proxy-connection', 'te', 'trailer', 'transfer-encoding', 'upgrade',
}

# 审计日志拆两份：reason 属于这个集合的算「正常代理」，其余算「拒绝访问」
ALLOWED_REASONS = {'allowed', 'tunnel'}

DEFAULT_CONFIG = {
    "listen_host": "127.0.0.1",
    "listen_port": 28888,
    # 允许访问的域名：写域名本身即包含其所有子域；
    # 需要正则时写 "re:^api\\.example\\.com$"
    # 默认只放行 example.com（RFC 2606 保留域）：这是模板值，装好后第一件事就是
    # 用 `zkit run proxy allow-domain --domain 你的域名` 换成自己要的。
    "allowed_domains": ["example.com"],
    # 允许访问的端口：写 "*" 表示不限制（不建议）
    "allowed_ports": [80, 443],
    "connect_timeout": 30,
    "read_timeout": None,          # null = 不限（支持 SSE / 长连接）
    "auth": {
        "method": "none",          # none | basic
        "username": "",
        "password": "",
        "realm": "zerokit-proxy",
    },
    "logs": {
        "dir": "",                 # 空 = 本文件目录下的 logs
        "backup_days": 90,
        "redact_headers": [
            "cookie", "set-cookie", "authorization", "proxy-authorization",
            "x-auth-token", "x-api-key",
        ],
    },
    "audit": {
        "record_headers": True,    # 是否把完整请求头写进审计日志（凭据字段已脱敏）
    },
}


# ---------------------------------------------------------------------------
# 配置
# ---------------------------------------------------------------------------
def _deep_merge(base, override):
    """把 override 合进 base 的副本，缺的键用默认值补齐。"""
    out = copy.deepcopy(base)
    if not isinstance(override, dict):
        return out
    for k, v in override.items():
        if isinstance(v, dict) and isinstance(out.get(k), dict):
            out[k] = _deep_merge(out[k], v)
        else:
            out[k] = copy.deepcopy(v)
    return out


def _coerce_ports(value):
    """端口列表 -> set；含 '*' 时返回 None 表示不限制。"""
    ports = set()
    if not isinstance(value, (list, tuple)):
        value = [value]
    for p in value:
        if isinstance(p, str) and p.strip() == '*':
            return None
        try:
            ports.add(int(str(p).strip()))
        except (TypeError, ValueError):
            continue
    return ports


class Config:
    """my_config.json 的读写与热加载。"""

    def __init__(self, path):
        self.path = path
        self._lock = threading.RLock()
        self._mtime = None
        self._last_check = 0.0
        self.data = {}
        self.load(force=True)

    # ---- 读写 ----
    def load(self, force=False, quiet=False):
        with self._lock:
            try:
                st = os.stat(self.path)
            except OSError:
                if not quiet:
                    print('配置文件不存在，已生成默认配置：%s' % self.path)
                self.data = copy.deepcopy(DEFAULT_CONFIG)
                self.save(quiet=True)
                return self.data

            if not force and st.st_mtime == self._mtime:
                return self.data
            try:
                with open(self.path, encoding='utf-8') as f:
                    raw = json.load(f)
            except Exception as e:
                # 配置写坏了不能把代理带下去，沿用上一次有效配置
                logging.error('读取配置失败：%s (%s)，继续沿用上一次的有效配置',
                              self.path, e)
                return self.data
            self.data = _deep_merge(DEFAULT_CONFIG, raw)
            self._mtime = st.st_mtime
            return self.data

    def save(self, quiet=False):
        with self._lock:
            tmp = self.path + '.tmp'
            with open(tmp, 'w', encoding='utf-8') as f:
                json.dump(self.data, f, ensure_ascii=False, indent=2)
                f.write('\n')
            os.replace(tmp, self.path)
            self._mtime = os.stat(self.path).st_mtime
            if not quiet:
                print('已写入 %s' % self.path)

    def maybe_reload(self):
        """请求路径上调用：最多每 2 秒检查一次文件有没有被改过。"""
        now = time.monotonic()
        if now - self._last_check < CONFIG_RELOAD_INTERVAL:
            return
        self._last_check = now
        with self._lock:
            try:
                mtime = os.stat(self.path).st_mtime
            except OSError:
                return
            if mtime == self._mtime:
                return
            old = self.data
            self.load(force=True, quiet=True)
            if self.data != old:
                logging.info('配置已重新加载：%s', self.path)

    # ---- 访问器 ----
    @property
    def listen_host(self):
        return str(self.data.get('listen_host') or '127.0.0.1')

    @property
    def listen_port(self):
        try:
            return int(self.data.get('listen_port'))
        except (TypeError, ValueError):
            return int(DEFAULT_CONFIG['listen_port'])

    @property
    def allowed_domains(self):
        v = self.data.get('allowed_domains')
        return list(v) if isinstance(v, (list, tuple)) else []

    @property
    def allowed_ports(self):
        """返回 set；None 表示不限制端口。"""
        return _coerce_ports(self.data.get('allowed_ports'))

    @property
    def connect_timeout(self):
        try:
            return float(self.data.get('connect_timeout'))
        except (TypeError, ValueError):
            return float(DEFAULT_CONFIG['connect_timeout'])

    @property
    def read_timeout(self):
        v = self.data.get('read_timeout')
        if v is None:
            return None
        try:
            return float(v)
        except (TypeError, ValueError):
            return None

    @property
    def auth_method(self):
        m = str((self.data.get('auth') or {}).get('method') or 'none').lower()
        return m if m in ('none', 'basic') else 'none'

    @property
    def auth(self):
        return self.data.get('auth') or {}

    @property
    def log_dir(self):
        d = str((self.data.get('logs') or {}).get('dir') or '').strip()
        return os.path.abspath(d) if d else DEFAULT_LOG_DIR

    @property
    def backup_days(self):
        try:
            return int((self.data.get('logs') or {}).get('backup_days'))
        except (TypeError, ValueError):
            return int(DEFAULT_CONFIG['logs']['backup_days'])

    @property
    def redact_headers(self):
        v = (self.data.get('logs') or {}).get('redact_headers')
        if not isinstance(v, (list, tuple)):
            return set()
        return {str(x).strip().lower() for x in v if str(x).strip()}

    @property
    def record_headers(self):
        return bool((self.data.get('audit') or {}).get('record_headers', True))


CFG = Config(CONFIG_PATH)


# ---------------------------------------------------------------------------
# 日志
# ---------------------------------------------------------------------------
LOG_FORMAT = '%(asctime)s %(levelname)s %(message)s'

# 这三个 logger 先建好但不挂 handler（handler 由 setup_logging 装），
# 这样 status / config 这类命令不会凭空生成日志文件。
run_logger = logging.getLogger('proxy.run')
audit_allowed_logger = logging.getLogger('proxy.allowed')
audit_denied_logger = logging.getLogger('proxy.denied')
for _lg in (run_logger, audit_allowed_logger, audit_denied_logger):
    _lg.propagate = False
    _lg.setLevel(logging.INFO)

ALLOWED_LOG = 'allowed.log'
DENIED_LOG = 'denied.log'
RUN_LOG = 'proxy.log'


def _rotating(log_dir, filename, backup_days):
    h = logging.handlers.TimedRotatingFileHandler(
        filename=os.path.join(log_dir, filename),
        when='midnight', interval=1, backupCount=backup_days, encoding='utf-8')
    h.suffix = '%Y-%m-%d'
    h.setFormatter(logging.Formatter('%(asctime)s %(message)s')
                   if filename != RUN_LOG else logging.Formatter(LOG_FORMAT))
    return h


def _stdout_is_console():
    try:
        return sys.stdout is not None and sys.stdout.isatty()
    except Exception:
        return False


def setup_logging(console=True):
    """按配置装好日志 handler；重复调用会先清空。"""
    log_dir = CFG.log_dir
    os.makedirs(log_dir, exist_ok=True)

    run_logger.handlers[:] = [_rotating(log_dir, RUN_LOG, RUN_LOG_BACKUP_DAYS)]
    if console and sys.stdout is not None:
        sh = logging.StreamHandler(sys.stdout)
        sh.setFormatter(logging.Formatter(LOG_FORMAT))
        run_logger.addHandler(sh)

    audit_allowed_logger.handlers[:] = [
        _rotating(log_dir, ALLOWED_LOG, CFG.backup_days)]
    audit_denied_logger.handlers[:] = [
        _rotating(log_dir, DENIED_LOG, CFG.backup_days)]
    return log_dir


# ---------------------------------------------------------------------------
# 访问控制
# ---------------------------------------------------------------------------
def allowed_host(host):
    cfg = CFG
    cfg.maybe_reload()
    if not host:
        return False
    h = host.lower().strip('[]').rstrip('.')
    for pat in cfg.allowed_domains:
        p = str(pat).strip().lower()
        if not p:
            continue
        if p.startswith('re:'):
            try:
                if re.search(p[3:], h, re.I):
                    return True
            except re.error:
                continue
        else:
            d = p.lstrip('*.')
            if h == d or h.endswith('.' + d):
                return True
    return False


def allowed_port(port):
    ports = CFG.allowed_ports
    if ports is None:
        return True
    return port in ports


def _decode_basic(headers):
    """从 Proxy-Authorization 里解出 (用户名, 密码)；不是合法 Basic 头则返回 None。"""
    raw = headers.get('Proxy-Authorization', '').strip()
    scheme, _, param = raw.partition(' ')
    if scheme.lower() != 'basic':
        return None
    try:
        decoded = base64.b64decode(param.strip(), validate=True).decode('utf-8', 'replace')
    except Exception:
        return None
    user, sep, password = decoded.partition(':')
    return (user, password) if sep else None


def _check_auth(headers):
    """标准 HTTP Basic 代理鉴权（RFC 7617 / 7235）。"""
    cfg = CFG
    cfg.maybe_reload()
    if cfg.auth_method != 'basic':
        return True
    want_user = str(cfg.auth.get('username') or '')
    want_pass = str(cfg.auth.get('password') or '')
    if not want_pass:
        return True                       # 没设密码 = 没真正启用
    creds = _decode_basic(headers)
    if creds is None:
        return False
    user, password = creds
    # 两个都比较，避免用长度差异做用户名枚举
    return (hmac.compare_digest(user.encode(), want_user.encode())
            & hmac.compare_digest(password.encode(), want_pass.encode()))


def _attempted_user(headers):
    """鉴权失败时把客户端送来的用户名记下来，便于排查客户端配置填错。"""
    creds = _decode_basic(headers)
    return creds[0] if creds else '-'


def _redact(headers):
    secret = CFG.redact_headers
    out = {}
    for k, v in headers.items():
        out[k] = ('<redacted:%d>' % len(v)) if k.lower() in secret else v
    return out


def audit(client_ip, client_port, method, target, headers,
          status=None, reason=None, host=None, port=None,
          elapsed=None, body_bytes=None, error=None, extra=None):
    record = {
        'src_ip':            client_ip,
        'src_port':          client_port,
        'method':            method,
        'target':            target,
        'dst_host':          host,      # 实际连往的目标，与 Host 头区分开
        'dst_port':          port,
        'user_agent':        headers.get('User-Agent', '-'),
        'host':              headers.get('Host', '-'),
        'referer':           headers.get('Referer', '-'),
        # 反向代理链路中真实客户端 IP
        'x_forwarded_for':   headers.get('X-Forwarded-For', '-'),
        'x_real_ip':         headers.get('X-Real-IP', '-'),
        'x_original_for':    headers.get('X-Original-Forwarded-For', '-'),
        'cf_connecting_ip':  headers.get('CF-Connecting-IP', '-'),
        'true_client_ip':    headers.get('True-Client-IP', '-'),
        'x_client_ip':       headers.get('X-Client-IP', '-'),
        'x_forwarded_proto': headers.get('X-Forwarded-Proto', '-'),
        'x_forwarded_port':  headers.get('X-Forwarded-Port', '-'),
        'x_forwarded_host':  headers.get('X-Forwarded-Host', '-'),
        'origin':            headers.get('Origin', '-'),
        'x_request_id':      headers.get('X-Request-ID', '-'),
        'x_correlation_id':  headers.get('X-Correlation-ID', '-'),
    }
    if CFG.record_headers:
        record['headers'] = _redact(headers)
    if status is not None:
        record['status'] = status
    if reason is not None:
        record['reason'] = reason
    if elapsed is not None:
        record['elapsed_ms'] = int(elapsed * 1000)
    if body_bytes is not None:
        record['body_bytes'] = body_bytes
    if error is not None:
        record['error'] = error
    if extra:
        record.update(extra)
    logger = (audit_allowed_logger if reason in ALLOWED_REASONS
              else audit_denied_logger)
    logger.info(json.dumps(record, ensure_ascii=False))


def parse_headers(hdr_raw):
    headers = {}
    for line in hdr_raw.split('\r\n'):
        if ':' in line:
            k, _, v = line.partition(':')
            headers[k.strip()] = v.strip()
    return headers


def _connection_tokens(headers):
    """Connection 头里点名的字段也是逐跳头，一并剥掉。"""
    tokens = set()
    for k, v in headers.items():
        if k.lower() == 'connection':
            tokens.update(t.strip().lower() for t in v.split(',') if t.strip())
    return tokens


def _deny(client, code, text, client_ip, client_port, method, target,
          headers, reason, host=None, port=None, extra_headers=b'', extra=None):
    try:
        client.sendall(
            ('HTTP/1.1 %d %s\r\n' % (code, text)).encode('ascii')
            + extra_headers
            + b'Connection: close\r\nContent-Length: 0\r\n\r\n')
    except Exception:
        pass
    try:
        client.close()
    except Exception:
        pass
    run_logger.warning('[%s] %s %s -> %d %s', client_ip, method, target, code, reason)
    audit(client_ip, client_port, method, target, headers,
          status=code, reason=reason, host=host, port=port, extra=extra)


# ---------------------------------------------------------------------------
# 带缓冲的读取器：把「已读到的多余字节」留住，避免请求体被截断
# ---------------------------------------------------------------------------
class _Reader:
    def __init__(self, sock, initial=b''):
        self.sock = sock
        self.buf = initial

    def read_until(self, sep):
        while sep not in self.buf:
            chunk = self.sock.recv(BUF)
            if not chunk:
                raise EOFError('connection closed while reading headers')
            self.buf += chunk
        end = self.buf.index(sep) + len(sep)
        out, self.buf = self.buf[:end], self.buf[end:]
        return out

    def read_exact(self, n):
        while len(self.buf) < n:
            chunk = self.sock.recv(BUF)
            if not chunk:
                raise EOFError('connection closed while reading body')
            self.buf += chunk
        out, self.buf = self.buf[:n], self.buf[n:]
        return out

    def read_all(self):
        out, self.buf = self.buf, b''
        while True:
            chunk = self.sock.recv(BUF)
            if not chunk:
                return out
            out += chunk

    def pump_to(self, dst, limit=None):
        """边收边转发：把已缓冲的 + 随后收到的数据随时发给 dst。

        limit=None 表示一直发到对端关闭。返回实际转发的字节数。
        关键：这里绝不能先把数据攒进列表再一起发，否则 SSE / 流式输出
        的「打字机」效果会变成最后一次性蹦出来。
        """
        sent = 0
        if self.buf:
            take = self.buf if limit is None else self.buf[:limit]
            if take:
                dst.sendall(take)
                sent = len(take)
                self.buf = self.buf[sent:]
            if limit is not None and sent >= limit:
                return sent
        while limit is None or sent < limit:
            want = BUF if limit is None else min(BUF, limit - sent)
            chunk = self.sock.recv(want)
            if not chunk:
                break
            dst.sendall(chunk)
            sent += len(chunk)
        return sent


def _drain_chunked(r):
    """读走一个完整的 chunked body，原样返回（含结束块与 trailer）。"""
    raw = b''
    while True:
        line = r.read_until(b'\r\n')
        raw += line
        size = int(line.split(b';', 1)[0].strip() or b'0', 16)
        if size == 0:
            while True:                       # trailer 区，直到空行
                tail = r.read_until(b'\r\n')
                raw += tail
                if tail == b'\r\n':
                    return raw
        raw += r.read_exact(size + 2)         # chunk 数据 + CRLF


def _pump_chunked(r, client):
    """chunked 响应：边解析分块边界边转发，保证流式响应不会被攒住。"""
    while True:
        line = r.read_until(b'\r\n')          # 分块大小行
        client.sendall(line)
        size = int(line.split(b';', 1)[0].strip() or b'0', 16)
        if size == 0:
            while True:                       # trailer 区，直到空行
                tail = r.read_until(b'\r\n')
                client.sendall(tail)
                if tail == b'\r\n':
                    return
        got = 0
        while got < size + 2:                 # chunk 数据 + 结尾 CRLF
            n = r.pump_to(client, size + 2 - got)
            if n == 0:
                return                        # 对端提前断开
            got += n


def _relay_body(r, client, resp_headers, method, status):
    """按响应定界方式边收边转发响应体。"""
    if method == 'HEAD' or status in (204, 304) or status < 200:
        return
    if 'chunked' in resp_headers.get('Transfer-Encoding', '').lower():
        _pump_chunked(r, client)
        return
    cl = (resp_headers.get('Content-Length') or '').strip()
    if cl.isdigit():
        r.pump_to(client, int(cl))
    else:
        # 没有长度信息：我们强制了 Connection: close，读到 EOF 即响应结束
        r.pump_to(client)


def _set_nodelay(sock):
    """流式代理必须关掉 Nagle，否则小包会被延迟合并，SSE 一顿一顿的。"""
    try:
        sock.setsockopt(socket.IPPROTO_TCP, socket.TCP_NODELAY, 1)
    except Exception:
        pass


def _forward_request_headers(hdr_raw, headers, chunked):
    """构造转发给上游的请求头：剥逐跳头、强制 close、补回 chunked。"""
    drop = set(HOP_BY_HOP) | _connection_tokens(headers)
    drop.add('expect')        # 请求体已被我们完整读走，不需要 100-continue 协商
    out = []
    for line in hdr_raw.split('\r\n'):
        if not line.strip():
            continue
        name = line.split(':', 1)[0].strip().lower()
        if name in drop:
            continue
        out.append(line)
    out.append('Connection: close')
    if chunked:
        out.append('Transfer-Encoding: chunked')
    return out


def _relay_response_head(head_lines, resp_headers):
    """改造上游响应头：剥逐跳头（保留 Transfer-Encoding）、强制 close。"""
    drop = set(HOP_BY_HOP) | _connection_tokens(resp_headers)
    drop.discard('transfer-encoding')         # chunked 要原样透传给客户端
    out = []
    for line in head_lines[1:]:
        if not line.strip():
            continue
        name = line.split(':', 1)[0].strip().lower()
        if name in drop:
            continue
        out.append(line)
    out.append('Connection: close')
    return (head_lines[0] + '\r\n' + '\r\n'.join(out) + '\r\n\r\n').encode('iso-8859-1', 'replace')


# ---------------------------------------------------------------------------
# CONNECT（HTTPS 隧道）
# ---------------------------------------------------------------------------
def splice(a, b):
    def pump(src, dst):
        try:
            while True:
                d = src.recv(BUF)
                if not d:
                    break
                dst.sendall(d)
        except Exception:
            pass
        finally:
            for s in (src, dst):
                try: s.shutdown(socket.SHUT_RDWR)
                except Exception: pass
                try: s.close()
                except Exception: pass
    t = threading.Thread(target=pump, args=(b, a), daemon=True)
    t.start()
    pump(a, b)


def do_connect(client, host, port, client_ip, client_port, headers, target):
    t0 = time.monotonic()
    timeout = CFG.connect_timeout
    try:
        remote = socket.create_connection((host, port), timeout=timeout)
        remote.settimeout(CFG.read_timeout)
        client.settimeout(CFG.read_timeout)
        _set_nodelay(remote)
        _set_nodelay(client)
    except Exception as e:
        elapsed = time.monotonic() - t0
        run_logger.warning('[%s] CONNECT %s:%d -> 502 %.3fs (%s)',
                           client_ip, host, port, elapsed, e)
        audit(client_ip, client_port, 'CONNECT', target, headers,
              status=502, reason='upstream_error', host=host, port=port,
              elapsed=elapsed, error=str(e))
        try:
            client.sendall(b'HTTP/1.1 502 Bad Gateway\r\nConnection: close\r\n'
                           b'Content-Length: 0\r\n\r\n')
        except Exception:
            pass
        try: client.close()
        except Exception: pass
        return
    try:
        client.sendall(b'HTTP/1.1 200 Connection Established\r\n\r\n')
    except Exception:
        for s in (remote, client):
            try: s.close()
            except Exception: pass
        return
    elapsed = time.monotonic() - t0
    run_logger.info('[%s] CONNECT %s:%d -> 200 connect=%.3fs',
                    client_ip, host, port, elapsed)
    audit(client_ip, client_port, 'CONNECT', target, headers,
          status=200, reason='tunnel', host=host, port=port, elapsed=elapsed)
    splice(client, remote)
    run_logger.info('[%s] CONNECT %s:%d closed total=%.3fs',
                    client_ip, host, port, time.monotonic() - t0)


# ---------------------------------------------------------------------------
# 普通 HTTP 转发
# ---------------------------------------------------------------------------
def do_http(client, method, target, version, hdr_raw, headers, body, chunked,
            host, port, path, scheme, client_ip, client_port):
    t0 = time.monotonic()
    remote = None
    sent_head = False
    try:
        remote = socket.create_connection((host, port), timeout=CFG.connect_timeout)
        if scheme == 'https':
            remote = ssl.create_default_context().wrap_socket(remote, server_hostname=host)
        remote.settimeout(CFG.read_timeout)
        _set_nodelay(remote)

        req_head = '%s %s %s\r\n' % (method, path, version)
        req_head += '\r\n'.join(_forward_request_headers(hdr_raw, headers, chunked))
        req_head += '\r\n\r\n'
        remote.sendall(req_head.encode('iso-8859-1', 'replace') + body)

        r = _Reader(remote)
        while True:
            raw_head = r.read_until(b'\r\n\r\n')
            head_lines = raw_head[:-4].decode('iso-8859-1', 'replace').split('\r\n')
            status = 0
            parts = head_lines[0].split(' ', 2)
            if len(parts) >= 2 and parts[1].isdigit():
                status = int(parts[1])
            if 100 <= status < 200:          # 1xx 是临时响应，丢掉继续读真正的响应
                continue
            break

        resp_headers = parse_headers('\r\n'.join(head_lines[1:]))
        client.sendall(_relay_response_head(head_lines, resp_headers))
        sent_head = True

        # 响应体边收边转发：SSE / 流式输出靠的就是这个
        _relay_body(r, client, resp_headers, method, status)

        elapsed = time.monotonic() - t0
        run_logger.info('[%s] %s %s -> %d %.3fs', client_ip, method, target, status, elapsed)
        audit(client_ip, client_port, method, target, headers,
              status=status, reason='allowed', host=host, port=port,
              elapsed=elapsed, body_bytes=len(body))
    except Exception as e:
        elapsed = time.monotonic() - t0
        run_logger.warning('[%s] %s %s -> 502 %.3fs (%s)',
                           client_ip, method, target, elapsed, e)
        audit(client_ip, client_port, method, target, headers,
              status=502, reason='upstream_error', host=host, port=port,
              elapsed=elapsed, body_bytes=len(body), error=str(e))
        if not sent_head:                    # 还没回任何东西才能补 502
            try:
                client.sendall(b'HTTP/1.1 502 Bad Gateway\r\nConnection: close\r\n'
                               b'Content-Length: 0\r\n\r\n')
            except Exception:
                pass
    finally:
        for s in (remote, client):
            if s is None:
                continue
            try: s.close()
            except Exception: pass


# ---------------------------------------------------------------------------
# 连接入口
# ---------------------------------------------------------------------------
def _parse_connect_target(target):
    host, _, port = target.rpartition(':')
    if not host:                             # 只给了主机名，默认 443
        return target.strip('[]'), 443
    if port.isdigit():
        return host.strip('[]'), int(port)
    return target.strip('[]'), 443


def _target_host_port(method, target, headers):
    """尽力从请求里解析出目标 host/port，只用于日志（鉴权失败时也要能看出想访问哪）。

    解析不出来就返回 (None, None)。
    """
    try:
        if method.upper() == 'CONNECT':
            host, port = _parse_connect_target(target)
            return (host or None), port

        parsed = urlparse(target)
        scheme = parsed.scheme.lower()
        if scheme in ('http', 'https'):      # 代理模式：请求行是绝对 URL
            try:
                port = parsed.port
            except ValueError:               # 端口写得不合法
                port = None
            return (parsed.hostname or None), (port or (443 if scheme == 'https' else 80))

        # origin-form：目标靠 Host 头
        host_hdr = headers.get('Host', '')
        host, _, port = host_hdr.rpartition(':')
        if host and port.isdigit():
            return host.strip('[]') or None, int(port)
        host = host_hdr.strip('[]')
        return (host or None), (80 if host else None)
    except Exception:
        return None, None


def handle(client, addr):
    client_ip, client_port = addr
    headers = {}
    method = target = '-'
    try:
        client.settimeout(CFG.connect_timeout)
        _set_nodelay(client)
        r = _Reader(client)
        raw_head = r.read_until(b'\r\n\r\n')
        head_lines = raw_head[:-4].decode('iso-8859-1', 'replace').split('\r\n')
        first = head_lines[0].split(' ', 2)
        if len(first) != 3:
            client.sendall(b'HTTP/1.1 400 Bad Request\r\nConnection: close\r\n'
                           b'Content-Length: 0\r\n\r\n')
            client.close()
            return
        method, target, version = first
        hdr_raw = '\r\n'.join(head_lines[1:])
        headers = parse_headers(hdr_raw)

        if not _check_auth(headers):
            # 标准 407 挑战：客户端收到后会带着用户名密码重试
            realm = str(CFG.auth.get('realm') or DEFAULT_CONFIG['auth']['realm'])
            challenge = ('Proxy-Authenticate: Basic realm="%s", charset="UTF-8"\r\n'
                         % realm).encode('ascii')
            user = _attempted_user(headers)
            # 鉴权发生在解析目标之前，这里单独解析一次，让日志能看出想访问哪里
            host, port = _target_host_port(method, target, headers)
            run_logger.warning('[%s] %s %s:%s -> 407 unauthorized (client_user=%s)',
                               client_ip, method, host, port, user)
            _deny(client, 407, 'Proxy Authentication Required', client_ip, client_port,
                  method, target, headers, 'unauthorized',
                  host=host, port=port,
                  extra_headers=challenge, extra={'auth_user': user})
            return

        # ---------------- CONNECT ----------------
        if method.upper() == 'CONNECT':
            host, port = _parse_connect_target(target)
            if not allowed_host(host):
                _deny(client, 403, 'Forbidden', client_ip, client_port, method, target,
                      headers, 'blocked_domain', host=host, port=port)
                return
            if not allowed_port(port):
                _deny(client, 403, 'Forbidden', client_ip, client_port, method, target,
                      headers, 'blocked_port', host=host, port=port)
                return
            do_connect(client, host, port, client_ip, client_port, headers, target)
            return

        # ---------------- 普通 HTTP ----------------
        parsed = urlparse(target)
        if parsed.scheme.lower() in ('http', 'https'):
            # 代理模式：请求行是绝对 URL
            scheme = parsed.scheme.lower()
            host = parsed.hostname or ''
            port = parsed.port or (443 if scheme == 'https' else 80)
            path = (parsed.path or '/') + (('?' + parsed.query) if parsed.query else '')
        else:
            # 客户端没走代理模式，直接发了 origin-form，用 Host 头补出目标
            scheme = 'http'
            path = target or '/'
            host_hdr = headers.get('Host', '')
            h, _, p = host_hdr.rpartition(':')
            if h and p.isdigit():
                host, port = h.strip('[]'), int(p)
            else:
                host, port = host_hdr.strip('[]'), 80

        if not allowed_host(host):
            _deny(client, 403, 'Forbidden', client_ip, client_port, method, target,
                  headers, 'blocked_domain', host=host, port=port)
            return
        if not allowed_port(port):
            _deny(client, 403, 'Forbidden', client_ip, client_port, method, target,
                  headers, 'blocked_port', host=host, port=port)
            return

        # 请求体必须完整读走再转发，否则分包到达的部分会丢
        body = b''
        chunked = False
        if headers.get('Expect', '').lower().startswith('100-continue'):
            client.sendall(b'HTTP/1.1 100 Continue\r\n\r\n')
        te = headers.get('Transfer-Encoding', '')
        cl = (headers.get('Content-Length') or '').strip()
        if 'chunked' in te.lower():
            body = _drain_chunked(r)
            chunked = True
        elif cl.isdigit():
            body = r.read_exact(int(cl)) if int(cl) else b''

        do_http(client, method, target, version, hdr_raw, headers, body, chunked,
                host, port, path, scheme, client_ip, client_port)
    except Exception as e:
        logging.debug('[%s] handle error: %s', client_ip, e)
        try: client.close()
        except Exception: pass


def serve(use_pidfile=True):
    """真正的服务循环（被 run 命令和测试调用）。

    注意：参数不能叫 write_pid，否则会遮蔽同名的模块级函数。
    """
    if not run_logger.handlers:      # 直接被调用时兜底把日志装好
        setup_logging(console=_stdout_is_console())
    host, port = CFG.listen_host, CFG.listen_port
    srv = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    srv.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
    try:
        srv.bind((host, port))
    except OSError as e:
        run_logger.error('无法监听 %s:%d —— %s', host, port, e)
        try: srv.close()
        except Exception: pass
        return 1
    srv.listen(256)

    if use_pidfile:
        write_pid(os.getpid())

    run_logger.info('Proxy listening on %s:%d', host, port)
    run_logger.info('允许域名: %s', ', '.join(CFG.allowed_domains) or '(空，全部拒绝)')
    ports = CFG.allowed_ports
    run_logger.info('允许端口: %s', '不限制' if ports is None else sorted(ports))
    run_logger.info('鉴权方式: %s', 'Basic' if CFG.auth_method == 'basic'
                    and CFG.auth.get('password') else '未启用')
    run_logger.info('配置文件: %s', CFG.path)
    run_logger.info('日志目录: %s', CFG.log_dir)
    run_logger.info('   %s   能正常代理的', ALLOWED_LOG)
    run_logger.info('   %s    被拒绝/失败的', DENIED_LOG)
    if not CFG.allowed_domains:
        run_logger.warning('允许域名为空：所有请求都会被 403 拒绝')
    if ports is None:
        run_logger.warning('允许端口为 "*"，端口不再受限')

    try:
        while True:
            try:
                client, addr = srv.accept()
                threading.Thread(target=handle, args=(client, addr), daemon=True).start()
            except KeyboardInterrupt:
                break
            except OSError as e:
                run_logger.error('accept: %s', e)
                break
    finally:
        try: srv.close()
        except Exception: pass
        if use_pidfile:
            remove_pid()
    return 0


# ---------------------------------------------------------------------------
# 进程管理
# ---------------------------------------------------------------------------
def read_pid():
    try:
        with open(PID_FILE, encoding='utf-8') as f:
            txt = f.read().strip()
        return int(txt) if txt else None
    except Exception:
        return None


def write_pid(pid):
    try:
        with open(PID_FILE, 'w', encoding='utf-8') as f:
            f.write(str(pid))
    except Exception as e:
        run_logger.warning('写 pid 文件失败 %s: %s', PID_FILE, e)


def remove_pid():
    try:
        os.remove(PID_FILE)
    except OSError:
        pass


def pid_alive(pid):
    if not pid:
        return False
    if os.name != 'nt':
        try:
            os.kill(pid, 0)
            return True
        except OSError:
            return False
    PROCESS_QUERY_LIMITED_INFORMATION = 0x1000
    STILL_ACTIVE = 259
    handle = ctypes.windll.kernel32.OpenProcess(
        PROCESS_QUERY_LIMITED_INFORMATION, False, int(pid))
    if not handle:
        return False
    try:
        code = ctypes.c_ulong()
        if not ctypes.windll.kernel32.GetExitCodeProcess(handle, ctypes.byref(code)):
            return False
        return code.value == STILL_ACTIVE
    finally:
        ctypes.windll.kernel32.CloseHandle(handle)


def image_name(pid):
    """取进程映像名，用于确认要杀的确实是个 python 进程。"""
    if os.name != 'nt':
        return ''
    try:
        out = subprocess.run(['tasklist', '/FI', 'PID eq %d' % int(pid),
                              '/FO', 'CSV', '/NH'],
                             capture_output=True, text=True, timeout=10,
                             creationflags=CREATE_NO_WINDOW)
        line = (out.stdout or '').strip().splitlines()
        return line[0].split(',')[0].strip('"') if line else ''
    except Exception:
        return ''


def port_listening(host, port, timeout=0.6):
    try:
        with socket.create_connection((host, port), timeout=timeout):
            return True
    except Exception:
        return False


def running_pid():
    """返回正在运行的代理 PID；没有则 None。"""
    pid = read_pid()
    if pid and pid_alive(pid):
        return pid
    return None


def pythonw_path():
    """优先用 pythonw.exe（无控制台窗口）；找不到就退回当前解释器。"""
    exe = sys.executable or ''
    if os.name == 'nt' and exe.lower().endswith('.exe'):
        cand = exe[:-4] + 'w.exe'
        if os.path.exists(cand):
            return cand
    return exe


def stop_pid(pid):
    """结束进程；返回 (成功?, 说明)。"""
    if os.name == 'nt':
        name = image_name(pid)
        if name and not name.lower().startswith('python'):
            return False, 'PID %d 是 %s，不像是本代理，为避免误杀已放弃' % (pid, name)
        try:
            out = subprocess.run(['taskkill', '/PID', str(int(pid)), '/F'],
                                 capture_output=True, text=True, timeout=15,
                                 creationflags=CREATE_NO_WINDOW)
            if out.returncode != 0:
                return False, (out.stderr or out.stdout or '').strip()
        except Exception as e:
            return False, str(e)
        return True, ''
    try:
        os.kill(pid, 15)
        return True, ''
    except Exception as e:
        return False, str(e)


# ---------------------------------------------------------------------------
# 开机自启（当前用户注册表 Run 键）
# ---------------------------------------------------------------------------
def autostart_command():
    return '"%s" "%s" run --daemon' % (pythonw_path(), SCRIPT_PATH)


def autostart_get():
    """返回已登记的命令；没启用则 None。"""
    if os.name != 'nt':
        return None
    try:
        import winreg
        with winreg.OpenKey(winreg.HKEY_CURRENT_USER, AUTOSTART_KEY) as k:
            try:
                return winreg.QueryValueEx(k, AUTOSTART_NAME)[0]
            except FileNotFoundError:
                return None
    except Exception:
        return None


def autostart_set():
    if os.name != 'nt':
        return False, '仅支持 Windows'
    import winreg
    try:
        with winreg.CreateKeyEx(winreg.HKEY_CURRENT_USER, AUTOSTART_KEY, 0,
                                winreg.KEY_SET_VALUE) as k:
            winreg.SetValueEx(k, AUTOSTART_NAME, 0, winreg.REG_SZ, autostart_command())
        return True, ''
    except Exception as e:
        return False, str(e)


def autostart_remove():
    if os.name != 'nt':
        return False
    import winreg
    try:
        with winreg.OpenKey(winreg.HKEY_CURRENT_USER, AUTOSTART_KEY, 0,
                            winreg.KEY_SET_VALUE) as k:
            winreg.DeleteValue(k, AUTOSTART_NAME)
        return True
    except FileNotFoundError:
        return False
    except Exception:
        return False


# ---------------------------------------------------------------------------
# 命令：启动 / 停止 / 重启 / 状态
# ---------------------------------------------------------------------------
def cmd_start(quiet=False):
    pid = running_pid()
    if pid:
        if not quiet:
            print('代理已经在运行，PID=%d，无需重复启动。' % pid)
        return 0

    exe = pythonw_path()
    cmd = [exe, SCRIPT_PATH, 'run', '--daemon']
    flags = 0
    if os.name == 'nt':
        flags = DETACHED_PROCESS | CREATE_NEW_PROCESS_GROUP
    try:
        subprocess.Popen(cmd, cwd=BASE_DIR,
                         stdin=subprocess.DEVNULL,
                         stdout=subprocess.DEVNULL,
                         stderr=subprocess.DEVNULL,
                         creationflags=flags, close_fds=True)
    except Exception as e:
        print('[错误] 启动失败：%s' % e)
        return 1

    host, port = CFG.listen_host, CFG.listen_port
    for _ in range(100):                      # 最多等 10 秒
        pid = running_pid()
        if pid and port_listening(host, port):
            if not quiet:
                print('[完成] 代理已启动  PID=%d  监听 %s:%d' % (pid, host, port))
            return 0
        time.sleep(0.1)

    stale = read_pid()
    if stale and pid_alive(stale):
        print('[警告] 进程起来了(PID=%d)但 %s:%d 还没在监听，请看日志：%s'
              % (stale, host, port, os.path.join(CFG.log_dir, RUN_LOG)))
    else:
        print('[错误] 启动失败，%s:%d 没有开始监听。请看日志：%s'
              % (host, port, os.path.join(CFG.log_dir, RUN_LOG)))
    return 1


def cmd_stop(quiet=False):
    pid = read_pid()
    if not pid:
        if port_listening(CFG.listen_host, CFG.listen_port):
            if not quiet:
                print('[警告] %s:%d 有进程在监听，但不是本工具启动的（没有 pid 文件），'
                      '已放弃自动停止。' % (CFG.listen_host, CFG.listen_port))
            return 1
        if not quiet:
            print('代理当前没有运行。')
        return 0

    if not pid_alive(pid):
        remove_pid()
        if not quiet:
            print('代理当前没有运行（已清理失效的 pid 文件）。')
        return 0

    ok, msg = stop_pid(pid)
    if not ok:
        print('[错误] 停止失败 PID=%d：%s' % (pid, msg))
        return 1
    remove_pid()
    if not quiet:
        print('[完成] 代理已停止  PID=%d' % pid)
    return 0


def cmd_restart():
    cmd_stop()
    time.sleep(0.5)
    return cmd_start()


def print_status():
    host, port = CFG.listen_host, CFG.listen_port
    pid = running_pid()
    listening = port_listening(host, port)

    line = '=' * 68
    print(line)
    print('   白名单代理  proxy.py')
    print(line)

    if pid and listening:
        print('   运行状态    运行中    PID=%d' % pid)
    elif pid:
        print('   运行状态    进程在但端口没监听，可能启动中或已异常  PID=%d' % pid)
    elif listening:
        print('   运行状态    端口被别的进程占用（不是本工具启动的）')
    else:
        print('   运行状态    未运行')
    print('   监听地址    %s:%d' % (host, port))

    cmd_line = autostart_get()
    if cmd_line:
        print('   开机自启    已启用')
        print('               %s' % cmd_line)
    else:
        print('   开机自启    未启用')

    print('   配置文件    %s' % CFG.path)
    domains = CFG.allowed_domains
    print('   允许域名    %s' % (', '.join(str(d) for d in domains) or '(空，全部拒绝)'))
    ports = CFG.allowed_ports
    print('   允许端口    %s' % ('不限制' if ports is None
                                 else (', '.join(str(p) for p in sorted(ports)) or '(空，全部拒绝)')))
    if CFG.auth_method == 'basic' and CFG.auth.get('password'):
        print('   鉴权方式    标准 HTTP Basic（用户名 %s）'
              % (CFG.auth.get('username') or '(空)'))
    else:
        print('   鉴权方式    未启用')
    print('   日志目录    %s' % CFG.log_dir)
    print('               %s  能正常代理的 / %s  被拒绝的' % (ALLOWED_LOG, DENIED_LOG))
    print(line)
    return 0


# ---------------------------------------------------------------------------
# 命令：配置
# ---------------------------------------------------------------------------
CONFIG_HELP = """
用法：python proxy.py config <子命令>

    show                            查看当前配置
    path                            打印配置文件路径
    edit                            用记事本打开配置文件
    domain list                     列出允许的域名
    domain add <域名>               允许一个域名（含其所有子域）
    domain remove <域名>            移除一个域名
    domain set <域名,域名,...>      整批替换
    port list                       列出允许的端口
    port add <端口>                 允许一个端口
    port remove <端口>              移除一个端口
    auth show                       查看鉴权设置
    auth none                       关闭鉴权
    auth basic <用户名> <密码>      开启标准 HTTP Basic 鉴权
    set <键> <值>                   改单项，键可为 listen_host /
                                    listen_port / connect_timeout / log_dir
"""

# 改完立刻热生效的配置项
HOT_KEYS = '域名 / 端口 / 鉴权方式'

DOMAIN_HEADER = ('域名写法：jlcops.com 表示 jlcops.com 及其所有子域；'
                 '需要正则时写 re:^api\\.example\\.com$')


def _save_and_hint(hot=True):
    CFG.save()
    if hot:
        print('[提示] %s 会在 2 秒内自动生效，不用重启。' % HOT_KEYS)
    else:
        print('[提示] 该项需要 restart 才会生效。')


def cmd_config(args):
    if not args or args[0] in ('show', 'list'):
        print('# %s' % CFG.path)
        print(json.dumps(CFG.data, ensure_ascii=False, indent=2))
        return 0

    sub = args[0].lower()
    rest = args[1:]

    if sub == 'path':
        print(CFG.path)
        return 0

    if sub in ('edit', 'open'):
        try:
            os.startfile(CFG.path)
        except Exception as e:
            print('打开失败：%s\n请手动编辑：%s' % (e, CFG.path))
            return 1
        print('已用默认编辑器打开：%s' % CFG.path)
        return 0

    if sub in ('domain', 'domains'):
        return _config_domain(rest)

    if sub in ('port', 'ports'):
        return _config_port(rest)

    if sub in ('auth', '认证', '鉴权'):
        return _config_auth(rest)

    if sub == 'set':
        return _config_set(rest)

    print('未知的 config 子命令：%s' % sub)
    print(CONFIG_HELP)
    return 2


def _config_domain(args):
    if not args or args[0] == 'list':
        domains = CFG.allowed_domains
        print('允许的域名（共 %d 个）：' % len(domains))
        for d in domains:
            print('    %s' % d)
        if not domains:
            print('    (空，所有请求都会被拒绝)')
        print(DOMAIN_HEADER)
        return 0

    action = args[0].lower()
    items = CFG.allowed_domains

    if action == 'add':
        if len(args) < 2:
            print('用法：config domain add <域名>')
            return 2
        for d in args[1:]:
            d = d.strip().lower()
            if d and d not in items:
                items.append(d)
                print('已添加：%s' % d)
            elif d:
                print('已存在，跳过：%s' % d)
        CFG.data['allowed_domains'] = items
        _save_and_hint()
        return 0

    if action in ('remove', 'del', 'rm'):
        if len(args) < 2:
            print('用法：config domain remove <域名>')
            return 2
        for d in args[1:]:
            d = d.strip().lower()
            if d in items:
                items.remove(d)
                print('已移除：%s' % d)
            else:
                print('不在列表里：%s' % d)
        CFG.data['allowed_domains'] = items
        _save_and_hint()
        return 0

    if action == 'set':
        if len(args) < 2:
            print('用法：config domain set <域名,域名,...>')
            return 2
        new = [x.strip().lower() for x in ','.join(args[1:]).split(',') if x.strip()]
        CFG.data['allowed_domains'] = new
        print('已整批替换为 %d 个域名。' % len(new))
        _save_and_hint()
        return 0

    print('未知操作：%s' % action)
    print(CONFIG_HELP)
    return 2


def _config_port(args):
    if not args or args[0] == 'list':
        ports = CFG.allowed_ports
        if ports is None:
            print('允许的端口：不限制（配置里写了 "*"）')
        else:
            print('允许的端口（共 %d 个）：%s'
                  % (len(ports), ', '.join(str(p) for p in sorted(ports)) or '(空，全部拒绝)'))
        return 0

    action = args[0].lower()
    ports = CFG.allowed_ports
    if ports is None:
        print('当前端口配置是 "*"（不限制）。先用 "config port set 80,443" 改成白名单。')
        return 1

    if action == 'add':
        if len(args) < 2:
            print('用法：config port add <端口> [端口...]')
            return 2
        for p in args[1:]:
            if not str(p).isdigit():
                print('不是合法端口，跳过：%s' % p)
                continue
            ports.add(int(p))
            print('已添加端口：%s' % p)
        CFG.data['allowed_ports'] = sorted(ports)
        _save_and_hint()
        return 0

    if action in ('remove', 'del', 'rm'):
        if len(args) < 2:
            print('用法：config port remove <端口> [端口...]')
            return 2
        for p in args[1:]:
            if not str(p).isdigit():
                print('不是合法端口，跳过：%s' % p)
                continue
            if int(p) in ports:
                ports.discard(int(p))
                print('已移除端口：%s' % p)
            else:
                print('不在列表里：%s' % p)
        CFG.data['allowed_ports'] = sorted(ports)
        _save_and_hint()
        return 0

    if action == 'set':
        if len(args) < 2:
            print('用法：config port set <端口,端口,...>（写 * 表示不限制）')
            return 2
        raw = ','.join(args[1:])
        if raw.strip() == '*':
            CFG.data['allowed_ports'] = ['*']
            print('已设置：端口不限制（注意：这已不是白名单了）')
        else:
            new = sorted({int(x) for x in raw.split(',') if x.strip().isdigit()})
            CFG.data['allowed_ports'] = new
            print('已整批替换为：%s' % (', '.join(str(p) for p in new) or '(空)'))
        _save_and_hint()
        return 0

    print('未知操作：%s' % action)
    print(CONFIG_HELP)
    return 2


def _config_auth(args):
    if not args or args[0] == 'show':
        if CFG.auth_method == 'basic' and CFG.auth.get('password'):
            print('鉴权方式：标准 HTTP Basic')
            print('    用户名：%s' % (CFG.auth.get('username') or '(空，只校验密码)'))
            print('    密码  ：%s' % ('*' * len(str(CFG.auth.get('password')))))
            print('    realm ：%s' % CFG.auth.get('realm'))
        else:
            print('鉴权方式：未启用（任何能访问本机端口的程序都能使用这个代理）')
        return 0

    action = args[0].lower()

    if action in ('none', 'off', 'disable'):
        CFG.data['auth'] = dict(DEFAULT_CONFIG['auth'])
        print('已关闭鉴权。')
        _save_and_hint()
        return 0

    if action in ('basic', 'on'):
        if len(args) < 3:
            print('用法：config auth basic <用户名> <密码>')
            return 2
        CFG.data['auth'] = {
            'method': 'basic',
            'username': args[1],
            'password': args[2],
            'realm': str(CFG.auth.get('realm') or DEFAULT_CONFIG['auth']['realm']),
        }
        print('已开启标准 HTTP Basic 鉴权，用户名：%s' % args[1])
        print('客户端只要在代理设置里填上用户名密码即可，例如：')
        print('    curl --proxy http://%s:%d --proxy-user \'%s:%s\' https://www.jlcops.com/'
              % (CFG.listen_host, CFG.listen_port, args[1], args[2]))
        _save_and_hint()
        return 0

    print('未知操作：%s' % action)
    print(CONFIG_HELP)
    return 2


def _config_set(args):
    if len(args) < 2:
        print('用法：config set <键> <值>')
        print('    键可为 listen_host / listen_port / connect_timeout / log_dir')
        return 2
    key, value = args[0].lower(), args[1]

    if key == 'listen_host':
        CFG.data['listen_host'] = value
        print('监听地址已设为 %s' % value)
        _save_and_hint(hot=False)
        return 0
    if key == 'listen_port':
        if not value.isdigit():
            print('端口必须是数字：%s' % value)
            return 2
        CFG.data['listen_port'] = int(value)
        print('监听端口已设为 %s' % value)
        _save_and_hint(hot=False)
        return 0
    if key == 'connect_timeout':
        try:
            CFG.data['connect_timeout'] = float(value)
        except ValueError:
            print('必须是数字：%s' % value)
            return 2
        print('连接超时已设为 %s 秒' % value)
        _save_and_hint(hot=False)
        return 0
    if key in ('log_dir', 'logs.dir'):
        CFG.data['logs']['dir'] = value
        print('日志目录已设为 %s' % (value or '(空 = 脚本目录下的 logs)'))
        _save_and_hint(hot=False)
        return 0

    print('不支持的键：%s' % key)
    print('    键可为 listen_host / listen_port / connect_timeout / log_dir')
    return 2


# ---------------------------------------------------------------------------
# 命令：开机自启
# ---------------------------------------------------------------------------
def cmd_autostart(args):
    action = (args[0].lower() if args else 'status')

    if action in ('status', 'show'):
        line = autostart_get()
        if line:
            print('开机自启：已启用')
            print('    %s' % line)
            print('    登录 Windows 后会自动在后台运行（不弹窗口）。')
        else:
            print('开机自启：未启用')
            print('    开启：python proxy.py autostart on')
        return 0

    if action in ('on', 'enable', '1'):
        if autostart_get():
            print('开机自启本来就是启用的。')
            return 0
        ok, msg = autostart_set()
        if not ok:
            print('[错误] 设置开机自启失败：%s' % msg)
            return 1
        print('[完成] 已开启开机自启，登录 Windows 后代理会自动在后台运行：')
        print('    %s' % autostart_command())
        return 0

    if action in ('off', 'disable', '0'):
        if not autostart_remove():
            print('开机自启本来就是关闭的。')
            return 0
        print('[完成] 已关闭开机自启。')
        return 0

    print('用法：python proxy.py autostart on|off|status')
    return 2


# ---------------------------------------------------------------------------
# 交互菜单
# ---------------------------------------------------------------------------
def _ask(prompt):
    try:
        return input(prompt).strip()
    except (EOFError, KeyboardInterrupt):
        return None


def _pause():
    try:
        input('\n按回车继续...')
    except (EOFError, KeyboardInterrupt):
        pass


def menu():
    if sys.stdin is None or not sys.stdin.isatty():
        print('当前没有可用的控制台，无法进入交互菜单。')
        print('请直接双击 start_proxy.bat，或使用命令行，例如：')
        print('    python proxy.py status')
        return 1

    while True:
        os.system('cls' if os.name == 'nt' else 'clear')
        print_status()
        print()
        print('    [1] 启动            [2] 停止            [3] 重启')
        print('    [4] 刷新状态')
        print('    [5] 开启开机自启    [6] 关闭开机自启')
        print('    [7] 查看配置        [8] 编辑配置文件')
        print('    [9] 允许域名管理    [10] 允许端口管理   [11] 鉴权设置')
        print('    [0] 退出')
        print()
        sel = _ask('请选择: ')
        if sel is None or sel == '0':
            return 0
        if sel == '1':
            cmd_start(); _pause()
        elif sel == '2':
            cmd_stop(); _pause()
        elif sel == '3':
            cmd_restart(); _pause()
        elif sel == '4':
            continue
        elif sel == '5':
            cmd_autostart(['on']); _pause()
        elif sel == '6':
            cmd_autostart(['off']); _pause()
        elif sel == '7':
            cmd_config(['show']); _pause()
        elif sel == '8':
            cmd_config(['edit']); _pause()
        elif sel == '9':
            domain_menu()
        elif sel in ('10', '11'):
            (port_menu if sel == '10' else auth_menu)()
        else:
            print('无效选项。')
            _pause()


def domain_menu():
    while True:
        os.system('cls' if os.name == 'nt' else 'clear')
        print('=== 允许域名管理 ===')
        cmd_config(['domain', 'list'])
        print()
        print('    [1] 添加域名   [2] 删除域名   [3] 整批替换   [0] 返回')
        sel = _ask('请选择: ')
        if sel in (None, '0'):
            return
        if sel == '1':
            v = _ask('要添加的域名（多个用逗号分隔）: ')
            if v:
                cmd_config(['domain', 'add'] + [x for x in v.replace(' ', ',').split(',') if x])
            _pause()
        elif sel == '2':
            v = _ask('要删除的域名（多个用逗号分隔）: ')
            if v:
                cmd_config(['domain', 'remove'] + [x for x in v.replace(' ', ',').split(',') if x])
            _pause()
        elif sel == '3':
            v = _ask('新的域名列表（逗号分隔）: ')
            if v:
                cmd_config(['domain', 'set', v])
            _pause()


def port_menu():
    while True:
        os.system('cls' if os.name == 'nt' else 'clear')
        print('=== 允许端口管理 ===')
        cmd_config(['port', 'list'])
        print()
        print('    [1] 添加端口   [2] 删除端口   [3] 整批替换   [0] 返回')
        sel = _ask('请选择: ')
        if sel in (None, '0'):
            return
        if sel == '1':
            v = _ask('要添加的端口（多个用逗号分隔）: ')
            if v:
                cmd_config(['port', 'add'] + [x for x in v.replace(' ', ',').split(',') if x])
            _pause()
        elif sel == '2':
            v = _ask('要删除的端口（多个用逗号分隔）: ')
            if v:
                cmd_config(['port', 'remove'] + [x for x in v.replace(' ', ',').split(',') if x])
            _pause()
        elif sel == '3':
            v = _ask('新的端口列表（逗号分隔，写 * 表示不限制）: ')
            if v:
                cmd_config(['port', 'set', v])
            _pause()


def auth_menu():
    while True:
        os.system('cls' if os.name == 'nt' else 'clear')
        print('=== 鉴权设置（标准 HTTP Basic）===')
        cmd_config(['auth', 'show'])
        print()
        print('    [1] 关闭鉴权')
        print('    [2] 开启/修改 Basic 用户名密码')
        print('    [0] 返回')
        sel = _ask('请选择: ')
        if sel in (None, '0'):
            return
        if sel == '1':
            cmd_config(['auth', 'none']); _pause()
        elif sel == '2':
            u = _ask('用户名: ')
            p = _ask('密码  : ')
            if u is not None and p:
                cmd_config(['auth', 'basic', u, p])
            else:
                print('已取消。')
            _pause()


# ---------------------------------------------------------------------------
# 入口
# ---------------------------------------------------------------------------
USAGE = """
白名单 HTTP/HTTPS 正向代理

    python proxy.py                     打开交互菜单
    python proxy.py run                 前台运行（调试用，Ctrl+C 停止）
    python proxy.py start               后台启动
    python proxy.py stop                停止
    python proxy.py restart             重启
    python proxy.py status              查看状态（含开机自启状态）
    python proxy.py autostart on|off    开关开机自启
    python proxy.py autostart          查看开机自启状态
    python proxy.py config ...          改配置（python proxy.py config 看子命令）
    python proxy.py help                显示本帮助

配置文件 %s
""" % CONFIG_PATH


def cmd_run(args):
    daemon = '--daemon' in args
    setup_logging(console=not daemon)
    try:
        return serve()
    except Exception:
        run_logger.exception('代理异常退出')
        return 1


def main(argv=None):
    argv = list(sys.argv[1:] if argv is None else argv)
    if not argv:
        return menu()

    cmd = argv[0].lower()
    rest = argv[1:]

    if cmd == 'run':
        return cmd_run(rest)
    if cmd == 'start':
        return cmd_start()
    if cmd == 'stop':
        return cmd_stop()
    if cmd == 'restart':
        return cmd_restart()
    if cmd == 'status':
        return print_status()
    if cmd == 'autostart':
        return cmd_autostart(rest)
    if cmd == 'config':
        return cmd_config(rest)
    if cmd in ('menu', 'ui'):
        return menu()
    if cmd in ('help', '-h', '--help', '/?'):
        print(USAGE)
        return 0

    print('未知命令：%s' % cmd)
    print(USAGE)
    return 2


if __name__ == '__main__':
    # pythonw.exe 下没有控制台，sys.stdout/stderr 都是 None，
    # 直接 print 会抛异常且连报错都看不到，这里兜底成黑洞。
    if sys.stdout is None:
        sys.stdout = open(os.devnull, 'w', encoding='utf-8')
    if sys.stderr is None:
        sys.stderr = open(os.devnull, 'w', encoding='utf-8')
    sys.exit(main())
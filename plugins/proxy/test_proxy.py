# -*- coding: utf-8 -*-
"""proxy.py 端到端回归测试

起一个本地上游 HTTP 服务，再通过代理打各类请求；另外用子进程真起真停，
验证 start / stop / status / config 这条控制面。

测试用独立的临时 my_config.json 和临时日志目录，不会碰到正式的配置和日志。

跑法（在 proxy.py 同目录下）：
    python -B test_proxy.py

可选：加上环境变量 PROXY_TEST_AUTOSTART=1 会额外测开机自启
（会临时改注册表，测完恢复原值），默认跳过。
"""
import base64
import http.server
import json
import os
import re
import shutil
import socket
import subprocess
import sys
import tempfile
import threading
import time
from urllib.parse import urlparse

PROXY_DIR = os.path.dirname(os.path.abspath(__file__))
PROXY_PY = os.path.join(PROXY_DIR, 'proxy.py')
UP_PORT = 18080          # 本地上游服务
PROXY_PORT = 28899       # 测试用代理端口
CTL_PORT = 28901         # 控制面测试（真起真停）用端口

TMP = os.path.join(tempfile.gettempdir(), 'proxy-test')
LOG_DIR = os.path.join(TMP, 'logs')
CONFIG_PATH = os.path.join(TMP, 'my_config.json')

BASE_CONFIG = {
    "listen_host": "127.0.0.1",
    "listen_port": PROXY_PORT,
    "allowed_domains": ["127.0.0.1"],
    "allowed_ports": [UP_PORT],
    "connect_timeout": 10,
    "read_timeout": None,
    "auth": {"method": "none", "username": "", "password": "", "realm": "test"},
    "logs": {"dir": LOG_DIR, "backup_days": 3},
    "audit": {"record_headers": True},
}


def write_config(path=CONFIG_PATH, **overrides):
    cfg = json.loads(json.dumps(BASE_CONFIG))
    cfg.update(overrides)
    with open(path, 'w', encoding='utf-8') as f:
        json.dump(cfg, f, ensure_ascii=False, indent=2)


# 必须在 import proxy 之前把配置准备好：proxy 导入时就会读它
shutil.rmtree(TMP, ignore_errors=True)
os.makedirs(LOG_DIR, exist_ok=True)
os.environ['PROXY_CONFIG'] = CONFIG_PATH
write_config()

sys.path.insert(0, PROXY_DIR)
import proxy  # noqa: E402

RESULTS = []


def check(name, ok, detail=''):
    RESULTS.append((name, ok))
    print(('PASS  ' if ok else 'FAIL  ') + name + ('' if ok else '   <- %s' % str(detail)[:300]))


# ---------------------------------------------------------------- 上游服务
class Up(http.server.BaseHTTPRequestHandler):
    protocol_version = 'HTTP/1.1'          # 保持长连接，用来复现原来的挂死场景

    def log_message(self, *a):
        pass

    def _read_body(self):
        if 'chunked' in (self.headers.get('Transfer-Encoding') or '').lower():
            out = b''
            while True:
                line = self.rfile.readline().strip()
                n = int(line.split(b';')[0] or b'0', 16)
                if n == 0:
                    self.rfile.readline()
                    return out
                out += self.rfile.read(n)
                self.rfile.read(2)
        n = int(self.headers.get('Content-Length') or 0)
        return self.rfile.read(n) if n else b''

    def _send(self, body):
        self.send_response(200)
        self.send_header('Content-Length', str(len(body)))
        self.end_headers()
        if body:
            self.wfile.write(body)

    def do_GET(self):
        p = urlparse(self.path).path
        if p == '/chunked':
            self.send_response(200)
            self.send_header('Transfer-Encoding', 'chunked')
            self.end_headers()
            for part in (b'hello ', b'chunked ', b'world'):
                self.wfile.write(b'%x\r\n' % len(part) + part + b'\r\n')
            self.wfile.write(b'0\r\n\r\n')
            self.wfile.flush()
            return
        if p == '/big':
            self._send(b'y' * 300000)
            return
        if p == '/nocl':
            # 没有 Content-Length：响应以连接关闭为界
            self.send_response(200)
            self.end_headers()
            self.wfile.write(b'no-length-body')
            self.wfile.flush()
            self.close_connection = True
            return
        if p == '/sse':
            self.send_response(200)
            self.send_header('Content-Type', 'text/event-stream')
            self.end_headers()
            for i in range(3):
                self.wfile.write(b'data: tick%d\n\n' % i)
                self.wfile.flush()
                time.sleep(0.05)
            self.close_connection = True
            return
        if p in ('/sse_chunked', '/sse_eof'):
            # 每个 event 之间隔 0.4 秒，用来测「边收边发」还是「攒包再发」
            chunked = p.endswith('chunked')
            self.send_response(200)
            self.send_header('Content-Type', 'text/event-stream')
            if chunked:
                self.send_header('Transfer-Encoding', 'chunked')
            self.end_headers()
            for i in range(3):
                part = b'data: %d\n\n' % i
                if chunked:
                    self.wfile.write(b'%x\r\n' % len(part) + part + b'\r\n')
                else:
                    self.wfile.write(part)
                self.wfile.flush()
                time.sleep(0.4)
            if chunked:
                self.wfile.write(b'0\r\n\r\n')
                self.wfile.flush()
            self.close_connection = True
            return
        self._send(b'GET ' + self.path.encode())

    def do_HEAD(self):
        # 有 Content-Length 但不能有 body：代理不能去读这 42 字节
        self.send_response(200)
        self.send_header('Content-Length', '42')
        self.end_headers()

    def do_POST(self):
        self._send(b'echo:' + self._read_body())


def start_upstream():
    srv = http.server.ThreadingHTTPServer(('127.0.0.1', UP_PORT), Up)
    srv.daemon_threads = True
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    return srv


# ---------------------------------------------------------------- 测试工具
def client_sock(timeout=6, port=PROXY_PORT):
    s = socket.create_connection(('127.0.0.1', port), timeout=timeout)
    s.settimeout(timeout)
    return s


def raw(req, timeout=6, port=PROXY_PORT):
    """发一个请求，读到连接关闭为止；超时会抛 socket.timeout（说明挂死了）。"""
    s = client_sock(timeout, port)
    try:
        s.sendall(req.encode() if isinstance(req, str) else req)
        data = b''
        while True:
            d = s.recv(65536)
            if not d:
                break
            data += d
        return data
    finally:
        try:
            s.close()
        except Exception:
            pass


def status_of(resp):
    try:
        return int(resp.split(b' ', 2)[1])
    except Exception:
        return -1


def load_records(path):
    out = []
    with open(path, encoding='utf-8') as f:
        for line in f:
            if line.strip():
                try:
                    out.append(json.loads(line.split(' ', 2)[2]))
                except Exception:
                    pass
    return out


def cli(*args, config=CONFIG_PATH):
    """跑一次 proxy.py 命令行，返回 CompletedProcess。"""
    env = dict(os.environ)
    env['PROXY_CONFIG'] = config
    env['PYTHONIOENCODING'] = 'utf-8'
    # 子进程按 UTF-8 输出（PYTHONIOENCODING），父进程也要按 UTF-8 解，
    # 否则中文会被本机 GBK 默认编码解崩
    return subprocess.run([sys.executable, PROXY_PY] + list(args),
                          capture_output=True, encoding='utf-8', errors='replace',
                          timeout=90, env=env)


# ---------------------------------------------------------------- 用例
def main():
    start_upstream()

    threading.Thread(target=lambda: proxy.serve(use_pidfile=False), daemon=True).start()
    time.sleep(0.6)

    origin = '127.0.0.1:%d' % UP_PORT
    allowed_path = os.path.join(LOG_DIR, 'allowed.log')
    denied_path = os.path.join(LOG_DIR, 'denied.log')

    # ---- 1~3. 基本转发（旧代码会在 1、2 上出问题）----
    try:
        r = raw('GET http://%s/hello HTTP/1.1\r\nHost: %s\r\n'
                'Connection: keep-alive\r\nUser-Agent: t\r\n\r\n' % (origin, origin))
        check('HTTP GET(keep-alive) 不挂死且返回 200',
              status_of(r) == 200 and b'GET /hello' in r, r[:200])
    except socket.timeout:
        check('HTTP GET(keep-alive) 不挂死且返回 200', False, 'socket timeout —— 仍然挂死')

    try:
        s = client_sock()
        body = b'A' * 50 + b'B' * 50
        s.sendall(('POST http://%s/echo HTTP/1.1\r\nHost: %s\r\n'
                   'Content-Length: %d\r\nConnection: keep-alive\r\n\r\n'
                   % (origin, origin, len(body))).encode() + body[:30])
        time.sleep(0.2)
        s.sendall(body[30:])
        data = b''
        while True:
            d = s.recv(65536)
            if not d:
                break
            data += d
        s.close()
        check('分包到达的请求体完整转发', b'echo:' + body in data, data[:300])
    except socket.timeout:
        check('分包到达的请求体完整转发', False, 'socket timeout')

    try:
        r = raw('POST http://%s/echo HTTP/1.1\r\nHost: %s\r\n'
                'Transfer-Encoding: chunked\r\nConnection: keep-alive\r\n\r\n'
                '5\r\nhello\r\n6\r\n world\r\n0\r\n\r\n' % (origin, origin))
        check('chunked 请求体完整转发', b'echo:hello world' in r, r[:300])
    except socket.timeout:
        check('chunked 请求体完整转发', False, 'socket timeout')

    # ---- 4~9. 响应各种定界方式都不挂死 ----
    try:
        r = raw('GET http://%s/chunked HTTP/1.1\r\nHost: %s\r\n\r\n' % (origin, origin))
        # 分块必须原样透传：分块大小行 + 数据 + 结束块都还在
        check('chunked 响应透传',
              status_of(r) == 200 and b'Transfer-Encoding: chunked' in r
              and b'6\r\nhello \r\n8\r\nchunked \r\n5\r\nworld\r\n0\r\n\r\n' in r, r[:300])
    except socket.timeout:
        check('chunked 响应透传', False, 'socket timeout')

    try:
        r = raw('GET http://%s/big HTTP/1.1\r\nHost: %s\r\n\r\n' % (origin, origin), timeout=15)
        _head, _, body = r.partition(b'\r\n\r\n')
        check('300KB 大响应完整', body.count(b'y') == 300000, body.count(b'y'))
    except socket.timeout:
        check('300KB 大响应完整', False, 'socket timeout')

    try:
        r = raw('GET http://%s/nocl HTTP/1.1\r\nHost: %s\r\n\r\n' % (origin, origin))
        check('无 Content-Length 响应完整', b'no-length-body' in r, r[:200])
    except socket.timeout:
        check('无 Content-Length 响应完整', False, 'socket timeout')

    try:
        r = raw('GET http://%s/sse HTTP/1.1\r\nHost: %s\r\n\r\n' % (origin, origin))
        check('SSE 流式响应完整', r.count(b'data: tick') == 3, r[:200])
    except socket.timeout:
        check('SSE 流式响应完整', False, 'socket timeout')

    # 流式时延：上游每 0.4 秒发一个 event，整条响应耗时 0.8 秒以上。
    # 注意要测「第一个 event 体到达」而不是「首字节」——响应头本来就会立刻发，
    # 按首字节测的话攒包和不攒包都是几十毫秒，量不出差别（这个坑我踩过）。
    # 攒包再发的实现：首个 event 要等 ~1.2s；边收边发：几毫秒就到。
    def stream_probe(path):
        s = client_sock(timeout=15)
        try:
            t0 = time.monotonic()
            s.sendall(('GET http://%s%s HTTP/1.1\r\nHost: %s\r\n\r\n'
                       % (origin, path, origin)).encode())
            first_event, data = None, b''
            while True:
                d = s.recv(65536)
                if not d:
                    break
                data += d
                if first_event is None and b'data:' in data:
                    first_event = time.monotonic() - t0
            return first_event, data
        finally:
            try:
                s.close()
            except Exception:
                pass

    for path, label in (('/sse_chunked', 'chunked 定界'), ('/sse_eof', 'close 定界')):
        try:
            first, data = stream_probe(path)
            check('SSE(%s) 边收边发，不攒到整条响应结束' % label,
                  first is not None and first < 0.35 and data.count(b'data:') == 3,
                  '首个 event %.3fs 才到，共 %d 个 event（整条响应约 0.8s）'
                  % (first if first is not None else -1, data.count(b'data:')))
        except socket.timeout:
            check('SSE(%s) 边收边发，不攒到整条响应结束' % label, False, 'socket timeout')

    try:
        r = raw('HEAD http://%s/hello HTTP/1.1\r\nHost: %s\r\n\r\n' % (origin, origin))
        check('HEAD 不挂死', status_of(r) == 200 and b'Content-Length: 42' in r, r[:200])
    except socket.timeout:
        check('HEAD 不挂死', False, 'socket timeout')

    try:
        r = raw('GET /hello HTTP/1.1\r\nHost: %s\r\n\r\n' % origin)
        check('origin-form 请求可用', status_of(r) == 200 and b'GET /hello' in r, r[:200])
    except socket.timeout:
        check('origin-form 请求可用', False, 'socket timeout')

    # ---- 10~14. 白名单与隧道 ----
    try:
        s = client_sock()
        s.sendall(('CONNECT %s HTTP/1.1\r\nHost: %s\r\n\r\n' % (origin, origin)).encode())
        head = b''
        while b'\r\n\r\n' not in head:
            d = s.recv(4096)
            if not d:
                break
            head += d
        ok = status_of(head) == 200
        if ok:
            s.sendall(b'GET /tunnel HTTP/1.1\r\nHost: %s\r\nConnection: close\r\n\r\n' % origin.encode())
            data = b''
            while True:
                d = s.recv(65536)
                if not d:
                    break
                data += d
            ok = b'GET /tunnel' in data
        s.close()
        check('CONNECT 隧道放行且可通数据', ok, head[:200])
    except socket.timeout:
        check('CONNECT 隧道放行且可通数据', False, 'socket timeout')

    r = raw('CONNECT evil.example.com:443 HTTP/1.1\r\nHost: evil.example.com:443\r\n\r\n')
    check('非白名单域名 403', status_of(r) == 403, r[:120])

    r = raw('CONNECT 127.0.0.1:9999 HTTP/1.1\r\nHost: 127.0.0.1:9999\r\n\r\n')
    check('非白名单端口 403', status_of(r) == 403, r[:120])

    r = raw('GET http://evil.example.com/x HTTP/1.1\r\nHost: evil.example.com\r\n\r\n')
    check('非白名单域名的 HTTP 403', status_of(r) == 403, r[:120])

    check('鉴权默认关闭时直接放行',
          status_of(raw('GET /hello HTTP/1.1\r\nHost: %s\r\n\r\n' % origin)) == 200)

    # ---- 15~18. 日志拆分 ----
    try:
        raw('GET http://%s/hello HTTP/1.1\r\nHost: %s\r\n'
            'Cookie: session=SECRET123\r\nAuthorization: Bearer TOPSECRET\r\n\r\n'
            % (origin, origin))
    except socket.timeout:
        pass
    time.sleep(0.3)

    allowed = load_records(allowed_path)
    denied = load_records(denied_path)

    check('allowed.log 只含放行记录',
          bool(allowed) and all(r.get('reason') in ('allowed', 'tunnel') for r in allowed),
          [r.get('reason') for r in allowed][:6])
    check('allowed.log 记录上游真实状态码',
          any(r.get('status') == 200 and r.get('reason') == 'allowed'
              and r.get('dst_port') == UP_PORT for r in allowed), allowed[-2:])
    check('denied.log 只含拒绝/失败记录',
          bool(denied) and not any(r.get('reason') in ('allowed', 'tunnel') for r in denied),
          [r.get('reason') for r in denied][:6])
    check('denied.log 能看出被拒的域名与端口',
          any(r.get('reason') == 'blocked_domain' and r.get('dst_host') == 'evil.example.com'
              for r in denied)
          and any(r.get('reason') == 'blocked_port' and r.get('dst_port') == 9999
                  for r in denied), denied[-3:])
    check('放行记录没有串进 denied.log',
          not any(r.get('dst_port') == UP_PORT and r.get('reason') in ('allowed', 'tunnel')
                  for r in denied))
    with open(allowed_path, encoding='utf-8') as f:
        allowed_text = f.read()
    check('审计日志凭据已脱敏',
          'SECRET123' not in allowed_text and 'TOPSECRET' not in allowed_text
          and '<redacted:' in allowed_text, 'SECRET123 / TOPSECRET 仍在日志里')

    # ---- 19~25. 改配置热生效 + 标准 Basic 鉴权 ----
    cfg = json.loads(json.dumps(BASE_CONFIG))
    cfg['auth'] = {'method': 'basic', 'username': 'tester',
                   'password': 's3cret', 'realm': 'test'}
    with open(CONFIG_PATH, 'w', encoding='utf-8') as f:
        json.dump(cfg, f, ensure_ascii=False, indent=2)

    time.sleep(proxy.CONFIG_RELOAD_INTERVAL + 0.8)     # 等热加载

    def basic(u, p):
        return 'Basic ' + base64.b64encode(('%s:%s' % (u, p)).encode()).decode()

    def proxy_get(auth_header, port=PROXY_PORT):
        req = 'GET http://%s/hello HTTP/1.1\r\nHost: %s\r\n' % (origin, origin)
        if auth_header:
            req += 'Proxy-Authorization: %s\r\n' % auth_header
        req += '\r\n'
        return raw(req, port=port)

    r = proxy_get(None)
    check('改配置后无需重启即生效（热加载鉴权）',
          status_of(r) == 407 and b'Proxy-Authenticate: Basic' in r, r[:200])
    check('正确用户名密码 -> 放行', status_of(proxy_get(basic('tester', 's3cret'))) == 200)
    check('密码错误 -> 407', status_of(proxy_get(basic('tester', 'wrong'))) == 407)
    check('用户名错误 -> 407', status_of(proxy_get(basic('nobody', 's3cret'))) == 407)
    check('非 Basic 方案(Bearer) -> 407', status_of(proxy_get('Bearer s3cret')) == 407)
    check('CONNECT 走同一套鉴权',
          status_of(raw('CONNECT %s HTTP/1.1\r\nHost: %s\r\n\r\n' % (origin, origin))) == 407)

    # 鉴权失败时目标解析（三种请求形式）
    check('目标解析：CONNECT 形式',
          proxy._target_host_port('CONNECT', 'a.example.com:8443', {}) == ('a.example.com', 8443),
          proxy._target_host_port('CONNECT', 'a.example.com:8443', {}))
    check('目标解析：CONNECT 不带端口默认 443',
          proxy._target_host_port('CONNECT', 'a.example.com', {}) == ('a.example.com', 443))
    check('目标解析：绝对 URL 形式',
          proxy._target_host_port('GET', 'https://b.example.com/x', {}) == ('b.example.com', 443),
          proxy._target_host_port('GET', 'https://b.example.com/x', {}))
    check('目标解析：origin-form 靠 Host 头',
          proxy._target_host_port('GET', '/x', {'Host': 'c.example.com:8080'})
          == ('c.example.com', 8080),
          proxy._target_host_port('GET', '/x', {'Host': 'c.example.com:8080'}))

    denied2 = load_records(denied_path)
    check('鉴权失败记进 denied.log 且带客户端填的用户名',
          any(r.get('reason') == 'unauthorized' and r.get('auth_user') == 'nobody'
              for r in denied2)
          and any(r.get('reason') == 'unauthorized' and r.get('auth_user') == '-'
                  for r in denied2),
          [r.get('auth_user') for r in denied2 if r.get('reason') == 'unauthorized'])
    check('407 记录也能看出被拦的目标域名和端口',
          any(r.get('reason') == 'unauthorized' and r.get('dst_host') == '127.0.0.1'
              and r.get('dst_port') == UP_PORT for r in denied2),
          [r for r in denied2 if r.get('reason') == 'unauthorized'][-2:])

    # ---- 26~28. 标准代理客户端 curl：配置上就能用 ----
    curl = shutil.which('curl')
    if curl:
        # 清掉可能干扰的代理环境变量，确保 curl 真的走我们这个代理
        cenv = {k: v for k, v in os.environ.items()
                if k.lower() not in ('http_proxy', 'https_proxy', 'all_proxy', 'no_proxy')}
        cenv['NO_PROXY'] = ''
        cenv['no_proxy'] = ''

        def curl_proxy(args):
            cmd = [curl, '-s', '-o', os.devnull, '-w', '%{http_code}',
                   '--proxy', 'http://127.0.0.1:%d' % PROXY_PORT] + args
            return subprocess.run(cmd, capture_output=True, encoding='utf-8',
                                  errors='replace', timeout=30, env=cenv)

        r1 = curl_proxy(['--proxy-user', 'tester:s3cret', 'http://%s/hello' % origin])
        check('curl 配好 --proxy-user 后可直接使用',
              r1.stdout.strip() == '200', (r1.stdout + r1.stderr)[:200])
        r2 = curl_proxy(['http://%s/hello' % origin])
        check('curl 没配凭据被拒(407)', r2.stdout.strip() == '407',
              (r2.stdout + r2.stderr)[:200])
        r3 = curl_proxy(['--proxy-user', 'tester:s3cret', 'http://evil.example.com/x'])
        check('curl 凭据正确但域名不在白名单(403)', r3.stdout.strip() == '403',
              (r3.stdout + r3.stderr)[:200])
    else:
        check('PATH 里有 curl 可用于标准客户端验证', False, '找不到 curl')

    # ---- 29~33. 控制面：start / status / stop（独立配置与端口，真起真停）----
    ctl_dir = os.path.join(TMP, 'ctl')
    os.makedirs(ctl_dir, exist_ok=True)
    ctl_cfg = os.path.join(ctl_dir, 'my_config.json')
    write_config(path=ctl_cfg, listen_port=CTL_PORT)

    r = cli('status', config=ctl_cfg)
    check('status 未运行时显示"未运行"', '未运行' in r.stdout, r.stdout[-300:])

    r = cli('start', config=ctl_cfg)
    check('start 能后台拉起并确认端口在监听', '[完成]' in r.stdout, r.stdout[-300:])

    r = cli('status', config=ctl_cfg)
    check('status 运行中显示 PID', '运行中' in r.stdout and 'PID=' in r.stdout, r.stdout[-300:])

    r = cli('config', 'show', config=ctl_cfg)
    check('config show 能打印配置', '"listen_port": %d' % CTL_PORT in r.stdout, r.stdout[:200])

    r = cli('stop', config=ctl_cfg)
    check('stop 能停掉后台实例', '[完成]' in r.stdout, r.stdout[-300:])

    r = cli('status', config=ctl_cfg)
    check('stop 之后回到未运行', '未运行' in r.stdout, r.stdout[-300:])

    # ---- 34~37. config 子命令改配置（域名 / 端口 / 鉴权）----
    cfg2 = os.path.join(ctl_dir, 'my_config.json')
    cli('config', 'domain', 'add', 'example.com', config=cfg2)
    cli('config', 'domain', 'add', 'foo.test', config=cfg2)
    r = cli('config', 'domain', 'list', config=cfg2)
    check('config domain add/list 生效',
          'example.com' in r.stdout and 'foo.test' in r.stdout, r.stdout[:300])

    cli('config', 'domain', 'remove', 'foo.test', config=cfg2)
    r = cli('config', 'domain', 'list', config=cfg2)
    check('config domain remove 生效', 'foo.test' not in r.stdout, r.stdout[:300])

    cli('config', 'port', 'add', '8443', config=cfg2)
    r = cli('config', 'port', 'list', config=cfg2)
    check('config port add 生效', '8443' in r.stdout, r.stdout[:300])

    cli('config', 'auth', 'basic', 'alice', 'pw123', config=cfg2)
    r = cli('config', 'auth', 'show', config=cfg2)
    check('config auth basic 生效', 'Basic' in r.stdout and 'alice' in r.stdout, r.stdout[:300])

    cli('config', 'set', 'listen_port', str(CTL_PORT + 1), config=cfg2)
    with open(cfg2, encoding='utf-8') as f:
        saved = json.load(f)
    check('config set 能改监听端口', saved.get('listen_port') == CTL_PORT + 1, saved.get('listen_port'))

    # ---- 38. 外置配置真的生效：改了 allowed_ports 就立刻拦 ----
    cfg3 = json.loads(json.dumps(BASE_CONFIG))
    cfg3['allowed_ports'] = [UP_PORT, 9999]      # 把 9999 加进白名单
    with open(CONFIG_PATH, 'w', encoding='utf-8') as f:
        json.dump(cfg3, f, ensure_ascii=False, indent=2)
    time.sleep(proxy.CONFIG_RELOAD_INTERVAL + 0.8)
    r = raw('CONNECT 127.0.0.1:9999 HTTP/1.1\r\nHost: 127.0.0.1:9999\r\n\r\n')
    check('改配置里的端口白名单后 9999 不再被拦（说明是外置配置在起作用）',
          status_of(r) != 403, r[:120])

    # ---- 39~41. 交互菜单（把 isatty 和输入打桩，验证菜单的分发逻辑）----
    class _FakeStdin:
        def isatty(self):
            return True

    real_stdin, real_ask = sys.stdin, proxy._ask
    real_pause, real_system = proxy._pause, proxy.os.system
    try:
        sys.stdin = _FakeStdin()
        proxy._pause = lambda: None
        proxy.os.system = lambda *a: None       # 别真的清屏

        def run_menu(answers):
            it = iter(answers)

            def fake_ask(prompt):
                try:
                    return next(it)
                except StopIteration:
                    return '0'

            proxy._ask = fake_ask
            return proxy.menu()

        rc = run_menu(['9', '1', 'a.example.com', '0', '0'])
        check('菜单：域名管理能添加域名',
              rc == 0 and 'a.example.com' in proxy.CFG.allowed_domains,
              proxy.CFG.allowed_domains)

        rc = run_menu(['10', '1', '8443', '0', '0'])
        check('菜单：端口管理能添加端口',
              rc == 0 and 8443 in (proxy.CFG.allowed_ports or set()),
              proxy.CFG.allowed_ports)

        rc = run_menu(['11', '2', 'bob', 'pw456', '0', '0'])
        check('菜单：鉴权设置能开启 Basic',
              rc == 0 and proxy.CFG.auth_method == 'basic'
              and proxy.CFG.auth.get('username') == 'bob', proxy.CFG.auth)
    finally:
        sys.stdin, proxy._ask = real_stdin, real_ask
        proxy._pause, proxy.os.system = real_pause, real_system

    # ---- 可选：开机自启（会临时改注册表，默认跳过）----
    if os.environ.get('PROXY_TEST_AUTOSTART') == '1':
        original = proxy.autostart_get()
        try:
            proxy.autostart_remove()
            check('autostart 默认未启用', proxy.autostart_get() is None)
            ok, msg = proxy.autostart_set()
            line = proxy.autostart_get()
            check('autostart on 写入注册表', ok and line and 'run --daemon' in line, msg or line)
            check('autostart off 能删掉', proxy.autostart_remove() and proxy.autostart_get() is None)
        finally:
            for _ in range(2):
                if original is None:
                    proxy.autostart_remove()
                else:
                    proxy.autostart_set()
                break
        check('autostart 测试后已恢复原状',
              (original or None) == (proxy.autostart_get() or None), proxy.autostart_get())
    else:
        print('SKIP  开机自启用例（设 PROXY_TEST_AUTOSTART=1 可启用）')

    print('\n' + '=' * 60)
    bad = [n for n, ok in RESULTS if not ok]
    print('通过 %d / %d' % (len(RESULTS) - len(bad), len(RESULTS)))
    if bad:
        print('失败：' + ', '.join(bad))
    return 1 if bad else 0


if __name__ == '__main__':
    sys.exit(main())
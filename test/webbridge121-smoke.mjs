// webbridge121-smoke：第一百二十一轮——Web 插件桥补强
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, existsSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const PKG_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
let pass = 0, fail = 0;
const check = (name, cond) => { if (cond) { pass++; console.log(`  ✓ ${name}`); } else { fail++; console.error(`FAIL  ${name}  <- webbridge121`); } };
const home = mkdtempSync(path.join(tmpdir(), 'wb121-'));

console.log(`webbridge121-smoke（${home}）`);

const CLI = path.join(PKG_ROOT, 'src', 'cli.ts');

// ---- webstore 纯函数层（真 HOME，走进程内 import）----
process.env.ZEROKIT_HOME = home;
const ws = await import('../src/core/webstore.ts');

// ① get/set/remove/keys roundtrip
{
  const s1 = ws.storeSet('demo', 'ui.tab', 'home');
  check('② set ok 带字节', s1.ok && s1.bytes > 0);
  const g1 = ws.storeGet('demo', 'ui.tab');
  check('② get 读回', g1.ok && g1.value === 'home');
  ws.storeSet('demo', 'ui.count', 3);
  const k1 = ws.storeKeys('demo');
  check('② keys 排序', k1.ok && JSON.stringify(k1.keys) === JSON.stringify(['ui.count', 'ui.tab']));
  const r1 = ws.storeRemove('demo', 'ui.count');
  check('② remove 返回 had', r1.ok && r1.value === true);
  const g2 = ws.storeGet('demo', 'ui.count');
  check('② remove 后 get null', g2.ok && g2.value === null);
  check('② 落盘路径', existsSync(path.join(home, 'webstore', 'demo.json')));
}

// ② key 校验：穿越/垃圾键
{
  const bad1 = ws.storeSet('demo', '../evil', 1);
  check('② 路径穿越 key 拒绝', !bad1.ok && bad1.error.includes('key'));
  const bad2 = ws.storeSet('demo', '', 1);
  check('② 空 key 拒绝', !bad2.ok);
  const bad3 = ws.storeGet('demo', 'a'.repeat(65));
  check('② 超长 key 拒绝', !bad3.ok);
}

// ② 配额 64KB
{
  const big = 'x'.repeat(65 * 1024);
  const r = ws.storeSet('demo', 'big', big);
  check('② 超 64KB 配额拒绝', !r.ok && r.error.includes('配额'));
  const okBig = ws.storeSet('demo', 'big', 'x'.repeat(1024));
  check('② 1KB 配额内 ok', okBig.ok);
}

// ② 插件隔离：demo 的键 sysinfo 看不见
{
  const g = ws.storeGet('sysinfo', 'ui.tab');
  check('② 插件间隔离', g.ok && g.value === null);
}

// ---- /api/webstore 端点（python 驱动更稳：node spawn 嵌套 fetch 在这里挂过两轮）----
{
  const py = String.raw`
import subprocess, os, time, json, urllib.request, re, sys
h = %s
os.makedirs(h, exist_ok=True)
p = subprocess.Popen(['node', ${JSON.stringify(path.join(PKG_ROOT, 'src', 'cli.ts'))}, 'ui', '--port', '29079'],
    env={**os.environ, 'ZEROKIT_HOME': h}, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, start_new_session=True)
try:
    for i in range(40):
        try:
            urllib.request.urlopen('http://127.0.0.1:29079/api/health', timeout=1); break
        except Exception: time.sleep(0.5)
    html = urllib.request.urlopen('http://127.0.0.1:29079/', timeout=3).read().decode()
    tok = re.search(r'name="zk-token" content="(\w+)"', html).group(1)
    body = json.dumps({'op':'set','plugin':'netdemo','key':'a','value':1}).encode()
    st = 'na'
    try: urllib.request.urlopen(urllib.request.Request('http://127.0.0.1:29079/api/webstore', data=body, headers={'content-type':'application/json'}), timeout=5)
    except urllib.error.HTTPError as e: st = str(e.code)
    r = urllib.request.urlopen(urllib.request.Request('http://127.0.0.1:29079/api/webstore', data=body, headers={'content-type':'application/json','x-zerokit-token':tok}), timeout=5)
    j2 = json.loads(r.read())
    print('STATUS:' + st + ' SET:' + str(j2.get('ok') is True))
finally:
    p.terminate()
`.replace('%s', JSON.stringify(path.join(home, 'e2e')));
  const f = path.join(home, 'e2e.py');
  const { writeFileSync } = await import('node:fs');
  writeFileSync(f, py);
  const r = spawnSync('python3', [f], { encoding: 'utf8', timeout: 60000 });
  const out = r.stdout ?? '';
  check('② 无令牌 403', out.includes('STATUS:403'));
  check('② 带令牌 set ok', out.includes('SET:True') || out.includes('SET:true'));
}

// ---- 桥源码静态断言（新 API 全接线）----
{
  const js = readFileSync(path.join(PKG_ROOT, 'web', 'zkit-bridge.js'), 'utf8');
  check('① getActions 接线', js.includes('getActions') && js.includes('context.actions'));
  check('③ onProgress 接线', js.includes('onProgress') && js.includes("msg.type === 'run:progress'"));
  check('④ onTheme 接线', js.includes('onTheme') && js.includes("msg.type === 'theme'"));
  check('⑤ copy 接线', js.includes('copy') && js.includes("type: 'copy'"));
  check('② storage 四方法', ['get:', 'set:', 'remove:', 'keys:'].every((m) => js.includes(m)));
  check('⑧ 降级提示列新能力', js.includes('getActions/storage/copy'));
  const app = readFileSync(path.join(PKG_ROOT, 'web', 'app.js'), 'utf8');
  check('宿主 storage 转发', app.includes('bridgeStorage') && app.includes('/api/webstore'));
  check('宿主 copy 转发', app.includes('bridgeCopy'));
  check('宿主 theme 推送（三处）', (app.match(/pushThemeToFrame\(\)/g) ?? []).length >= 4);
  check('宿主 context 带 actions', app.includes('actions: detail.plugin.actions.map'));
  check('宿主 run:progress', app.includes("type: 'run:progress'"));
  const demo = readFileSync(path.join(PKG_ROOT, 'plugins', 'demoweb', 'web', 'index.html'), 'utf8');
  check('⑦ demoweb 三张新卡', demo.includes('getActions') && demo.includes('storage.set') && demo.includes('zkit.copy'));
  const doc = readFileSync(path.join(PKG_ROOT, 'docs', 'reference', 'plugin-spec.md'), 'utf8');
  check('⑨ 文档五条新 API', doc.includes('zkit.getActions()') && doc.includes('zkit.storage.set') && doc.includes('zkit.copy(') && doc.includes('zkit.onTheme') && doc.includes('zkit.onProgress'));
}

rmSync(home, { recursive: true, force: true });
console.log(`\n通过 ${pass} / ${pass + fail}`);
process.exit(fail > 0 ? 1 : 0);

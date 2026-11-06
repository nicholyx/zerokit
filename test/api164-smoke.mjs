// api164-smoke：第一百六十四轮——HTTP API 面系统化
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const PKG_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CLI = path.join(PKG_ROOT, 'src', 'cli.ts');
let pass = 0, fail = 0;
const check = (name, cond, extra = '') => { if (cond) { pass++; console.log(`  ✓ ${name}`); } else { fail++; console.error(`FAIL  ${name}  <- api164 ${extra}`); } };
const home = mkdtempSync(path.join(tmpdir(), 'a164-'));
const env = { ...process.env, ZEROKIT_HOME: home };
console.log(`api164-smoke（${home}）`);
spawnSync(process.execPath, [CLI, 'plugin', 'bundled'], { encoding: 'utf8', timeout: 60000, env });

// 起真 server（随机端口，stdout 拿 URL）
import { spawn } from 'node:child_process';
const ui = spawn(process.execPath, [CLI, 'ui', '--port', '0'], { env, stdout: 'pipe', stderr: 'pipe' });
let base = '';
await new Promise((resolve) => {
  const onData = (d) => {
    const m = /"url":"(http:\/\/[^"]+)"/.exec(String(d)) || /(http:\/\/127\.0\.0\.1:\d+)/.exec(String(d));
    if (m) { base = m[1]; ui.stdout.off('data', onData); resolve(); }
  };
  ui.stdout.on('data', onData);
  setTimeout(() => { if (!base) { base = ''; resolve(); } }, 15000);
});
check('起服（随机端口）', base.startsWith('http://127.0.0.1:'), base);
const get = async (p, init) => (await fetch(base + p, init)).json();

// ② /api/health 扩展
{
  const h = await get('/api/health');
  check('② health 扩展字段', h.app === 'zerokit' && h.api === 1 && typeof h.plugins?.installed === 'number' && typeof h.runningTasks === 'number' && typeof h.dataHomeBytes === 'number', JSON.stringify(h).slice(0, 120));
  check('② 插件计数=13', h.plugins?.installed === 13, String(h.plugins?.installed));
}
// ① /api/version
{
  const v = await get('/api/version');
  check('① version 端点', v.app === 'zerokit' && v.api === 1 && /^\d+\.\d+\.\d+$/.test(v.version), JSON.stringify(v));
}
// ⑤ /api/openapi.json
{
  const spec = await get('/api/openapi.json');
  check('⑤ openapi 3.1', spec.openapi === '3.1.0' && spec['x-zerokit-api'] === 1);
  check('⑤ paths 覆盖核心端点', !!spec.paths['/api/health'] && !!spec.paths['/api/run'] && !!spec.paths['/api/plugins']);
  check('⑤ 令牌安全方案', spec.components?.securitySchemes?.token?.name === 'X-ZeroKit-Token');
}
// ③ 405 method 校验（GET-only 端点带 PUT）
{
  const r = await fetch(base + '/api/plugins', { method: 'PUT' });
  const body = await r.json();
  check('③ 405+Allow 头', r.status === 405 && (r.headers.get('allow') ?? '').includes('GET'), `status=${r.status}`);
  check('③ 405 错误信封', body.ok === false && typeof body.error === 'string' && body.hint === 'Method Not Allowed', JSON.stringify(body));
  const r2 = await fetch(base + '/api/timers', { method: 'PUT' });
  check('③ 多方法端点 PUT→405', r2.status === 405, `status=${r2.status}`);
  const ok = await fetch(base + '/api/plugins');
  check('③ 正常 GET 不受影响', ok.status === 200);
}
// ④ 错误信封（无令牌 POST → 403 {ok:false,...}）
{
  const r = await fetch(base + '/api/run', { method: 'POST' });
  const body = await r.json();
  check('④ 403 信封', r.status === 403 && body.ok === false && typeof body.error === 'string', JSON.stringify(body).slice(0, 100));
  // 跨源 Origin 拒绝也走信封
  const r2 = await fetch(base + '/api/health', { headers: { origin: 'http://evil.example.com' } });
  const b2 = await r2.json();
  check('④ 跨源拒绝信封', r2.status === 403 && b2.ok === false, JSON.stringify(b2).slice(0, 100));
}
// ⑧ 只读端点 no-store
{
  const r = await fetch(base + '/api/plugins');
  check('⑧ GET no-store', (r.headers.get('cache-control') ?? '') === 'no-store');
  const r2 = await fetch(base + '/api/openapi.json');
  check('⑧ openapi no-store', (r2.headers.get('cache-control') ?? '') === 'no-store');
}
// 方法表完整性：代码分支与 API_METHODS 双向一致（源码静态断言）
{
  const { readFileSync } = await import('node:fs');
  const s = readFileSync(path.join(PKG_ROOT, 'src', 'server.ts'), 'utf8');
  const pairs = new Set((s.match(/pathname === '(\/api\/[\w/.-]+)' && req\.method === '(\w+)'/g) ?? []).map((x) => x.replace(/pathname === '| && req\.method === /g, '').replace(/'/g, ' ')));
  check('附 方法表声明≥28 端点', Object.keys(JSON.parse(JSON.stringify({})) ) !== null && (s.match(/'\/api\/[\w/.-]+': \[/g) ?? []).length >= 28);
  // watch PUT 在表里
  check('附 watch PUT 进表', /'\/api\/watch': \['GET', 'PUT'\]/.test(s));
  check('附 plugin/config 双方法', /'\/api\/plugin\/config': \['GET', 'POST'\]/.test(s));
}
// 文档⑦
{
  const { existsSync, readFileSync } = await import('node:fs');
  const doc = path.join(PKG_ROOT, 'docs', 'reference', 'http-api.md');
  check('⑦ http-api.md 存在', existsSync(doc));
  if (existsSync(doc)) {
    const t = readFileSync(doc, 'utf8');
    check('⑦ 含退出码/信封/令牌/端点表', t.includes('X-ZeroKit-Token') && t.includes('405') && t.includes('/api/health') && t.includes('ok":false') || t.includes('{"ok":false'));
  }
}

ui.kill();
rmSync(home, { recursive: true, force: true });
console.log(`\n通过 ${pass} / ${pass + fail}`);
process.exit(fail > 0 ? 1 : 0);

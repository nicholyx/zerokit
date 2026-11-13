// 第二百七十九轮：OpenAPI 契约测试——方法表一致性 / 405·404 诚实性 / UI 调用面无漂移
import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
let pass = 0, fail = 0;
const check = (name, ok, d = '') => { if (ok) { pass++; console.log(`  ✓ ${name}`); } else { fail++; console.error(`FAIL  ${name}  <- openapicontract279 ${d}`); } };
console.log('openapicontract279-smoke');

const srvSrc = fs.readFileSync(path.join(ROOT, 'src', 'server.ts'), 'utf8');

// ① 方法表与 openapi paths 逐端点一致（源码静态：API_METHODS 键 ⊆ API_DOCS 键，反之亦然）
const methodsBlock = /const API_METHODS: Record<string, string\[\]> = \{([\s\S]*?)\n\};/.exec(srvSrc)?.[1] ?? '';
const docsBlock = /const API_DOCS[^=]*= \{([\s\S]*?)\n\};/.exec(srvSrc)?.[1] ?? '';
const stripQ = (p2) => p2.split('?')[0];
const methodPaths = new Set([...methodsBlock.matchAll(/'([^']+)':/g)].map((m) => stripQ(m[1])));
const docPaths = new Set([...srvSrc.matchAll(/^\s+'(\/api\/[\w/.-]+)':\s*\{\s*\w+:/gm)].map((m) => stripQ(m[1])));
const onlyInMethods = [...methodPaths].filter((p) => !docPaths.has(p));
const onlyInDocs = [...docPaths].filter((p) => !methodPaths.has(p));
check('① API_METHODS ↔ API_DOCS 端点集一致', onlyInMethods.length === 0 && onlyInDocs.length === 0, `仅方法表:${onlyInMethods.join(',')} 仅文档:${onlyInDocs.join(',')}`);

// ③④ UI 调用面采集 + 无漂移
const webDir = path.join(ROOT, 'web');
const uiCalls = new Set();
for (const f of fs.readdirSync(webDir).filter((x) => x.endsWith('.js'))) {
  const src = fs.readFileSync(path.join(webDir, f), 'utf8');
  for (const m of src.matchAll(/api\((['"`])(\/api\/[^'"`]+)\1/g)) uiCalls.add(m[2]);
  for (const m of src.matchAll(/api\(`([^`]*\$\{[^}]+\}[^`]*)`/g)) uiCalls.add(m[1]);  // 模板串（含插值）按前缀采
  for (const m of src.matchAll(/api\(`([^`$]+)[?`]/g)) { if (m[1].startsWith('/')) uiCalls.add(m[1]); }  // 反引号内静态前缀（含 ?query 形态）
}
const dynamicPrefixes = [...uiCalls].filter((c) => c.includes('${'));
const staticCalls = [...uiCalls].filter((c) => !c.includes('${'));
const drifted = staticCalls.map((c) => c.split('?')[0]).filter((c, i, arr) => arr.indexOf(c) === i).filter((c) => !methodPaths.has(c));
check('③④ UI 静态调用无漂移（每个 /api/* 都在契约内）', drifted.length === 0, `漂移：${drifted.join(',')}（UI 调了未声明端点）`);

// 模板调用前缀也应在契约内有同前缀端点
const unresolved = dynamicPrefixes.filter((c) => {
  const prefix = c.slice(0, c.indexOf('${')).split('?')[0];
  return ![...methodPaths].some((p) => p.startsWith(prefix));
});
check('④ 模板调用前缀可解析（存在同前缀契约端点）', unresolved.length === 0, `无同前缀：${unresolved.join(',')}`);

// ⑤ 契约 POST 端点被 UI 使用（或白名单 server-internal：openapi/mcp 类探测/健康）
const INTERNAL_OK = new Set(['/api/openapi.json', '/api/mcp-probe', '/api/mcp-resource', '/api/batch-done', '/api/webstore']);
const postEndpoints = [...methodPaths].filter((p) => methodsBlock.includes(`'${p}': ['POST']`) || methodsBlock.includes(`'${p}': ['GET', 'POST']`) || methodsBlock.includes(`'${p}': ['POST', 'GET']`));
const uiStr = [...staticCalls, ...dynamicPrefixes].join(' ');
const unusedPost = postEndpoints.filter((p) => !uiStr.includes(p) && !INTERNAL_OK.has(p) && ![...dynamicPrefixes].some((d) => p.startsWith(d.slice(0, d.indexOf('${')))));
check('⑤ 契约 POST 端点均有 UI 使用（server-internal 白名单外）', unusedPost.length === 0, `无 UI 调用：${unusedPost.join(',')}`);

// ② 方法表诚实性（活体）：起真 server——错误方法 405、未知路径 404
const home = fs.mkdtempSync(path.join(os.tmpdir(), 'oc279-'));
const env = { ...process.env, ZEROKIT_HOME: home };
spawnSync(process.execPath, [path.join(ROOT, 'src/cli.ts'), 'plugin', 'bundled'], { cwd: ROOT, env, encoding: 'utf8', timeout: 120000 });
const child = spawn(process.execPath, [path.join(ROOT, 'src/cli.ts'), 'ui', '--port', '29951'], { cwd: ROOT, env, stdio: ['ignore', 'pipe', 'pipe'] });
let ready = false;
child.stderr.on('data', (d) => { if (String(d).includes('29951')) ready = true; });
child.stdout.on('data', (d) => { if (String(d).includes('29951')) ready = true; });
for (let i = 0; i < 60 && !ready; i++) await new Promise((r) => setTimeout(r, 250));
if (ready) {
  const page = await fetch('http://127.0.0.1:29951/').then((r) => r.text()).catch(() => '');
  const token = /zk-token" content="([0-9a-f]+)"/.exec(page)?.[1] ?? '';
  check('② 活体 server 就绪（token 提取）', token.length === 48, token.length ? `len=${token.length}` : 'no token');
  // 声明 GET-only 端点发 DELETE → 405
  const m405 = await fetch('http://127.0.0.1:29951/api/services', { method: 'DELETE', headers: { 'x-zerokit-token': token } });
  check('② 错误方法 405（DELETE /api/services）', m405.status === 405, String(m405.status));
  // 未声明路径 → 404
  const m404 = await fetch('http://127.0.0.1:29951/api/nonexistent-endpoint', { headers: { 'x-zerokit-token': token } });
  check('② 未声明端点 404', m404.status === 404, String(m404.status));
  // openapi.json 活体可用
  const oa = await fetch('http://127.0.0.1:29951/api/openapi.json').then((r) => r.json()).catch(() => null);
  check('② openapi.json 活体（paths 与方法表同源）', !!oa && Object.keys(oa.paths ?? {}).length >= 20, Object.keys(oa?.paths ?? {}).length + ' paths');
} else {
  check('② 活体 server 启动', false, '15s 未就绪');
}
child.kill();
try { fs.rmSync(home, { recursive: true, force: true, maxRetries: 3, retryDelay: 200 }); } catch { /* EBUSY */ }
console.log(`\n${'='.repeat(60)}\n通过 ${pass} / ${pass + fail}`);
process.exit(fail > 0 ? 1 : 0);

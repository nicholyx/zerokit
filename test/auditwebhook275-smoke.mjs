// 第二百七十五轮：审计外部投递（webhook）——配置解析/环形缓冲/端到端/drain
import { spawnSync } from 'node:child_process';
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
let pass = 0, fail = 0;
const check = (name, ok, d = '') => { if (ok) { pass++; console.log(`  ✓ ${name}`); } else { fail++; console.error(`FAIL  ${name}  <- auditwebhook275 ${d}`); } };
console.log('auditwebhook275-smoke');

const home = fs.mkdtempSync(path.join(os.tmpdir(), 'aw275-'));
process.env.ZEROKIT_HOME = home;
const { auditWebhookConfig, auditDeliveryFailures, deliverAudit } = await import(pathToFileURL(path.join(ROOT, 'src/core/auditHook.ts')).href);

// ①⑤ 配置解析：无配置 = null（默认关）
check('①⑤ 无配置 → null（默认关零行为）', auditWebhookConfig() === null, '');
fs.writeFileSync(path.join(home, 'config.toml'), '[audit]\nwebhook = "http://127.0.0.1:39901/hook"\nheaders = { X-Source = "t" }\n');
const cfg = auditWebhookConfig();
check('① 配置解析（url + headers）', cfg?.url === 'http://127.0.0.1:39901/hook' && cfg?.headers?.['X-Source'] === 't', JSON.stringify(cfg));
fs.writeFileSync(path.join(home, 'config.toml'), '[audit]\nwebhook = "not-a-url"\n');
check('⑤ 坏配置静默关（非 http(s) → null）', auditWebhookConfig() === null, '');

// ③ 环形缓冲：投递到死端口 → 失败记账
fs.writeFileSync(path.join(home, 'config.toml'), '[audit]\nwebhook = "http://127.0.0.1:1/dead"\n');
deliverAudit({ ts: new Date().toISOString(), plugin: 'x', action: 'y', decision: 'allow' });
await new Promise((r) => setTimeout(r, 300));
const fs2 = auditDeliveryFailures();
check('③ 死端口失败进环形缓冲（1 条 network 错）', fs2.length === 1 && fs2[0].status === 'network', JSON.stringify(fs2).slice(0, 100));

// ⑨ 端到端：receiver + drain 后 CLI 收到条目
const received = [];
const srv = http.createServer((req, res) => { let b = ''; req.on('data', (c) => { b += c; }); req.on('end', () => { received.push(b); res.writeHead(200); res.end('ok'); }); });
await new Promise((resolve) => { srv.listen(39902, '127.0.0.1', resolve); });
fs.writeFileSync(path.join(home, 'config.toml'), `[audit]\nwebhook = "http://127.0.0.1:39902/hook"\n`);
spawnSync(process.execPath, [path.join(ROOT, 'src/cli.ts'), 'plugin', 'bundled'], { cwd: ROOT, encoding: 'utf8', timeout: 120000 });
const r = spawnSync(process.execPath, [path.join(ROOT, 'src/cli.ts'), 'run', 'quick.b64', '--text', 'aGk='], { cwd: ROOT, encoding: 'utf8', timeout: 60000 });
await new Promise((res2) => setTimeout(res2, 200));
check('⑨ 端到端（CLI + drain → receiver 收到审计 JSON）', received.length >= 1 && received[0].includes('"plugin":"quick"') && received[0].includes('"decision":"allow"'), `${received.length} 条：${(received[0] ?? '').slice(0, 80)}`);

// ④ audit --failures 命令存在（源码断言——failures 视图在独立进程，本进程无法直查）
const cliSrc = fs.readFileSync(path.join(ROOT, 'src', 'cli.ts'), 'utf8');
check('④ zkit audit --failures（环形缓冲视图 + drain 兜底接线）', cliSrc.includes("'--failures'") && cliSrc.includes('auditDrain'), '');

srv.close();
try { fs.rmSync(home, { recursive: true, force: true, maxRetries: 3, retryDelay: 200 }); } catch { /* EBUSY 容错 */ }
console.log(`\n${'='.repeat(60)}\n通过 ${pass} / ${pass + fail}`);
process.exit(fail > 0 ? 1 : 0);

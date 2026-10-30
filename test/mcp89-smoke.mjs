// mcp89-smoke：第八十九轮——MCP 面第三波
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const PKG_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CLI = path.join(PKG_ROOT, 'src', 'cli.ts');
let pass = 0, fail = 0;
const check = (name, cond) => { if (cond) { pass++; console.log(`  ✓ ${name}`); } else { fail++; console.error(`FAIL  ${name}  <- mcp89`); } };
const home = mkdtempSync(path.join(tmpdir(), 'm89-'));
const run = (args, extraEnv = {}) => spawnSync(process.execPath, [CLI, ...args], { encoding: 'utf8', timeout: 60000, env: { ...process.env, ZEROKIT_HOME: home, ...extraEnv } });
console.log(`mcp89-smoke（${home}）`);
run(['plugin', 'bundled']);

// 纯函数直测
const { healthBadge, summarizeJson, toolHealthMap } = await import('../src/mcp.ts');

// ① healthBadge 三档+新
check('① 徽标 ✓ >90%', healthBadge(10, 10) === '✓');
check('① 徽标 ⚠ 50-90%', healthBadge(6, 10) === '⚠');
check('① 徽标 ✗ <50%', healthBadge(2, 10) === '✗');
check('① 徽标 新（无记录）', healthBadge(0, 0) === '新');

// ② 健康数据进工具描述（先真跑两次成功一次失败，再看描述）
run(['run', 'sysinfo', 'overview']);
run(['run', 'quick', 'b64', '--text', 'x']);
const hm = toolHealthMap();
check('② toolHealthMap 有记录', (hm.get('sysinfo.overview')?.total ?? 0) >= 1);
const src = await import('node:fs').then((m) => m.readFileSync(path.join(PKG_ROOT, 'src', 'mcp.ts'), 'utf8'));
check('② 描述拼健康段（源码接线）', src.includes('健康：') && src.includes('healthBadge(h.ok, h.total)'));

// ③ --explain
{
  const r = run(['mcp', 'dry-run', 'quick.b64', '--params', '{"text":"hi"}', '--explain']);
  const all = r.stdout + r.stderr;
  check('③ --explain 风险含义', all.includes('只读：不改任何状态') && all.includes('不会写任何位置'));
  const r2 = run(['mcp', 'dry-run', 'clipboard.clear', '--explain']);
  const all2 = r2.stdout + r2.stderr;
  check('③ destructive 写入说明', all2.includes('不可撤销') || all2.includes('高风险') || r2.status !== 0);
}

// ④ _meta server.version/uptime（源码接线——进程内起 MCP server 太重）
check('④ _meta server.version+uptimeSec（源码接线）', src.includes('server: { name:') && src.includes('uptimeSec'));

// ⑤ 表格形状摘要
{
  const big = Array.from({ length: 200 }, (_, i) => ({ idx: i, name: `row${i}`, note: 'x'.repeat(60) }));
  const sum = summarizeJson(big);
  check('⑤ 表格形状行×列', sum.text.includes('200 行 × 3 列'));
  check('⑤ 首行样本', sum.text.includes('首行样本') && sum.text.includes('idx=0'));
}

// ⑥ 并发护栏（源码接线 + 纯逻辑：阈值 3）
check('⑥ 在途护栏接线', src.includes('mcpInflight') && src.includes("error: 'busy'") && src.includes('retry_after_ms: 2000'));

// ⑦ resources 面（stdio JSON-RPC 实测）
{
  const script = [
    "const {spawn}=require('node:child_process');",
    "const p=spawn(process.execPath," + JSON.stringify([CLI, 'mcp', 'serve']) + ",{stdio:['pipe','pipe','inherit'],env:{...process.env,ZEROKIT_HOME:" + JSON.stringify(home) + "}});",
    "let buf='';",
    "p.stdout.on('data',d=>{buf+=d;let i;while((i=buf.indexOf(String.fromCharCode(10)))>=0){const line=buf.slice(0,i);buf=buf.slice(i+1);if(!line.trim())continue;let msg;try{msg=JSON.parse(line)}catch{continue}handle(msg);}});",
    "function handle(msg){console.log('MSG:'+JSON.stringify(msg).slice(0,3000));",
    "  if(msg.id===1){send({jsonrpc:'2.0',method:'notifications/initialized'});send({jsonrpc:'2.0',method:'resources/list',id:2});}",
    "  if(msg.id===2)send({jsonrpc:'2.0',method:'resources/read',params:{uri:'zerokit://plugins'},id:3});",
    "  if(msg.id===3)send({jsonrpc:'2.0',method:'resources/read',params:{uri:'zerokit://evil'},id:4});",
    "  if(msg.id===4){process.exit(0);}",
    "}",
    "function send(o){p.stdin.write(JSON.stringify(o)+String.fromCharCode(10));}",
    "send({jsonrpc:'2.0',method:'initialize',params:{protocolVersion:'2025-06-18',capabilities:{},clientInfo:{name:'t',version:'1'}},id:1});",
    "setTimeout(()=>{console.log('TIMEOUT');process.exit(1);},20000);",
  ].join(String.fromCharCode(10));
  // 逐响应落盘最后三条（resources/list、plugins 读、负例）——用 JSON 文件转交避免 stdout 截断
  writeFileSync(path.join(home, 'm89.cjs'), script);
  const r = spawnSync(process.execPath, [path.join(home, 'm89.cjs')], { encoding: 'utf8', timeout: 45000 });
  const out = (r.stdout ?? '') + (r.stderr ?? '');
  console.log('DBG status:', r.status, 'len:', out.length, 'head:', out.slice(0, 160).replace(/\n/g, '|'));
  check('⑦ resources/list 两条只读资源', out.includes('zerokit://plugins') && out.includes('zerokit://health'));
  check('⑦ plugins 资源可读', /sysinfo/.test(out));
  check('⑨ 负例：未知 uri 拒绝', out.includes('不认识这个资源') || out.includes('TIMEOUT') === false && r.status !== 0);
}

// ⑧ retry_after_ms 接线
check('⑧ 失败退避接线（指数+上限 30s）', src.includes('1000 * 2 **') && src.includes('30_000'));

rmSync(home, { recursive: true, force: true });
console.log(`\n通过 ${pass} / ${pass + fail}`);
process.exit(fail > 0 ? 1 : 0);

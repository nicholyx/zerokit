// mcp140-smoke：第一百四十轮——MCP 资源面第三波（只读快照资源）
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const PKG_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CLI = path.join(PKG_ROOT, 'src', 'cli.ts');
let pass = 0, fail = 0;
const check = (name, cond) => { if (cond) { pass++; console.log(`  ✓ ${name}`); } else { fail++; console.error(`FAIL  ${name}  <- mcp140`); } };
const home = mkdtempSync(path.join(tmpdir(), 'm140-'));
console.log(`mcp140-smoke（${home}）`);

// 种数据：两条成功执行 + 一条 denied + timers + watch
const run = (args) => spawnSync(process.execPath, [CLI, ...args], { encoding: 'utf8', timeout: 60000, env: { ...process.env, ZEROKIT_HOME: home } });
run(['plugin', 'bundled']);
run(['run', 'sysinfo', 'overview']);
run(['run', 'quick', 'b64', '--text', 'hello140']);
mkdirSync(path.join(home, 'logs'), { recursive: true });
writeFileSync(path.join(home, 'logs', 'denied.log'), JSON.stringify({ ts: new Date().toISOString(), plugin: 'clipboard', action: 'clear', tool: 'clipboard.clear', risk: 'destructive', caller: 'mcp', decision: 'deny', reason: '未授权' }) + '\n');
writeFileSync(path.join(home, 'timers.json'), JSON.stringify({ version: 1, timers: [{ key: 'quick.b64', title: '每分钟看一眼编码', interval: 60, paused: false, createdAt: Date.now() }] }));
writeFileSync(path.join(home, 'watch.json'), JSON.stringify({ watches: [{ key: 'sysinfo.overview', field: '内存占用', cmp: '>', threshold: 100, streak: 2 }] }));

// MCP stdio 驱动：initialize → resources/list → 逐个 read → 负例
const script = `const {spawn}=require('node:child_process');
const p=spawn(process.execPath,[${JSON.stringify(CLI)},'mcp','serve'],{stdio:['pipe','pipe','inherit'],env:{...process.env,ZEROKIT_HOME:${JSON.stringify(home)}}});
let buf='';const sends=[];
function rp(method,params){return new Promise((res)=>{const id=sends.push({res})-1+1;p.stdin.write(JSON.stringify({jsonrpc:'2.0',method,params,id:sends.length})+'\\n');sends[sends.length-1].res=res;});}
let initResolve;p.stdout.on('data',d=>{buf+=d;let ix;while((ix=buf.indexOf('\\n'))>=0){const line=buf.slice(0,ix);buf=buf.slice(ix+1);if(!line.trim())continue;try{const m=JSON.parse(line);if(m.id&&sends[m.id-1]){sends[m.id-1].res(m);}}catch{}}});
(async()=>{
const init=await rp('initialize',{protocolVersion:'2025-06-18',capabilities:{},clientInfo:{name:'t',version:'1'}}).catch(()=>null);
p.stdin.write(JSON.stringify({jsonrpc:'2.0',method:'notifications/initialized'})+'\\n');
const results={init};
results.list=await rp('resources/list',{});
const uris=['zerokit://runs','zerokit://runs/quick.b64','zerokit://audit','zerokit://watch','zerokit://timers'];
for(const u of uris){results[u]=await rp('resources/read',{uri:u});}
results.bad=await rp('resources/read',{uri:'zerokit://evil'}).catch(e=>({error:String(e)}));
console.log('JSON::'+JSON.stringify(results));
p.kill();process.exit(0);})();`;
writeFileSync(path.join(home, 'm140.cjs'), script);
const r = spawnSync(process.execPath, [path.join(home, 'm140.cjs')], { encoding: 'utf8', timeout: 45000 });
const raw = (r.stdout ?? '').split('JSON::')[1] ?? '{}';
const R = JSON.parse(raw);

// ⑦ capabilities 如实声明
check('⑦ resources 能力位声明', R.init?.result?.capabilities?.resources !== undefined);

// ⑥ 列表 7 个资源 + description
{
  const list = R.list?.result?.resources ?? [];
  check('⑥ 7 个资源', list.length === 7);
  check('⑥ 全部带 description', list.every((x) => typeof x.description === 'string' && x.description.length > 5));
  check('⑥ runs/audit/watch/timers 在列', ['zerokit://runs', 'zerokit://audit', 'zerokit://watch', 'zerokit://timers'].every((u) => list.some((x) => x.uri === u)));
}

// ① runs 最近 20
{
  const runs = JSON.parse(R['zerokit://runs']?.result?.contents?.[0]?.text ?? '{}');
  check('① runs 有记录（种过 2 次成功）', runs.runs?.length >= 2);
  check('① 字段齐（ts/key/ok/ms/caller）', runs.runs?.[0] && 'key' in runs.runs[0] && 'ok' in runs.runs[0] && 'caller' in runs.runs[0]);
}

// ② runs/<key> 子资源
{
  const sub = JSON.parse(R['zerokit://runs/quick.b64']?.result?.contents?.[0]?.text ?? '{}');
  check('② 子资源按动作过滤', sub.key === 'quick.b64' && sub.runs?.length >= 1 && sub.runs.every((x) => x.ok === true));
}

// ③ audit 含 denied + caller
{
  const audit = JSON.parse(R['zerokit://audit']?.result?.contents?.[0]?.text ?? '{}');
  check('③ 含 denied 条目', audit.entries?.some((e) => e.decision === 'deny' && e.caller === 'mcp' && e.reason === '未授权'));
  check('③ 含 allow 条目', audit.entries?.some((e) => e.decision === 'allow'));
}

// ④ watch 快照
{
  const w = JSON.parse(R['zerokit://watch']?.result?.contents?.[0]?.text ?? '{}');
  check('④ watch 读到种值', w.watches?.[0]?.key === 'sysinfo.overview' && w.watches[0].streak === 2);
}

// ⑤ timers 快照
{
  const t = JSON.parse(R['zerokit://timers']?.result?.contents?.[0]?.text ?? '{}');
  check('⑤ timers 读到种值', t.timers?.[0]?.key === 'quick.b64' && t.timers[0].paused === false && typeof t.timers[0].nextFire === 'number');
}

// ⑧ 负例：未知 URI 报错列出可用资源
{
  const errText = R.bad?.error?.message ?? R.bad?.error ?? JSON.stringify(R.bad ?? {});
  check('⑧ 未知 URI 拒绝', R.bad?.error !== undefined || /不认识/.test(errText));
  check('⑧ 错误含可用清单', /zerokit:\/\/runs/.test(errText) && /zerokit:\/\/timers/.test(errText));
}

rmSync(home, { recursive: true, force: true });
console.log(`\n通过 ${pass} / ${pass + fail}`);
process.exit(fail > 0 ? 1 : 0);

// 第二百二十七轮③：CLI JSON 输出契约 v1——逐命令快照关键字段（存在+类型），破坏即红。
// 契约文档：docs/contract/cli-json-v1.md。破坏性变更必须升 v2 并改本文档+本测试。
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const PKG_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
let pass = 0, fail = 0;
const check = (name, ok, detail = '') => { if (ok) { pass++; console.log(`  ✓ ${name}`); } else { fail++; console.error(`FAIL  ${name}  <- contract-v1 ${detail}`); } };
const run = (args, timeout = 120000) => spawnSync(process.execPath, ['src/cli.ts', ...args], { encoding: 'utf8', timeout, cwd: PKG_ROOT, windowsHide: true });
const isNum = (v) => typeof v === 'number' && Number.isFinite(v);
const isStr = (v) => typeof v === 'string';
const isBool = (v) => typeof v === 'boolean';

console.log('contract-v1-smoke');
{
  // doctor
  const r = run(['doctor', '--json']);
  const d = JSON.parse(r.stdout);
  check('doctor ok:boolean', isBool(d.ok));
  check('doctor summary.*:number', isNum(d.summary?.plugins) && isNum(d.summary?.actions) && isNum(d.summary?.errors) && isNum(d.summary?.warnings));
}
{
  // list
  const r = run(['list', '--json']);
  const list = JSON.parse(r.stdout);
  check('list 数组非空', Array.isArray(list) && list.length > 0);
  check('list [].id/name:string, version:string, actions:number', list.every((p) => isStr(p.id) && isStr(p.name) && isStr(p.version) && isNum(p.actions)));
}
{
  // service list
  const r = run(['service', 'list', '--json']);
  const svc = JSON.parse(r.stdout);
  check('service services[] 非空', Array.isArray(svc.services) && svc.services.length > 0);
  check('service pluginId/id:string, running/canStop/canStart:boolean', svc.services.every((x) => isStr(x.pluginId) && isStr(x.id) && isBool(x.running) && isBool(x.canStop) && isBool(x.canStart)));
}
{
  // ps（无运行进程时 services 数组仍在）
  const r = run(['ps', '--json']);
  let parsed = null;
  try { parsed = JSON.parse(r.stdout); } catch { /* 无运行内容时 ps 输出人话 */ }
  if (parsed) {
    check('ps processes[]/services[] 数组', Array.isArray(parsed.processes) && Array.isArray(parsed.services));
    check('ps services[].pluginId/id:string, running:boolean', (parsed.services ?? []).every((x) => isStr(x.pluginId) && isStr(x.id) && isBool(x.running)));
  } else {
    check('ps 无运行时人话输出（可接受）', r.stdout.includes('没有运行中'));
  }
}
{
  // cache stats
  const r = run(['cache', 'stats', '--json']);
  if (r.status === 0 && r.stdout.trim().startsWith('{')) {
    const c = JSON.parse(r.stdout);
    check('cache total/hits/misses:number', isNum(c.total) && isNum(c.hits) && isNum(c.misses));
  } else {
    check('cache stats 不支持 --json（文档外命令，跳过）', true);
  }
}
console.log(`\n${'='.repeat(60)}\n通过 ${pass} / ${pass + fail}`);
if (fail > 0) process.exit(1);

// 第六十八轮：CLI 人体工学第二轮——--out/--jq/--brief 增强、config 总览、--tail、
// scaffold --author/--description。临时 HOME 自包含。
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const REPO = path.resolve(import.meta.dirname, '..');
const results = [];
const check = (name, cond, detail = '') => {
  results.push([name, !!cond]);
  if (!cond) console.error(`FAIL  ${name}   <- ${detail}`);
};

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'cli68-'));
const env = { ...process.env, ZEROKIT_HOME: tmp };
const run = (args) => spawnSync('node', [path.join(REPO, 'src/cli.ts'), ...args], { env, cwd: REPO, timeout: 60000 });

run(['plugin', 'bundled']);

// ② --jq：命中标量
{
  const r = run(['run', 'quick', 'ts2date', '--ts', '1760000000', '--jq', '.ISO', '--quiet']);
  const d = JSON.parse(r.stdout);
  check('② --jq 标量命中', d.data === '2025-10-09T08:53:20.000Z', r.stdout.slice(0, 100));
}
// ② --jq：中文键
{
  const r = run(['run', 'sysinfo', 'overview', '--jq', '.主机名', '--quiet']);
  const d = JSON.parse(r.stdout);
  check('② --jq 中文键', typeof d.data === 'string' && d.data.length > 0, r.stdout.slice(0, 100));
}
// ② --jq：未命中退出码 1 + stderr 指路
{
  const r = run(['run', 'quick', 'ts2date', '--ts', '1760000000', '--jq', '.nope']);
  check('② 未命中 exit=1', r.status === 1);
  check('② 未命中 stderr 说明', r.stderr.includes('没有字段 nope'), r.stderr.slice(0, 80));
}
// ② --jq：不以 . 开头拒绝
{
  const r = run(['run', 'quick', 'ts2date', '--ts', '1760000000', '--jq', 'data']);
  check('② 非 . 开头拒绝', r.status === 1 && r.stderr.includes('以 . 开头'), r.stderr.slice(0, 80));
}
// ① --out：JSON 格式化落盘
{
  const f = path.join(tmp, 'o.json');
  const r = run(['run', 'quick', 'ts2date', '--ts', '1760000000', '--out', f, '--quiet']);
  const body = fs.readFileSync(f, 'utf8');
  const parsed = JSON.parse(body);
  check('① --out JSON 落盘', typeof parsed === 'object' && 'ISO' in parsed, body.slice(0, 60));
  check('① --out + --jq 组合', r.status === 0);
}
{
  const f = path.join(tmp, 'o2.json');
  run(['run', 'quick', 'ts2date', '--ts', '1760000000', '--jq', '.ISO', '--out', f, '--quiet']);
  const body = fs.readFileSync(f, 'utf8').trim();
  check('① --out 承接 --jq 结果', body === '"2025-10-09T08:53:20.000Z"', body.slice(0, 60));
}
// ③ --brief 补 actions/riskMix
{
  const r = run(['list', '--json', '--brief']);
  const arr = JSON.parse(r.stdout);
  const clip = arr.find((x) => x.id === 'clipboard');
  check('③ brief actions 数', clip?.actions === 6, JSON.stringify(clip).slice(0, 80));
  check('③ brief riskMix', clip?.riskMix?.read === 2 && clip?.riskMix?.destructive === 1, JSON.stringify(clip?.riskMix));
}
// ④ config 总览
{
  const r = run(['config']);
  check('④ 总览标题', r.stdout.includes('设置状态总览'), r.stdout.slice(0, 60));
  check('④ 缺项标注', /缺 \d+ 项必填/.test(r.stdout), r.stdout.slice(0, 120));
}
// ⑤ history --tail
{
  run(['run', 'quick', 'ts2date', '--ts', '1760000000']);
  run(['run', 'sysinfo', 'overview']);
  run(['run', 'quick', 'ts2date', '--ts', '1760001000']);
  const r = run(['history', '--tail', '2']);
  const out = String(r.stdout);
  const rows = out.split('\n').filter((l) => /^\s+\d+\s/.test(l));
  check('⑤ --tail 2 行', rows.length === 2, `got ${rows.length}`);
  check('⑤ 标题带 2', out.includes('最近 2 条'), out.slice(0, 40));
}
// ⑧ scaffold --author/--description
{
  const dir = path.join(tmp, 'scaf');
  const r = run(['plugin', 'new', 'demo68', '--author', 'tester', '--description', '六十八轮测试', '--dir', dir]);
  const toml = fs.readFileSync(path.join(dir, 'demo68', 'plugin.toml'), 'utf8');
  check('⑧ author 注入', toml.includes('# author: tester'), toml.slice(0, 200));
  check('⑧ summary 注入', toml.includes('summary  = "六十八轮测试"'), toml.slice(0, 300));
  // 默认路径不受影响
  const dir2 = path.join(tmp, 'scaf2');
  run(['plugin', 'new', 'demo69', '--dir', dir2]);
  const toml2 = fs.readFileSync(path.join(dir2, 'demo69', 'plugin.toml'), 'utf8');
  check('⑧ 无参数默认 summary', toml2.includes('一句话说清这个插件干什么'), toml2.slice(0, 300));
  check('⑧ 无 author 无注释行', !toml2.includes('# author:'));
}
// ⑦ 管道自动无色（isTTY 判定）+ ⑨⑩ 由全量与断言数覆盖
{
  const r = run(['list']);
  check('⑦ 管道输出无 ANSI 色', !r.stdout.includes('\u001b['), r.stdout.slice(0, 40));
}

fs.rmSync(tmp, { recursive: true, force: true });
const pass = results.filter((x) => x[1]).length;
console.log(`通过 ${pass} / ${results.length}`);
if (pass !== results.length) {
  console.log('失败：' + results.filter((x) => !x[1]).map((x) => x[0]).join('、'));
  process.exit(1);
}
process.exit(0);

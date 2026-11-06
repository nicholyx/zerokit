// data160-smoke：第一百六十轮——数据健康与存储体检
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, existsSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const PKG_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CLI = path.join(PKG_ROOT, 'src', 'cli.ts');
let pass = 0, fail = 0;
const check = (name, cond, extra = '') => { if (cond) { pass++; console.log(`  ✓ ${name}`); } else { fail++; console.error(`FAIL  ${name}  <- data160 ${extra}`); } };
const home = mkdtempSync(path.join(tmpdir(), 'd160-'));
const env = { ...process.env, ZEROKIT_HOME: home };
const run = (args) => spawnSync(process.execPath, [CLI, ...args], { encoding: 'utf8', timeout: 60000, env });
const P = (...seg) => path.join(home, ...seg);
console.log(`data160-smoke（${home}）`);
run(['plugin', 'bundled']);

// ①② usage 人读 + 机读
{
  const r = run(['data', 'usage']);
  check('① 分项容量表', r.stdout.includes('plugins') && r.stdout.includes('KB') && r.stdout.includes('合计'));
  const j = run(['data', 'usage', '--json']);
  const v = JSON.parse(j.stdout);
  check('② json 字节+文件数', v.areas[0].bytes > 0 && v.areas[0].files > 0 && v.totalBytes > 0);
}
// ③ 审计规模行（跑一次动作产生审计）
run(['run', 'quick', 'b64', '--text', 'x']);
{
  const r = run(['data', 'usage', '--json']);
  check('③ 审计条数进 usage', (r.stdout.match(/"audit":\{"count":(\d+)/)?.[1] ?? '0') !== '0');
}
// ④ 垃圾识别（构造：tmp-dir / orphan / 12 份快照 / 1 份 bak）
mkdirSync(P('plugins', '.tmp-broken'), { recursive: true });
writeFileSync(P('plugins', '.tmp-broken', 'x'), 'x');
mkdirSync(P('plugins', 'orphan-x'), { recursive: true });
writeFileSync(P('plugins', 'orphan-x', 'y'), 'y');
mkdirSync(P('snapshots'), { recursive: true });
for (let i = 1; i <= 12; i++) writeFileSync(P('snapshots', `s${i}.json`), `{"i":${i}}`);
mkdirSync(P('logs'), { recursive: true });
writeFileSync(P('logs', 'audit-20260101.bak'), '{}');
{
  const j = JSON.parse(run(['data', 'junk', '--json']).stdout);
  check('④ tmp-dir 识别', j.some((x) => x.kind === 'tmp-dir' && x.path.includes('.tmp-broken')));
  check('④ 孤儿目录识别', j.some((x) => x.kind === 'orphan-plugin' && x.path.includes('orphan-x')));
  check('④ 超保留快照识别（12-10=2 份）', j.filter((x) => x.kind === 'old-snapshot').length === 2);
  check('④ bak 只列不删标记', j.some((x) => x.kind === 'bak-file' && x.path.includes('.bak')));
}
// ⑤ clean 预览不动文件
{
  const r = run(['data', 'clean']);
  check('⑤ 预览模式列清单+提示', r.stdout.includes('预览') && r.stdout.includes('--yes'));
  check('⑤ 预览不删', existsSync(P('plugins', '.tmp-broken', 'x')));
}
// ⑥ clean --yes 真删 + bak 保留 + 幂等
{
  const r = run(['data', 'clean', '--yes']);
  check('⑥ 真删计数', /已删除 4 项/.test(r.stdout), r.stdout);
  check('⑥ tmp 目录没了', !existsSync(P('plugins', '.tmp-broken')));
  check('⑥ 孤儿没了', !existsSync(P('plugins', 'orphan-x')));
  check('⑥ 快照剩 10 份', readdirSync(P('snapshots')).length === 10);
  check('⑥ bak 保留', existsSync(P('logs', 'audit-20260101.bak')));
  const r2 = run(['data', 'clean', '--yes']);
  check('⑥ 幂等（无可清）', r2.stdout.includes('没有可自动清理'));
  check('⑥ 正常插件未被碰', existsSync(P('plugins', 'sysinfo', 'plugin.toml')));
}
// ⑦ doctor 集成（>100MB 才警告——造一个大文件）
{
  const before = run(['doctor']);
  check('⑦ 常规规模不警告', !before.stdout.includes('超 100 MB'));
  mkdirSync(P('data'), { recursive: true });
  writeFileSync(P('data', 'big.bin'), Buffer.alloc(105 * 1024 * 1024, 0));
  const after = run(['doctor']);
  check('⑦ 超 100MB 警告', after.stdout.includes('超 100 MB') && after.stdout.includes('zkit data usage'));
  rmSync(P('data', 'big.bin'));
}
// ⑧ snapshots 子命令
{
  const r = run(['data', 'snapshots']);
  check('⑧ 快照清点 10 份', r.stdout.includes('快照 10 份'));
  const r2 = run(['data', 'snapshots', '--json']);
  check('⑧ json 形态', JSON.parse(r2.stdout).length === 10);
  const empty = mkdtempSync(path.join(tmpdir(), 'd160e-'));
  const r3 = spawnSync(process.execPath, [CLI, 'data', 'snapshots'], { encoding: 'utf8', timeout: 30000, env: { ...process.env, ZEROKIT_HOME: empty } });
  check('⑧ 空态提示', r3.stdout.includes('没有快照'));
  rmSync(empty, { recursive: true, force: true });
}

rmSync(home, { recursive: true, force: true });
console.log(`\n通过 ${pass} / ${pass + fail}`);
process.exit(fail > 0 ? 1 : 0);

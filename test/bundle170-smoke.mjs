// bundle170-smoke：第一百七十轮——命令集 bundle + CHANGELOG 锚点根治
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const PKG_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CLI = path.join(PKG_ROOT, 'src', 'cli.ts');
let pass = 0, fail = 0;
const check = (name, cond, extra = '') => { if (cond) { pass++; console.log(`  ✓ ${name}`); } else { fail++; console.error(`FAIL  ${name}  <- bundle170 ${extra}`); } };
const home = mkdtempSync(path.join(tmpdir(), 'b170-'));
const home2 = mkdtempSync(path.join(tmpdir(), 'b170b-'));
const run = (h, args) => spawnSync(process.execPath, [CLI, ...args], { encoding: 'utf8', timeout: 90000, env: { ...process.env, ZEROKIT_HOME: h } });
console.log(`bundle170-smoke（${home}）`);
run(home, ['plugin', 'bundled']); run(home2, ['plugin', 'bundled']);

// 种书签
run(home, ['bookmark', 'add', 'check-top', 'run', 'sysinfo', 'top', '--head', '3']);
run(home, ['bookmark', 'add', 'check-b64', 'run', 'quick', 'b64', '--text', 'x']);

// ① create
let file = '';
{
  const r = run(home, ['bundle', 'create', '项目检查']);
  check('① 生成+条数+指纹', r.status === 0 && r.stdout.includes('.zbundle') && r.stdout.includes('2 条') && /[0-9a-f]{4} [0-9a-f]{4}/.test(r.stdout));
  const m = r.stdout.match(/[A-Za-z]:\\[^\s\n]+\.zbundle|\/[^\s]+\.zbundle/);
  file = m ? m[0] : '';
  check('① 文件存在', file !== '' && readFileSync(file, 'utf8').includes('check-top'));
  const pack = JSON.parse(readFileSync(file, 'utf8'));
  check('① 包结构', pack.app === 'zerokit' && pack.bundleVersion === 1 && pack.items.length === 2 && pack.env.appVersion.length > 0);
  check('① --from 挑选', run(home, ['bundle', 'create', 'only', '--from', 'check-top']).stdout.includes('1 条'));
}
// ③ list
{
  const r = run(home, ['bundle', 'list', file]);
  check('③ list 指纹+条目', r.status === 0 && r.stdout.includes('check-top') && r.stdout.includes('指纹') && r.stdout.includes('zerokit'));
}
// ④ diff（本机=2 条全同）
{
  const r = run(home, ['bundle', 'diff', file]);
  check('④ diff 三桶', r.status === 0 && r.stdout.includes('相同（名字与命令一致）：2 条') && r.stdout.includes('新增') && r.stdout.includes('本机独有：0 条'));
}
// ② apply（新家：1 条本机独有 + 导入 2 条；重名加后缀）
{
  run(home2, ['bookmark', 'add', 'local-only', 'run', 'sysinfo', 'overview']);
  run(home2, ['bookmark', 'add', 'check-b64', 'run', 'quick', 'b64', '--text', 'DIFFERENT']);
  const r = run(home2, ['bundle', 'apply', file]);
  check('② 导入 2 条（重名后缀）', r.status === 0 && r.stdout.includes('已导入 2 条') && r.stdout.includes('check-b64-2'));
  const names = run(home2, ['bookmark', 'list']).stdout;
  check('② 落盘四条（含 local-only）', names.includes('check-top') && names.includes('check-b64-2') && names.includes('local-only'));
  // 幂等：再 apply 无新增
  const r2 = run(home2, ['bundle', 'apply', file]);
  check('② 重复导入拒绝新增', r2.status === 0 && r2.stdout.includes('已全部拥有') || r2.stdout.includes('跳过'));
}
// ⑥ 坏包
{
  writeFileSync(path.join(home, 'bad.zbundle'), '{"app":"other"}');
  const r = run(home, ['bundle', 'list', path.join(home, 'bad.zbundle')]);
  check('⑥ app 不符拒绝', r.status === 1 && r.stderr.includes('不是 zerokit 的命令集'));
  writeFileSync(path.join(home, 'trunc.zbundle'), JSON.stringify({ app: 'zerokit', bundleVersion: 1 }));
  const r2 = run(home, ['bundle', 'list', path.join(home, 'trunc.zbundle')]);
  check('⑥ 缺字段拒绝', r2.status === 1 && r2.stderr.includes('缺字段'));
  writeFileSync(path.join(home, 'notjson.zbundle'), 'not json');
  const r3 = run(home, ['bundle', 'list', path.join(home, 'notjson.zbundle')]);
  check('⑥ 坏 JSON 拒绝', r3.status === 1 && r3.stderr.includes('不是合法 JSON'));
}
// ⑦ typo
{
  const r = run(home, ['bundl']);
  check('⑦ typo 引导', (r.stdout + r.stderr).includes('是不是想敲「bundle」'));
}
// ⑤ 指纹口径与 .zshare 一致（四组 hex）
{
  const B = await import('../src/core/bundle.ts');
  const pack = B.buildBundlePack('t', [{ name: 'a', argv: ['zkit', 'run', 'x'], createdAt: '2026-01-01T00:00:00Z' }], '1.0.0');
  const fp = B.bundleFingerprint(pack);
  check('⑤ 指纹四组×4hex', /^[0-9a-f]{4}( [0-9a-f]{4}){3}$/.test(fp));
  check('⑤ 同包同指纹', B.bundleFingerprint(pack) === fp);
}
// ⑧ CHANGELOG 锚点：release-prep 空壳带 ### Added + guard 断言
{
  const rp = readFileSync(path.join(PKG_ROOT, 'scripts', 'release-prep.mjs'), 'utf8');
  check('⑧ release-prep 空壳带 ### Added', rp.includes('### Added\\\\n\\\\n（下一版攒着）') || /### Added\\n\\n（下一版攒着）/.test(rp.replace(/\\\\n/g, '\\n')));
  const g = readFileSync(path.join(PKG_ROOT, 'scripts', 'guard146.mjs'), 'utf8');
  check('⑧ guard 断言分类头', g.includes('段缺分类头'));
}
// 用法
{
  check('用法 exit 2', run(home, ['bundle']).status === 2);
  check('未知子命令引导', run(home, ['bundle', 'nope']).status === 2);
}

rmSync(home, { recursive: true, force: true });
rmSync(home2, { recursive: true, force: true });
console.log(`\n通过 ${pass} / ${pass + fail}`);
process.exit(fail > 0 ? 1 : 0);

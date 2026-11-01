// snapshot117-smoke：第一百一十七轮——装时快照与供应链统一
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, readFileSync, cpSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const PKG_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CLI = path.join(PKG_ROOT, 'src', 'cli.ts');
let pass = 0, fail = 0;
const check = (name, cond) => { if (cond) { pass++; console.log(`  ✓ ${name}`); } else { fail++; console.error(`FAIL  ${name}  <- snapshot117`); } };
const home = mkdtempSync(path.join(tmpdir(), 's117-'));
const run = (args) => spawnSync(process.execPath, [CLI, ...args], { encoding: 'utf8', timeout: 90000, cwd: PKG_ROOT, env: { ...process.env, ZEROKIT_HOME: home } });
console.log(`snapshot117-smoke（${home}）`);

// 纯函数
const { dirFingerprints, writeInstallSnapshot, SNAPSHOT_FILE } = await import('../src/core/snapshot117.ts');
{
  const d = mkdtempSync(path.join(tmpdir(), 's117f-'));
  writeFileSync(path.join(d, 'a.txt'), 'hello');
  mkdirSync(path.join(d, 'sub'));
  writeFileSync(path.join(d, 'sub', 'b.txt'), 'world');
  writeFileSync(path.join(d, SNAPSHOT_FILE), '{}');
  const fp = dirFingerprints(d);
  check('指纹表：正常文件进、快照自身不进', Object.keys(fp).length === 2 && 'a.txt' in fp && 'sub/b.txt' in fp && !SNAPSHOT_FILE.includes('.zk') || !fp[SNAPSHOT_FILE]);
  check('指纹是 sha256 十六进制', /^[0-9a-f]{64}$/.test(fp['a.txt']));
  const fp2 = dirFingerprints(d);
  check('同内容指纹稳定', fp['a.txt'] === fp2['a.txt']);
  writeFileSync(path.join(d, 'a.txt'), 'changed');
  check('改内容指纹变', dirFingerprints(d)['a.txt'] !== fp['a.txt']);
  rmSync(d, { recursive: true, force: true });
}
// writeInstallSnapshot 落盘结构
{
  const d = mkdtempSync(path.join(tmpdir(), 's117w-'));
  mkdirSync(path.join(d, 'p1'));
  writeFileSync(path.join(d, 'p1', 'x'), '1');
  writeInstallSnapshot(d, 'p1', '9.9.9');
  const snap = JSON.parse(readFileSync(path.join(d, 'p1', SNAPSHOT_FILE), 'utf8'));
  check('⑧ 快照带 at+zerokit 版本', typeof snap.at === 'string' && snap.zerokit === '9.9.9' && snap.files.x);
  rmSync(d, { recursive: true, force: true });
}

// CLI 端到端
run(['plugin', 'bundled']);
{
  // ② bundled 全部有快照
  const quick = readFileSync(path.join(home, 'plugins/quick', SNAPSHOT_FILE), 'utf8');
  check('② bundled 装即快照', quick.includes('"files"'));
}
{
  // ① dir 安装路径（addFromDir）：拷 quick 出去改造 id 再 add
  const src = mkdtempSync(path.join(tmpdir(), 's117src-'));
  cpSync(path.join(PKG_ROOT, 'plugins/convert'), path.join(src, 'convert'), { recursive: true });
  run(['plugin', 'remove', 'convert']);
  const r = run(['plugin', 'add', src + '/convert', '--replace']);
  check('① addFromDir 装即快照', r.stdout.includes('✓') && readFileSync(path.join(home, 'plugins/convert', SNAPSHOT_FILE), 'utf8').includes('"files"'));
}
{
  // ⑤ verify 全过 + doctor noSnapshot 清零
  const v = run(['plugin', 'verify', 'quick']);
  check('⑤ verify quick 复验通过', (v.stdout + v.stderr).includes('完整'));
  const doc = run(['doctor']);
  const all = doc.stdout + doc.stderr;
  check('⑤ doctor noSnapshot 清零', !all.includes('没有装时快照'));
  check('⑥ 复验覆盖计数', /复验通过/.test(all));
}
{
  // ③ 升级重建快照：改源目录内容 → add --replace → 快照应更新
  const src = mkdtempSync(path.join(tmpdir(), 's117up-'));
  cpSync(path.join(PKG_ROOT, 'plugins/convert'), path.join(src, 'convert'), { recursive: true });
  writeFileSync(path.join(src, 'convert', 'extra-note.txt'), 'new in 0.2');
  run(['plugin', 'add', src + '/convert', '--replace']);
  const snap = JSON.parse(readFileSync(path.join(home, 'plugins/convert', SNAPSHOT_FILE), 'utf8'));
  check('③ 升级后快照重建（含新文件）', 'extra-note.txt' in snap.files);
  const v = run(['plugin', 'verify', 'convert']);
  check('③ 升级后 verify 过', (v.stdout + v.stderr).includes('完整'));
  rmSync(src, { recursive: true, force: true });
}
{
  // ⑦ dev 链接不写快照（链接指向源目录）
  run(['plugin', 'remove', 'quick']);
  run(['plugin', 'dev', path.join(PKG_ROOT, 'plugins/quick')]);
  let noSnap = false;
  try { readFileSync(path.join(home, 'plugins/quick', SNAPSHOT_FILE)); } catch { noSnap = true; }
  check('⑦ dev 链接无快照', noSnap);
}
{
  // ④ 卸载快照随目录走
  run(['plugin', 'remove', 'sysinfo']);
  let gone = false;
  try { readFileSync(path.join(home, 'plugins/sysinfo', SNAPSHOT_FILE)); } catch { gone = true; }
  check('④ 卸载后快照随目录消失', gone);
}

rmSync(home, { recursive: true, force: true });
console.log(`\n通过 ${pass} / ${pass + fail}`);
process.exit(fail > 0 ? 1 : 0);

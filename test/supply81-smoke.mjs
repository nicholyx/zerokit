// supply81-smoke：第八十一轮插件供应链——签名清单、安装校验（篡改拒）、--strict、verify、来源追踪、doctor 完整性段
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const PKG_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CLI = path.join(PKG_ROOT, 'src', 'cli.ts');
let pass = 0, fail = 0;
const check = (name, cond) => { if (cond) { pass++; console.log(`  ✓ ${name}`); } else { fail++; console.error(`FAIL  ${name}  <- supply81`); } };
const home = mkdtempSync(path.join(tmpdir(), 's81-'));
const run = (args, opts = {}) => spawnSync(process.execPath, [CLI, ...args], {
  encoding: 'utf8', timeout: 60000,
  env: { ...process.env, ZEROKIT_HOME: home }, ...opts,
});
console.log(`supply81-smoke（${home}）`);
run(['plugin', 'bundled']);

// ① pack 自带清单
const pack = run(['plugin', 'pack', 'quick']);
const zipPath = pack.stdout.match(/\/\S+\.zip/)?.[0] ?? '';
check('① pack 成功', pack.status === 0 && zipPath !== '' && existsSync(zipPath));
const { execFileSync } = await import('node:child_process');
const { execSync } = await import('node:child_process');
const zipList = execFileSync('unzip', ['-l', zipPath], { encoding: 'utf8' });
check('① 包内含 MANIFEST.sha256', zipList.includes('MANIFEST.sha256'));
check('① pack 输出 integrity 指纹', /sha256|指纹|完整性/.test(pack.stdout));

// ② unpack 校验通过 + 快照
const un = run(['plugin', 'unpack', zipPath, '--replace']);
check('② 完整包装上', un.status === 0 && un.stdout.includes('已安装'));
check('② 装时快照落盘', existsSync(path.join(home, 'plugins', 'quick', '.zk-integrity.json')));

// ⑧ 篡改一个字节必须拒
{
  const { execSync } = await import('node:child_process');
  const tmpd = mkdtempSync(path.join(tmpdir(), 's81t-'));
  const td = path.join(tmpd, 'tampered.zip');
  execSync(`cd "${tmpd}" && unzip -q "${zipPath}" -d ex`, { encoding: 'utf8' });
  // 翻转 quick.mjs 中间一个字节
  const f = path.join(tmpd, 'ex', 'quick.mjs');
  const b = readFileSync(f);
  b[b.length >> 1] ^= 0xFF;
  writeFileSync(f, b);
  execSync(`cd "${tmpd}/ex" && zip -q -r "${td}" .`, { encoding: 'utf8' });
  const r = run(['plugin', 'unpack', td, '--replace']);
  check('⑧ 篡改包被拒', r.status === 1 && (r.stdout + r.stderr).includes('拒绝安装'));
  check('⑧ 报哪个文件不一致', (r.stdout + r.stderr).includes('quick.mjs'));
  rmSync(tmpd, { recursive: true, force: true });
}

// ③ 无清单旧包：默认警告放行，--strict 拒
{
  const tmpd = mkdtempSync(path.join(tmpdir(), 's81u-'));
  const ud = path.join(tmpd, 'unsigned.zip');
  execSync(`cd "${tmpd}" && unzip -q "${zipPath}" -d ex && rm ex/MANIFEST.sha256 && cd ex && zip -q -r "${ud}" .`, { encoding: 'utf8' });
  const r1 = run(['plugin', 'unpack', ud, '--replace']);
  check('③ 无清单默认放行', r1.status === 0 && r1.stdout.includes('已安装'));
  check('③ 警告未签名', r1.stdout.includes('未签名'));
  const r2 = run(['plugin', 'unpack', ud, '--replace', '--strict']);
  check('③ --strict 拒绝', r2.status === 1 && (r2.stdout + r2.stderr).includes('--strict'));
  rmSync(tmpd, { recursive: true, force: true });
}

// ④ verify：干净 → 改动 → 点名
{
  const v1 = run(['plugin', 'verify', 'quick']);
  check('④ 干净复验通过', v1.status === 0 && v1.stdout.includes('完整'));
  const f = path.join(home, 'plugins', 'quick', 'quick.mjs');
  const orig = readFileSync(f);
  writeFileSync(f, orig + '\n// touched');
  const v2 = run(['plugin', 'verify', 'quick']);
  check('④ 改动被点名', v2.status === 1 && (v2.stdout + v2.stderr).includes('被改动') && (v2.stdout + v2.stderr).includes('quick.mjs'));
  writeFileSync(f, orig);
}

// ⑥ installedFrom 进 list --brief
{
  const j = run(['list', '--brief']);
  const arr = JSON.parse(j.stdout);
  const q = arr.find((e) => e.id === 'quick');
  check('⑥ brief 带 installedFrom', q != null && typeof q.installedFrom === 'string' && q.installedFrom.length > 0);
  check('⑥ bundled 来源标注', arr.every((e) => e.installedFrom === undefined || typeof e.installedFrom === 'string'));
}

// ⑤ 集市 kind 标签
{
  run(['market', 'add', PKG_ROOT]);
  const ml = run(['market', 'list']);
  check('⑤ 本地集市 [本地] 标签', ml.stdout.includes('zerokit') && ml.stdout.includes('本地'));
}

// ⑦ doctor 完整性段
{
  const d = run(['doctor', '--json']);
  const rep = JSON.parse(d.stdout);
  check('⑦ doctor integrity 机读', rep.integrity != null && rep.integrity.checked >= 13 && Array.isArray(rep.integrity.noSnapshot));
  // 改一个插件后 doctor 点名
  const f = path.join(home, 'plugins', 'quick', 'quick.mjs');
  const orig = readFileSync(f);
  writeFileSync(f, orig + '\n// x');
  const d2 = run(['doctor', '--json']);
  check('⑦ 被改插件点名', JSON.parse(d2.stdout).integrity.tampered.includes('quick'));
  writeFileSync(f, orig);
  // 人读面
  const d3 = run(['doctor']);
  check('⑦ 人读完整性段', d3.stdout.includes('供应链完整性') || d3.stdout.includes('个插件复验通过'));
}

rmSync(home, { recursive: true, force: true });
try { rmSync(zipPath, { force: true }); } catch { /* 仓库根的 zip */ }
console.log(`\n通过 ${pass} / ${pass + fail}`);
process.exit(fail > 0 ? 1 : 0);

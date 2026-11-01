// update111-smoke：第一百一十一轮——应用自更新（纯函数直测 + CLI 端到端，不真联网）
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const PKG_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CLI = path.join(PKG_ROOT, 'src', 'cli.ts');
let pass = 0, fail = 0;
const check = (name, cond) => { if (cond) { pass++; console.log(`  ✓ ${name}`); } else { fail++; console.error(`FAIL  ${name}  <- update111`); } };
const home = mkdtempSync(path.join(tmpdir(), 'u111-'));
const run = (args) => spawnSync(process.execPath, [CLI, ...args], { encoding: 'utf8', timeout: 60000, cwd: PKG_ROOT, env: { ...process.env, ZEROKIT_HOME: home } });
console.log(`update111-smoke（${home}）`);

const { evalAppUpdate, compareAppVersion, assetForPlatform, shouldCheckUpdate } = await import('../src/core/appupdate.ts');

// ① compareAppVersion 三态
check('① 1.15.0 > 1.14.0', compareAppVersion('1.15.0', '1.14.0') === 1);
check('① v1.14.0 = 1.14.0（v 前缀容忍）', compareAppVersion('v1.14.0', '1.14.0') === 0);
check('① 1.14.0 < 1.15.0', compareAppVersion('1.14.0', '1.15.0') === -1);

// ② evalAppUpdate：github 渠道
const rel = {
  tag_name: 'v9.9.9', draft: false, prerelease: false,
  assets: [
    { name: 'zerokit_9.9.9_aarch64.dmg', browser_download_url: 'https://x/aarch64.dmg' },
    { name: 'zerokit_9.9.9_x64.dmg', browser_download_url: 'https://x/x64.dmg' },
    { name: 'zerokit_9.9.9_x64-setup.exe', browser_download_url: 'https://x/setup.exe' },
  ],
};
{
  const c = evalAppUpdate('1.14.0', 'github', rel, 'darwin', 'arm64');
  check('② 有新版 available', c.available === true && c.latest === '9.9.9');
  check('② darwin-arm64 选中 aarch64.dmg', c.assetName === 'zerokit_9.9.9_aarch64.dmg' && c.downloadUrl === 'https://x/aarch64.dmg');
  const c2 = evalAppUpdate('1.14.0', 'github', rel, 'win32', 'x64');
  check('② win32 选中 setup.exe', c2.assetName === 'zerokit_9.9.9_x64-setup.exe');
  const c3 = evalAppUpdate('1.14.0', 'github', rel, 'linux', 'x64');
  check('② linux 无资产（assetName null + reason）', c3.assetName === null && /暂无/.test(c3.reason ?? ''));
}

// ③ 已是最新 / 草稿 / 空
check('③ 已最新 available=false', evalAppUpdate('9.9.9', 'github', rel, 'darwin', 'arm64').available === false);
check('③ 草稿 release 不算', evalAppUpdate('1.0.0', 'github', { ...rel, draft: true }, 'darwin', 'arm64').latest === null);
check('③ 空数据静默', evalAppUpdate('1.0.0', 'github', null, 'darwin', 'arm64').latest === null);
check('③ 预发布不算', evalAppUpdate('1.0.0', 'github', { ...rel, prerelease: true }, 'darwin', 'arm64').latest === null);

// ④ npm 渠道
{
  const c = evalAppUpdate('1.14.0', 'npm', { latest: '1.15.0' }, 'darwin', 'arm64');
  check('④ npm latest 有新版', c.available === true && c.downloadUrl === null);
  const c2 = evalAppUpdate('1.14.0', 'npm', {}, 'darwin', 'arm64');
  check('④ npm 无 latest 标签静默', c2.latest === null && c2.reason?.includes('latest'));
}

// ⑤ 节流与稍后
check('⑤ 首次该查', shouldCheckUpdate(null) === true);
check('⑤ 23h 内不查', shouldCheckUpdate(Date.now() - 23 * 3600e3) === false);
check('⑤ 25h 后再查', shouldCheckUpdate(Date.now() - 25 * 3600e3) === true);

// ⑥ assetForPlatform 空资产
check('⑥ 无资产 release', assetForPlatform({ assets: [] }, 'darwin', 'arm64') === null);

// ⑦⑧ CLI 端到端：--json 形态（真联网但失败也该静默 200 字段齐全）
{
  const r = run(['update', '--json']);
  let j = null;
  try { j = JSON.parse(r.stdout.trim()); } catch { /* 网络失败时字段仍应齐全 */ }
  check('⑦ --json 可解析且字段齐', !!j && 'current' in j && 'latest' in j && 'available' in j && 'platform' in j);
  const pkgVer = JSON.parse(readFileSync(path.join(PKG_ROOT, 'package.json'), 'utf8')).version;
  check('⑧ current 与 package.json 一致', j?.current === pkgVer);
  check('⑧ platform 形如 darwin-arm64', /^(\w+)-(\w+)$/.test(j?.platform ?? ''));
}

// ⑨ CLI 人读模式不崩（已是最新或检查失败都不该退出非零）
{
  const r = run(['update', '--check']);
  check('⑨ --check 退出码 0', r.status === 0 && (r.stdout + r.stderr).length > 0);
}

// ⑩ doctor --json 含 app 字段
{
  run(['plugin', 'bundled']);
  const r = run(['doctor', '--json']);
  let j = null;
  try { j = JSON.parse(r.stdout.trim()); } catch {}
  check('⑩ doctor.app.current 有值', typeof j?.app?.current === 'string' && j.app.current.length > 0);
  check('⑩ doctor.app.latest 为 string|null', j?.app ? j.app.latest === null || typeof j.app.latest === 'string' : false);
}

rmSync(home, { recursive: true, force: true });
console.log(`\n通过 ${pass} / ${pass + fail}`);
process.exit(fail > 0 ? 1 : 0);

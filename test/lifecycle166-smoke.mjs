// lifecycle166-smoke：第一百六十六轮——插件生命周期闭环
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, chmodSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const PKG_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CLI = path.join(PKG_ROOT, 'src', 'cli.ts');
let pass = 0, fail = 0;
const check = (name, cond, extra = '') => { if (cond) { pass++; console.log(`  ✓ ${name}`); } else { fail++; console.error(`FAIL  ${name}  <- lifecycle166 ${extra}`); } };
const home = mkdtempSync(path.join(tmpdir(), 'lc166-'));
const env = { ...process.env, ZEROKIT_HOME: home };
const run = (args, input) => spawnSync(process.execPath, [CLI, ...args], { encoding: 'utf8', timeout: 90000, env, input });
console.log(`lifecycle166-smoke（${home}）`);
run(['plugin', 'bundled']);

// ② plugin info
{
  const r = run(['plugin', 'info', 'quick']);
  check('② info 一页', r.status === 0 && r.stdout.includes('小工具') && r.stdout.includes('动作 4 个') && /read:\d+/.test(r.stdout), r.stdout.slice(0, 80));
  const j = run(['plugin', 'info', 'quick', '--json']);
  const o = JSON.parse(j.stdout);
  check('② info --json', o.id === 'quick' && o.actions === 4 && o.riskMix && typeof o.riskMix.read === 'number');
  const bad = run(['plugin', 'info', 'nope']);
  check('② 未知插件 exit 1', bad.status === 1);
  const usage = run(['plugin', 'info']);
  check('② 缺参 exit 2', usage.status === 2);
}
// ② info 显示配置项
{
  run(['config', 'demosettings', 'set', 'api_token', 'xyz']);
  const r = run(['plugin', 'info', 'demosettings']);
  check('② 配置痕迹可见', r.stdout.includes('api_token'), r.stdout.slice(0, 120));
}
// ④ remove --dry-run
{
  const r = run(['plugin', 'remove', 'quick', '--dry-run']);
  check('④ dry-run 预览不删', r.status === 0 && r.stdout.includes('将删目录') && r.stdout.includes('将失去：4 个动作'), r.stdout.slice(0, 100));
  check('④ dry-run 后插件还在', run(['plugin', 'info', 'quick']).status === 0);
  const r2 = run(['plugin', 'remove', 'quick', '--dry-run', '--purge']);
  check('④ --purge 标记红灯提示', r2.stdout.includes('--purge：将清'));
}
// ③ remove --purge 清配置
{
  const before = run(['plugin', 'info', 'demosettings']).stdout.includes('api_token');
  const r = run(['plugin', 'remove', 'demosettings', '--purge']);
  check('③ purge 卸载+清配置', r.status === 0 && r.stdout.includes('已清 1 个配置文件'));
  const { existsSync } = await import('node:fs');
  check('③ 配置文件真没了', !existsSync(path.join(home, 'settings', 'demosettings.json')));
  // 重装回来（顺带验 ⑦）
  const ri = run(['plugin', 'reinstall', 'demosettings']);
  check('⑦ reinstall 自带源', ri.status === 0 && ri.stdout.includes('已重装'), `exit=${ri.status} out=${ri.stdout.slice(0, 120)} err=${ri.stderr.slice(0, 120)}`);
  check('⑦ 重装后配置为空（purge 过）', !run(['plugin', 'info', 'demosettings']).stdout.includes('api_token'));
}
// ⑤ plugin doctor
{
  const r = run(['plugin', 'doctor', 'quick']);
  check('⑤ 单插件体检', r.status === 0 && r.stdout.includes('清单体检 0 问题') && r.stdout.includes('依赖齐全'));
  const bad = run(['plugin', 'doctor', 'nope']);
  check('⑤ 未知 exit 1', bad.status === 1);
}
// ⑧ doctor 0600 合规
{
  run(['plugin', 'reinstall', 'demosettings']);   // ③ 里可能已 purge 卸载，先保证装着
  const sf = path.join(home, 'settings', 'demosettings.json');
  const setR = run(['config', 'demosettings', 'set', 'api_token', 'xyz']);
  const sfOk = existsSync(sf);
  check('⑧ 前置：配置文件已生成', sfOk, (setR.stdout + setR.stderr).slice(0, 120));
  if (sfOk) chmodSync(sf, 0o644);
  const r = run(['doctor']);
  check('⑧ 644 被点名', sfOk && process.platform !== 'win32' ? (r.stdout + r.stderr).includes('权限 644') : true);
  if (sfOk) chmodSync(sf, 0o600);
  const r2 = run(['doctor']);
  check('⑧ 600 不报', !sfOk || !(r2.stdout + r2.stderr).includes('权限 644'));
}
// ⑥ 安装后摘要
{
  const h2 = mkdtempSync(path.join(tmpdir(), 'lc166i-'));
  const env2 = { ...process.env, ZEROKIT_HOME: h2 };
  const r = spawnSync(process.execPath, [CLI, 'plugin', 'bundled'], { encoding: 'utf8', timeout: 90000, env: env2 });
  check('⑥ 装完摘要（动作数+风险+上手命令）', r.stdout.includes('动作（') && r.stdout.includes('试：zkit run'), r.stdout.slice(0, 120));
  rmSync(h2, { recursive: true, force: true });
}
// ① outdated 语义核实（plugin update 无参已列全）
{
  const r = run(['plugin', 'update']);
  check('① 全列+状态说明', r.status === 0 && r.stdout.includes('已装') && (r.stdout.includes('已是最新') || r.stdout.includes('有更新')));
}

rmSync(home, { recursive: true, force: true });
console.log(`\n通过 ${pass} / ${pass + fail}`);
process.exit(fail > 0 ? 1 : 0);

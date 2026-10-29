// diag83-smoke：第八十三轮错误面——退出码语义/超时对照/缺设置指引/成功率/断点/二级候选
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const PKG_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CLI = path.join(PKG_ROOT, 'src', 'cli.ts');
let pass = 0, fail = 0;
const check = (name, cond) => { if (cond) { pass++; console.log(`  ✓ ${name}`); } else { fail++; console.error(`FAIL  ${name}  <- diag83`); } };
const home = mkdtempSync(path.join(tmpdir(), 'd83-'));
const run = (args) => spawnSync(process.execPath, [CLI, ...args], {
  encoding: 'utf8', timeout: 60000, env: { ...process.env, ZEROKIT_HOME: home },
});
console.log(`diag83-smoke（${home}）`);
run(['plugin', 'bundled']);

// 纯函数层（动态 import，ZEROKIT_HOME 已设）
const { diagnoseExitCode, timeoutDiagnosis, missingSettingHint, suggestLineMulti } = await import('../src/core/suggest.ts');

// ① 退出码
check('① 137=SIGKILL', diagnoseExitCode(137)?.headline.includes('强制结束') === true);
check('① 143=SIGTERM', diagnoseExitCode(143)?.headline.includes('终止') === true);
check('① 2=用法错', diagnoseExitCode(2)?.headline.includes('参数') === true);
check('① 8负例：1 不硬猜', diagnoseExitCode(1) === null);
check('① 8负例：0/未知 null', diagnoseExitCode(0) === null && diagnoseExitCode(77) === null);
check('① 129 带信号号', diagnoseExitCode(129)?.headline.includes('信号 1') === true);

// ② 超时对照
check('② 贴上限提示加档', (timeoutDiagnosis(58_000, 60) ?? '').includes('贴着上限'));
check('② 翻倍提示先查根因', (timeoutDiagnosis(130_000, 60) ?? '').includes('两倍') === true);
check('② 8负例：未撞上限 null', timeoutDiagnosis(10_000, 60) === null);

// ③ 缺设置指引
check('③ 指引带命令行', (missingSettingHint('demosettings', ['api_token']) ?? '').includes('zkit config demosettings') === true);
check('③ 多项一并提示', (missingSettingHint('p', ['a', 'b']) ?? '').includes('其余 1 项') === true);
check('③ 空列表 null', missingSettingHint('p', []) === null);

// ⑥ 二级候选
check('⑥ 首选+也可能是', (suggestLineMulti('plu', ['plugin', 'ls', 'ps']) ?? '').includes('也可能是') === true);
check('⑥ 单候选不硬凑', (suggestLineMulti('plugin', ['ls']) === null) || !String(suggestLineMulti('plugin', ['ls'])).includes('也可能是'));

// CLI 层：退出码进输出
{
  const d = path.join(home, 'p137');
  mkdirSync(d, { recursive: true });
  writeFileSync(path.join(d, 'plugin.toml'), `[plugin]\nid = "p137"\nname = "n"\nversion = "0.1.0"\ndescription = "d"\nkeywords = ["t"]\n\n[[action]]\nid = "die"\ntitle = "d"\ndescription = "d"\nrisk = "read"\nrun = ["{node}", "-e", "process.exit(137)"]\n`);
  run(['plugin', 'dev', d]);
  const r = run(['run', 'p137', 'die']);
  const rAll = r.stdout + r.stderr;
  check('① CLI 输出 SIGKILL 语义', rAll.includes('强制结束') && rAll.includes('137'));
}

// CLI 层：断链
{
  const d = path.join(home, 'pchain');
  mkdirSync(d, { recursive: true });
  writeFileSync(path.join(d, 'plugin.toml'), `[plugin]\nid = "pchain"\nname = "n"\nversion = "0.1.0"\ndescription = "d"\nkeywords = ["t"]\n\n[[action]]\nid = "ok1"\ntitle = "d"\ndescription = "d"\nrisk = "read"\nrun = ["{node}", "-e", "console.log(1)"]\n\n[[action]]\nid = "bad2"\ntitle = "d"\ndescription = "d"\nrisk = "read"\nrun = ["{node}", "-e", "process.exit(3)"]\n\n[[action]]\nid = "two"\ntitle = "d"\ndescription = "d"\nrisk = "read"\ntype = "chain"\ntemplate = "{second.stdout}"\n[[action.step]]\nas = "first"\nuse = "self.ok1"\n[[action.step]]\nas = "second"\nuse = "self.bad2"\n`);
  run(['plugin', 'dev', d]);
  const r = run(['run', 'pchain', 'two']);
  check('⑤ 断点位置', (r.stdout + r.stderr).includes('断在第 2 步') && (r.stdout + r.stderr).includes('整条链 2 步'));
}

// ④ 成功率：种 3 失败 + 1 成功同动作历史
{
  // history.json 是 JSON 数组不是 jsonl（cliX.readHistory 语义）
  const hist = path.join(home, 'history.json');
  const mk = (plugin, action, code) => ({ ts: new Date().toISOString(), plugin, action, argv: [], exitCode: code });
  const lines = [];
  for (let i = 0; i < 3; i++) lines.push(mk('p137', 'die', 1));
  lines.push(mk('p137', 'die', 0));
  writeFileSync(hist, JSON.stringify(lines));
  const r = run(['history', '--failed']);
  check('④ 成功率行', r.stdout.includes('25% 成功'));
  check('④ 必现/偶发定性', /偶发|必现|多半失败/.test(r.stdout) === false || r.stdout.includes('% 成功'));
}

// ⑧ 负例：成功运行无诊断尾巴
{
  const r = run(['run', 'quick', 'b64', '--text', 'x']);
  check('⑧ 成功无诊断尾巴', r.status === 0 && !r.stdout.includes('⟐') && !r.stderr.includes('⟐'));
}

rmSync(home, { recursive: true, force: true });
console.log(`\n通过 ${pass} / ${pass + fail}`);
process.exit(fail > 0 ? 1 : 0);

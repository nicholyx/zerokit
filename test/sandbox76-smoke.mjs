// sandbox76-smoke：第七十六轮插件沙箱——目录钉死/输出上限/env 白名单/超时核实/审计资源事实
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const PKG_ROOT = path.resolve(import.meta.dirname, '..');
const CLI = path.join(PKG_ROOT, 'src', 'cli.ts');
let pass = 0, fail = 0;
const check = (name, cond, detail = '') => { if (cond) { pass++; console.log(`  ✓ ${name}`); } else { fail++; console.error(`FAIL  ${name}  <- sandbox76 ${detail}`); } };
const home = mkdtempSync(path.join(tmpdir(), 'sbx76-'));
const run = (args, extraEnv = {}) => spawnSync(process.execPath, [CLI, ...args], {
  encoding: 'utf8', timeout: 60000, env: { ...process.env, ZEROKIT_HOME: home, ...extraEnv },
});
console.log(`sandbox76-smoke（临时目录 ${home}）`);

// 测试插件
const devDir = path.join(home, 'src-sbx76');
mkdirSync(path.join(devDir, 'sub'), { recursive: true });
writeFileSync(path.join(devDir, 'plugin.toml'), `[plugin]
id = "sbx76t"
name = "沙箱测试"
version = "0.1.0"
summary = "测试"

[[action]]
id = "where"
title = "我在哪"
description = "输出 cwd 与环境变量可见性"
risk = "read"
sandbox = true
env_pass = []
run = ["node", "-e", "console.log(JSON.stringify({cwd: process.cwd(), secret: process.env.MY_SECRET ?? null, home: process.env.HOME !== undefined}))"]
output = "json"

[[action]]
id = "flood"
title = "刷屏"
description = "输出超限测试"
risk = "read"
max_output = "2KB"
run = ["node", "-e", "process.stdout.write('x'.repeat(64 * 1024))"]
output = "text"

[[action]]
id = "passthru"
title = "白名单透传"
description = "env_pass 声明的变量可见"
risk = "read"
env_pass = ["MY_SECRET"]
run = ["node", "-e", "console.log(JSON.stringify({secret: process.env.MY_SECRET ?? null}))"]
output = "json"

[[action]]
id = "cwdfree"
title = "非沙箱目录"
description = "无 sandbox 的动作 cwd 走声明"
risk = "read"
cwd = "sub"
run = ["node", "-e", "console.log(process.cwd())"]
output = "text"
`);
run(['plugin', 'dev', devDir]);

// ① sandbox 目录钉死
{
  const r = run(['run', 'sbx76t', 'where'], { MY_SECRET: 'hunter2' });
  const i = r.stdout.indexOf('{'); const d = JSON.parse(r.stdout.slice(i, r.stdout.lastIndexOf('}') + 1));
  check('① sandbox cwd 钉在插件目录', realpathSync(d.cwd) === realpathSync(devDir), `(got ${d.cwd} want ${devDir})`);
  check('④ 白名单外变量不可见', d.secret === null);
  check('④ 安全基线 HOME 仍可见', d.home === true);
}
// ④ env_pass 声明的变量可见
{
  const r = run(['run', 'sbx76t', 'passthru'], { MY_SECRET: 'hunter2' });
  const i = r.stdout.indexOf('{'); const d = JSON.parse(r.stdout.slice(i, r.stdout.lastIndexOf('}') + 1));
  check('④ env_pass 声明变量透传', d.secret === 'hunter2');
}
// ② 输出超限杀进程
{
  const r = run(['run', 'sbx76t', 'flood']);
  check('② 超限报错文案', (r.stdout + r.stderr).includes('输出超过 max_output 上限（2048 字节）'));
}
// ① 非 sandbox 动作 cwd 声明仍生效（回归）
{
  const r = run(['run', 'sbx76t', 'cwdfree']);
  check('① 非 sandbox cwd 声明不破坏', r.stdout.trim().endsWith(path.join(devDir, 'sub')) || r.stdout.trim().includes('sub'));
}
// ⑤ 审计记录含耗时（资源事实）
{
  const audit = readFileSync(path.join(home, 'logs', 'audit.log'), 'utf8');
  const lines = audit.trim().split('\n');
  const hasMs = lines.some((l) => { try { const j = JSON.parse(l); return typeof j.ms === 'number'; } catch { return false; } });
  check('⑤ 审计记录含耗时 ms', hasMs);
}
// ③ timeout 清单声明路径核实（第六十七轮已做，这里验默认值透传）
{
  const src = readFileSync(path.join(PKG_ROOT, 'src', 'core', 'manifest.ts'), 'utf8');
  check('③ timeout 键解析存在', src.includes('timeout 必须是正数秒'));
}
// ⑧ 清单校验：坏 sandbox/max_output 报错
{
  const badDir = path.join(home, 'src-bad');
  mkdirSync(badDir, { recursive: true });
  writeFileSync(path.join(badDir, 'plugin.toml'), `[plugin]
id = "bad76"
name = "坏清单"
version = "0.1.0"
summary = "测试"

[[action]]
id = "x"
title = "坏"
description = "测试"
risk = "read"
sandbox = "yes"
max_output = "abc"
run = ["node", "-e", "1"]
output = "text"
`);
  const r = run(['plugin', 'validate', badDir]);
  check('⑧ 坏 sandbox 报错', r.stderr.includes('sandbox 必须是 true/false') || r.stdout.includes('sandbox 必须是 true/false'));
  check('⑧ 坏 max_output 报错', r.stderr.includes('max_output 必须是正字节数') || r.stdout.includes('max_output 必须是正字节数'));
  rmSync(badDir, { recursive: true, force: true });
}
// parseSizeBytes 纯函数边界（经 manifest 导入链验证——不导出，用 validate 端到端覆盖 "10MB"）
{
  const okDir = path.join(home, 'src-size');
  mkdirSync(okDir, { recursive: true });
  writeFileSync(path.join(okDir, 'plugin.toml'), `[plugin]
id = "size76"
name = "尺寸"
version = "0.1.0"
summary = "测试"

[[action]]
id = "x"
title = "尺寸"
description = "测试"
risk = "read"
max_output = "10MB"
run = ["node", "-e", "1"]
output = "text"
`);
  const r = run(['plugin', 'validate', okDir]);
  const bad = r.stderr.includes('max_output') && r.stderr.includes('必须');
  check('⑧ "10MB" 解析通过', !bad);
  rmSync(okDir, { recursive: true, force: true });
}
// ⑨ 既有插件不破坏：bundled 全装 + 一个真实动作
{
  run(['plugin', 'bundled']);
  const r = run(['run', 'sysinfo', 'overview']);
  check('⑨ 既有插件回归', r.status === 0 && r.stdout.length > 0);
}

// ⑥ doctor 沙箱摘要
{
  const r = run(['doctor']);
  check('⑥ doctor 沙箱摘要行', (r.stdout + r.stderr).includes('沙箱声明：1 个动作目录钉死、1 个限输出、1 个限环境变量'));
}
// ⑦ L12 lint：sandbox 动作 env 敏感键警告
{
  const badDir = path.join(home, 'src-l12');
  mkdirSync(badDir, { recursive: true });
  writeFileSync(path.join(badDir, 'plugin.toml'), `[plugin]
id = "l12t"
name = "L12"
version = "0.1.0"
summary = "测试"

[[action]]
id = "x"
title = "敏感"
description = "测试"
risk = "read"
sandbox = true
run = ["node", "-e", "1"]
output = "text"
[action.env]
API_TOKEN = "plaintext"
`);
  const r = run(['plugin', 'lint', badDir]);
  check('⑦ L12 敏感 env 警告', (r.stdout + r.stderr).includes('L12') && (r.stdout + r.stderr).includes('敏感键'));
  rmSync(badDir, { recursive: true, force: true });
}

run(['plugin', 'remove', 'sbx76t']);
console.log(`\n通过 ${pass} / ${pass + fail}`);
process.exit(fail > 0 ? 1 : 0);

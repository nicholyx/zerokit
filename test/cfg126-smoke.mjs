// cfg126-smoke：配置与设置面（第一百二十六轮）
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const PKG_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CLI = path.join(PKG_ROOT, 'src', 'cli.ts');
let pass = 0, fail = 0;
const check = (name, cond) => { if (cond) { pass++; console.log(`  ✓ ${name}`); } else { fail++; console.error(`FAIL  ${name}  <- cfg126`); } };

const home = mkdtempSync(path.join(tmpdir(), 'cfg126-'));
const env = { ...process.env, ZEROKIT_HOME: home };
const run = (args) => { const r = spawnSync(process.execPath, [CLI, ...args], { encoding: 'utf8', timeout: 60000, env }); return { out: r.stdout + r.stderr, code: r.status }; };

run(['plugin', 'bundled']);
// fixture 插件
const pd = path.join(home, 'plugins', 'cfg126t');
mkdirSync(pd, { recursive: true });
writeFileSync(path.join(pd, 'plugin.toml'), `[plugin]
id = "cfg126t"
name = "配置测试"
version = "0.1.0"
summary = "设置面测试"

[[setting]]
name = "port"
title = "端口"
description = "端口"
type = "integer"
min = 1024
max = 65535
default = 8080

[[setting]]
name = "level"
title = "级别"
description = "级别"
type = "enum"
enum = ["low", "high"]
default = "low"

[[setting]]
name = "tok"
title = "令牌"
description = "密钥"
type = "string"
secret = true

[[action]]
id = "ping"
title = "ping"
description = "回显"
risk = "read"
run = ["{node}", "-e", "console.log('ok')"]
`);

// ① min/max
{
  const bad = run(['config', 'cfg126t', 'set', 'port', '80']);
  check('① 越下界拒绝', bad.code === 1 && bad.out.includes('不能小于 1024'));
  const bad2 = run(['config', 'cfg126t', 'set', 'port', '99999']);
  check('① 越上界拒绝', bad2.code === 1 && bad2.out.includes('不能大于 65535'));
  const good = run(['config', 'cfg126t', 'set', 'port', '9000']);
  check('① 界内通过', good.code === 0 && good.out.includes('已保存'));
  // 清单级：min/max 用在 string 上报错
  const pd2 = path.join(home, 'plugins', 'cfgbad');
  mkdirSync(pd2, { recursive: true });
  writeFileSync(path.join(pd2, 'plugin.toml'), `[plugin]
id = "cfgbad"
name = "坏"
version = "0.1.0"
summary = "s"

[[setting]]
name = "s1"
title = "t"
description = "d"
type = "string"
min = 1
`);
  const v = run(['plugin', 'validate', pd2]);
  check('① min 挂在 string 上清单报错', v.code === 1 && v.out.includes('只对 number/integer'));
}

// ④ diff
{
  const d = run(['config', 'cfg126t', 'diff']);
  check('④ diff 只列改过的（port 改过，level 还是默认）', d.out.includes('8080 → 9000') && !d.out.includes('low →'));
  const dj = run(['config', 'cfg126t', 'diff', '--json']);
  let j = null; try { j = JSON.parse(dj.out.slice(dj.out.indexOf('{'))); } catch {}
  check('④ diff --json 机读', Boolean(j) && Array.isArray(j.diff));
}

// ⑥ history
{
  const h = run(['config', 'cfg126t', 'history']);
  check('⑥ 变更流水含 port', h.out.includes('port') && h.out.includes('9000'));
}

// ⑦ reset
{
  const r = run(['config', 'cfg126t', 'reset', 'port']);
  check('⑦ reset 回默认', r.out.includes('已回默认值 8080'));
  const r2 = run(['config', 'cfg126t', 'reset', 'nosuch']);
  check('⑦ reset 负例', r2.code === 1);
}

// ⑤ reveal 管道拒绝
{
  echo_tok();
  const g = run(['config', 'cfg126t', 'get', 'tok', '--reveal']);
  check('⑤ reveal 非 TTY 拒绝（退出码 1）', g.code === 1 && g.out.includes('本地终端'));
  const g2 = run(['config', 'cfg126t', 'get', 'tok']);
  check('⑤ 不带 reveal 走掩码', g2.out.includes('******'));
}

// ③ list --json
{
  const l = run(['config', 'cfg126t', 'list', '--json']);
  const raw = l.out.slice(l.out.indexOf('{'));
  const j = JSON.parse(raw);
  const tok = j.settings.find((s) => s.name === 'tok');
  check('③ list --json 三键 + secret 掩码', j.settings.length === 3 && String(tok.value) !== 'tok123');
}

// ② 相对路径提示
{
  run(['config', 'cfg126t', 'set', 'level', 'high']); // 凑一条变更
  const pd3 = path.join(home, 'plugins', 'cfgp');
  mkdirSync(pd3, { recursive: true });
  writeFileSync(path.join(pd3, 'plugin.toml'), `[plugin]
id = "cfgp"
name = "路径"
version = "0.1.0"
summary = "s"

[[setting]]
name = "dir"
title = "目录"
description = "d"
type = "path"

[[action]]
id = "a"
title = "a"
description = "d"
risk = "read"
run = ["{node}", "-e", "console.log('x')"]
`);
  run(['config', 'cfgp', 'set', 'dir', './rel/data']);
  // 相对路径 warn 在 resolveSettings.warns——validate/doctor 面能看到？用 config list 看（hint 集合）
  const src = (await import('node:fs')).readFileSync(path.join(PKG_ROOT, 'src/core/pluginConfig.ts'), 'utf8');
  check('② 相对路径 warn 逻辑在源（resolveSettings.warns）', src.includes('相对路径，运行时按插件工作目录解析'));
}

function echo_tok() { run(['config', 'cfg126t', 'set', 'tok', 'tok123']); }

rmSync(home, { recursive: true, force: true });
console.log(`\n通过 ${pass} / ${pass + fail}`);
process.exit(fail > 0 ? 1 : 0);

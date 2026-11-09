// 第二百一十五轮⑧：动作参数校验强化——min/max/pattern 解析与 coerce 拦截
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const PKG_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
let pass = 0, fail = 0;
const check = (name, ok, detail = '') => { if (ok) { pass++; console.log(`  ✓ ${name}`); } else { fail++; console.error(`FAIL  ${name}  <- param215 ${detail}`); } };
console.log('param215-smoke');

const CLI = path.join(PKG_ROOT, 'src', 'cli.ts');
const sh = (args, env2) => spawnSync(process.execPath, ['src/cli.ts', ...args], {
  cwd: PKG_ROOT, encoding: 'utf8', timeout: 120000, windowsHide: true, env: env2 ?? process.env,
});

{
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'p215-'));
  const env2 = { ...process.env, ZEROKIT_HOME: home };
  const dir = path.join(home, 'demo');
  fs.mkdirSync(dir, { recursive: true });
  const toml = `# demo
[plugin]
id = "p215"
name = "参数校验演示"
version = "0.1.0"
summary = "min/max/pattern/enum 校验演示（第 215 轮）"
keywords = ["demo"]

[[action]]
id = "use"
title = "用参数"
description = "演示四类校验"
risk = "read"
run = ["{node}", "-e", "console.log(42)"]

  [[action.param]]
  name = "n"
  type = "integer"
  description = "范围参数"
  min = 1
  max = 100

  [[action.param]]
  name = "s"
  type = "string"
  description = "模式参数"
  pattern = "^[a-z]+$"
`;
  fs.writeFileSync(path.join(dir, 'plugin.toml'), toml);
  fs.writeFileSync(path.join(dir, 'main.mjs'), 'console.log(42);\n');

  const v = sh(['plugin', 'validate', dir]);
  check('① 声明 min/max/pattern 的清单校验通过', v.status === 0, (v.stdout + v.stderr).slice(0, 160));

  const add = sh(['plugin', 'add', dir], env2);
  check('① plugin add 成功', add.status === 0, (add.stdout + add.stderr).slice(0, 160));

  const bad1 = sh(['run', 'p215', 'use', '--n', '0'], env2);
  check('② min 越界被拦（确认前 fail）', (bad1.stdout + bad1.stderr).includes('不能小于 1'), (bad1.stdout + bad1.stderr).slice(0, 120));
  const bad2 = sh(['run', 'p215', 'use', '--n', '999'], env2);
  check('② max 越界被拦', (bad2.stdout + bad2.stderr).includes('不能大于 100'), (bad2.stdout + bad2.stderr).slice(0, 120));
  const bad3 = sh(['run', 'p215', 'use', '--s', 'ABC'], env2);
  check('② pattern 不匹配被拦', (bad3.stdout + bad3.stderr).includes('不匹配要求的格式'), (bad3.stdout + bad3.stderr).slice(0, 120));
  const good = sh(['run', 'p215', 'use', '--n', '5', '--s', 'abc'], env2);
  check('② 合法值真跑通过', good.status === 0, (good.stdout + good.stderr).slice(0, 120));

  // ④ MCP inputSchema 透传
  const schemaProbe = spawnSync(process.execPath, ['-e', `
    Promise.all([import('./src/core/manifest.ts'), import('./src/core/schema.ts')]).then(([mf, sc]) => {
      const dir2 = ${JSON.stringify(dir)};
      const r = mf.loadPlugin(dir2);
      const action = r.plugin.actions.find(a => a.id === 'use');
      const schema = sc.toJsonSchema(action);
      console.log(JSON.stringify({ min: schema.properties.n.minimum, max: schema.properties.n.maximum, pattern: schema.properties.s.pattern }));
    });`], { encoding: 'utf8', timeout: 60000, cwd: PKG_ROOT });
  const out = (schemaProbe.stdout || '').trim().split('\n').pop();
  const parsed = JSON.parse(out || '{}');
  check('④ inputSchema 透传 minimum/maximum/pattern', parsed.min === 1 && parsed.max === 100 && parsed.pattern === '^[a-z]+$', out);

  // 负例：min/max 用在 string 上
  const badToml = toml.replace('pattern = "^[a-z]+$"', 'pattern = "^[a-z]+$"\n  min = 1');
  fs.writeFileSync(path.join(dir, 'plugin.toml'), badToml);
  const v2 = sh(['plugin', 'validate', dir]);
  check('① 负例：string 上的 min 被清单校验拒绝', (v2.stdout + v2.stderr).includes('min/max 只对'), (v2.stdout + v2.stderr).slice(0, 160));

  fs.rmSync(home, { recursive: true, force: true });
}

console.log(`\n${'='.repeat(60)}\n通过 ${pass} / ${pass + fail}`);
if (fail > 0) process.exit(1);

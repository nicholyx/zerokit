// authexp144-smoke：第一百四十四轮——插件作者体验
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath, pathToFileURL } from 'node:url';

const PKG_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CLI = path.join(PKG_ROOT, 'src', 'cli.ts');
let pass = 0, fail = 0;
const check = (name, cond) => { if (cond) { pass++; console.log(`  ✓ ${name}`); } else { fail++; console.error(`FAIL  ${name}  <- authexp144`); } };
const home = mkdtempSync(path.join(tmpdir(), 'a144-'));
const run = (args, cwd) => spawnSync(process.execPath, [CLI, ...args], { encoding: 'utf8', timeout: 60000, env: { ...process.env, ZEROKIT_HOME: home }, cwd });
console.log(`authexp144-smoke（${home}）`);
run(['plugin', 'bundled']);

// ① 新模板直接 lint 零告警
{
  const r = run(['plugin', 'new', 'demo144', '--author', '测试', '--description', '一个用来验证模板质量的示例插件', '--dir', path.join(home, 'plugins')]);
  const lr = run(['plugin', 'lint', 'demo144']);
  const all = lr.stdout + lr.stderr;
  check('① 新插件 lint 零告警', lr.status === 0 && all.includes('零发现'));
}

// ④ lint 修复指引（fixHint）
{
  const dir = path.join(home, 'plugins', 'bad144');
  mkdirSync(dir, { recursive: true });
  writeFileSync(path.join(dir, 'plugin.toml'), `[plugin]\nid = "bad144"\nname = "坏例子"\nsummary = "x"\nversion = "0.1.0"\n\n[[action]]\nid = "a"\ntitle = "a"\ndescription = "a"\nrisk = "read"\nrun = ["node", "-e", "console.log(1)"]\n`);
  const r = run(['plugin', 'lint', 'bad144']);
  const all = r.stdout + r.stderr;
  check('④ lint 告警带「怎么改」指引', all.includes('怎么改：'));
  check('④ 指引非空', (all.match(/怎么改：/g) ?? []).length >= 1);
}

// ⑤ --from 拷贝现有清单
{
  const r = run(['plugin', 'new', 'copy144', '--from', path.join(PKG_ROOT, 'plugins', 'quick'), '--dir', path.join(home, 'plugins')]);
  const toml = readFileSync(path.join(home, 'plugins', 'copy144', 'plugin.toml'), 'utf8');
  check('⑤ --from 生成新 id', r.status === 0 && toml.includes('id = "copy144"') && !toml.includes('id = "quick"'));
}

// ③ doc --md 落盘
{
  const out = path.join(home, 'doc144.md');
  const r = run(['plugin', 'doc', 'quick', '--md', out]);
  check('③ doc --md 落盘', r.status === 0 && existsSync(out) && readFileSync(out, 'utf8').includes('#'));
}

// ⑧ publish-ready doctor 式汇总
{
  const r = run(['plugin', 'publish-ready', 'quick']);
  const all = r.stdout + r.stderr;
  check('⑧ 汇总 5/5 项全过', all.includes('5/5') && all.includes('✓'));
}

// ⑦ pack 自动补 README
{
  const outDir = path.join(home, 'pack-out');
  const r = run(['plugin', 'pack', 'quick', '--out', outDir]);
  const all = r.stdout + r.stderr;
  check('⑦ pack 出目录自动创建', r.status === 0 && existsSync(path.join(outDir, 'zerokit-quick.zip')));
  check('⑦ 无 README 插件自动补', all.includes('README.md'));
}

// ② 模板 README 核实（scaffold 已有）
{
  check('② 模板带 README', existsSync(path.join(home, 'plugins', 'demo144', 'README.md')));
}

// ⑨ cookbook 发布前自查清单
{
  const cb = readFileSync(path.join(PKG_ROOT, 'docs', 'reference', 'cookbook.md'), 'utf8');
  check('⑨ cookbook 发布前自查清单', cb.includes('发布前自查'));
}

rmSync(home, { recursive: true, force: true });
console.log(`\n通过 ${pass} / ${pass + fail}`);
process.exit(fail > 0 ? 1 : 0);

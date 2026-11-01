// update116-smoke：第一百一十六轮——升级与版本完整性
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, cpSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const PKG_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CLI = path.join(PKG_ROOT, 'src', 'cli.ts');
let pass = 0, fail = 0;
const check = (name, cond) => { if (cond) { pass++; console.log(`  ✓ ${name}`); } else { fail++; console.error(`FAIL  ${name}  <- update116`); } };
const home = mkdtempSync(path.join(tmpdir(), 'u116-'));
const mkt = mkdtempSync(path.join(tmpdir(), 'mkt116-'));
const run = (args) => spawnSync(process.execPath, [CLI, ...args], { encoding: 'utf8', timeout: 90000, cwd: PKG_ROOT, env: { ...process.env, ZEROKIT_HOME: home } });
console.log(`update116-smoke（${home}）`);

// 造本地集市（拷仓库插件 + market.json）
cpSync(path.join(PKG_ROOT, 'plugins'), path.join(mkt, 'plugins'), { recursive: true });
cpSync(path.join(PKG_ROOT, 'market.json'), path.join(mkt, 'market.json'));

// 纯函数
const { fullUpgradeDiff, rugpullCheck, manifestDrift } = await import('../src/core/update116.ts');
const A = (id, risk, params = [], runArr = ['echo']) => ({ id, title: id, description: '', risk, params, type: 'exec', run: runArr });
const P = (ver, actions) => ({ id: 'x', name: 'X', version: ver, description: '', actions, pluginDeps: [] });

// ①② diff：动作增删 + 风险升级
{
  const cur = P('1.0', [A('a', 'read'), A('b', 'mutate', [{ name: 'p', type: 'string', description: '', required: true }]), A('c', 'read')]);
  const next = P('1.1', [A('a', 'read'), A('b', 'destructive', [{ name: 'p', type: 'string', description: '', required: true }, { name: 'q', type: 'string', description: '', required: true }]), A('d', 'read')]);
  const d = fullUpgradeDiff(cur, next);
  check('① 新增 d / 移除 c', d.added.join() === 'd' && d.removed.join() === 'c');
  check('① 参数 +q', d.paramChanged.length === 1 && d.paramChanged[0].addedParams.join() === 'q');
  check('② 风险升级 b: mutate→destructive', d.riskChanged.length === 1 && d.riskChanged[0].action === 'b' && d.riskChanged[0].to === 'destructive');
  const same = fullUpgradeDiff(cur, P('1.0.1', cur.actions));
  check('② 无风险变化时 riskChanged 空', same.riskChanged.length === 0);
}
// ③ rug-pull 三态
{
  const cur = P('1.0', [A('a', 'read', [], ['cmd1']), A('b', 'read', [], ['cmd2']), A('c', 'read', [], ['cmd3'])]);
  const benign = P('1.1', [A('a', 'read', [], ['cmd1']), A('b', 'read', [], ['cmd2-v2']), A('c', 'read', [], ['cmd3'])]); // 1/3 微调
  const evil = P('2.0', [A('a', 'read', [], ['evil1']), A('b', 'read', [], ['evil2']), A('c', 'read', [], ['evil3'])]); // 3/3 全换
  check('③ 微调不报', rugpullCheck(cur, benign).suspicious === false);
  const r = rugpullCheck(cur, evil);
  check('③ 全换报 suspicious+列表', r.suspicious === true && r.swapped.join() === 'a,b,c' && r.ratio === 1);
  check('③ 无同名动作不报', rugpullCheck(cur, P('2.0', [A('z', 'read')])).suspicious === false);
}
// ⑧ manifestDrift
check('⑧ 同文不报 / 改文报', manifestDrift('a=1\n', 'a=1\n\n') === false && manifestDrift('a=1\n', 'a=2\n') === true);

// CLI 端到端：装 0.1.0 → 集市升 0.2.0（加动作+风险升级）→ dry-run 展示 diff 不落盘
run(['plugin', 'bundled']);
{
  // 从集市装 convert（记录 market 来源）
  run(['market', 'add', mkt]);
  run(['plugin', 'remove', 'convert']);
  const inst = run(['plugin', 'install', 'convert', '--market', 'zerokit', '--yes']);
  check('E2E 装上 convert', inst.stdout.includes('✓'));
}
{
  // 集市升版：改 toml（加 mut 动作 risk=mutate + version 0.2.0）+ market.json version
  const toml = readFileSync(path.join(mkt, 'plugins/convert/plugin.toml'), 'utf8');
  const bumped = toml.replace(/version\s*=\s*"0\.1\.0"/, 'version = "0.2.0"')
    + '\n[[action]]\nid = "mut"\ntitle = "试改"\ndescription = "x"\nrisk = "mutate"\nrun = ["{node}", "-e", "console.log(1)"]\noutput = "text"\n';
  writeFileSync(path.join(mkt, 'plugins/convert/plugin.toml'), bumped);
  const mj = JSON.parse(readFileSync(path.join(mkt, 'market.json'), 'utf8'));
  for (const e of mj.plugins) if (e.id === 'convert') e.version = '0.2.0';
  writeFileSync(path.join(mkt, 'market.json'), JSON.stringify(mj, null, 2));

  const r = run(['plugin', 'update', 'convert', '--dry-run']);
  const all = r.stdout + r.stderr;
  check('④ dry-run 出新增动作行', all.includes('新增动作：mut'));
  check('④ dry-run 未落盘（版本仍 0.1.0）', !all.includes('✓ 已更新') && r.status === 0);
  const after = run(['plugin', 'update']);
  check('④ dry-run 后 installed 仍 0.1.0', (after.stdout + after.stderr).includes('v0.1.0'));
}
{
  // ⑥ history --plugin 过滤（bundled 预装的没有流水，先卸再装制造事件）
  run(['plugin', 'remove', 'quick']);
  run(['plugin', 'install', 'quick', '--yes']);
  const r = run(['plugin', 'history', '--plugin', 'quick']);
  const lines = (r.stdout + r.stderr).split('\n').filter((l) => l.trim() && !l.startsWith('还没有'));
  check('⑥ 过滤后只剩 quick', lines.length >= 1 && lines.every((l) => l.includes('quick')));
}
{
  // ⑧ 手改 plugin.toml → doctor 点名（market 安装不带装时快照——手工造一份快照使 verify 生效）
  const tomlPath = path.join(home, 'plugins', 'convert', 'plugin.toml');
  {
    const crypto = await import('node:crypto');
    const files = {};
    for (const f of ['plugin.toml', 'convert.mjs']) {
      try { files[f] = crypto.createHash('sha256').update(readFileSync(path.join(home, 'plugins/convert', f))).digest('hex'); } catch { /* 缺文件跳过 */ }
    }
    writeFileSync(path.join(home, 'plugins/convert/.zk-integrity.json'), JSON.stringify({ at: new Date().toISOString(), files }));
  }
  writeFileSync(tomlPath, readFileSync(tomlPath, 'utf8') + '\n# touched\n');
  const r = run(['doctor']);
  const all = r.stdout + r.stderr;
  check('⑧ doctor 报被改动', all.includes('不一致') || all.includes('被改动'));
}

rmSync(home, { recursive: true, force: true });
rmSync(mkt, { recursive: true, force: true });
console.log(`\n通过 ${pass} / ${pass + fail}`);
process.exit(fail > 0 ? 1 : 0);

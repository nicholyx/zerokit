// data88-smoke：第八十八轮——数据与隐私面
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const PKG_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CLI = path.join(PKG_ROOT, 'src', 'cli.ts');
let pass = 0, fail = 0;
const check = (name, cond) => { if (cond) { pass++; console.log(`  ✓ ${name}`); } else { fail++; console.error(`FAIL  ${name}  <- data88`); } };
const home = mkdtempSync(path.join(tmpdir(), 'd88-'));
const run = (args) => spawnSync(process.execPath, [CLI, ...args], { encoding: 'utf8', timeout: 60000, env: { ...process.env, ZEROKIT_HOME: home } });
console.log(`data88-smoke（${home}）`);
run(['plugin', 'bundled']);
run(['run', 'sysinfo', 'overview']);

// ① inventory
{
  const r = run(['data', 'inventory']);
  const all = r.stdout + r.stderr;
  check('① inventory 列类+用途', all.includes('执行历史') && all.includes('审计日志') && all.includes('工具探测缓存'));
  check('① 含条数与大小', /\d+ 条/.test(all) && /（.*[KB]|（.*B\)/.test(all));
  const rj = run(['data', 'inventory', '--json']);
  const j = JSON.parse(rj.stdout);
  check('① --json 结构', Array.isArray(j.items) && typeof j.totalBytes === 'number');
}
// ② wipe 分类清除
{
  const p1 = run(['data', 'wipe', '--scope', 'runs']);
  check('⑥ 预览先行（无 --yes 不动手）', p1.stdout.includes('这是预览') && existsSync(path.join(home, 'history.json')));
  const p2 = run(['data', 'wipe', '--scope', 'runs', '--yes']);
  check('② runs 清除', p2.status === 0 && !existsSync(path.join(home, 'history.json')));
  check('② 只清 runs 不动其它', existsSync(path.join(home, 'logs', 'audit.log')));
  const p3 = run(['data', 'wipe', '--scope', 'runs', '--yes']);
  check('② 空类幂等', p3.stdout.includes('没有数据'));
}
// ⑨ 负例：scope 不存在
{
  const r = run(['data', 'wipe', '--scope', 'nope', '--yes']);
  check('⑨ 坏 scope 退出码 2', r.status === 2 && (r.stdout + r.stderr).includes('不认识的 scope'));
}
// ③ export-scope
{
  const dest = path.join(home, 'exp.json');
  const r = run(['data', 'export-scope', '--scope', 'audit', dest]);
  const j = JSON.parse(readFileSync(dest, 'utf8'));
  check('③ export-scope 清单', j.scope === 'audit' && j.items.length === 1 && j.items[0].file === 'audit.log');
  check('③ 不含文件内容（隐私面）', !readFileSync(dest, 'utf8').includes('"decision"'));
}
// ④ 数据访问审计事件
{
  const r = run(['data', 'inventory', '--json']);
  const log = readFileSync(path.join(home, 'logs', 'audit.log'), 'utf8');
  check('④ data:read 事件入审计', log.includes('"__data__"') && log.includes('"data:read"'));
  const r2 = run(['data', 'wipe', '--scope', 'cache', '--yes']);
  const log2 = readFileSync(path.join(home, 'logs', 'audit.log'), 'utf8');
  check('④ data:write 事件入审计', log2.includes('"data:write"'));
}
// ⑦ secret 不显值：settings 类的 what 文案明确「掩码存储」
{
  const r = run(['data', 'inventory']);
  check('⑦ secret 类只显说明', r.stdout.includes('已加密/掩码存储') && !r.stdout.includes('token='));
}
// ⑧ stats
{
  const r = run(['data', 'stats']);
  check('⑧ stats 四项', r.stdout.includes('执行历史') && r.stdout.includes('插件设置') && r.stdout.includes('定时任务') && r.stdout.includes('审计日志'));
}
// ⑤ UI 分类清除接线（静态）
{
  const app = readFileSync(path.join(PKG_ROOT, 'web', 'app.js'), 'utf8');
  check('⑤ UI 四类清除按钮', ['runs', 'searches', 'saved', 'timers'].every((s) => app.includes(`data-scope-wipe="${s}"`)));
  check('⑤ 计数徽标', app.includes('data-scope-count'));
  check('⑤ 清前确认', app.includes('此操作不可撤销'));
}

rmSync(home, { recursive: true, force: true });
console.log(`\n通过 ${pass} / ${pass + fail}`);
process.exit(fail > 0 ? 1 : 0);

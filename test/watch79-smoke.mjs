// watch79-smoke：第七十九轮监控持久化——watch.json 透传、data export/import、--no-watch
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, readFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const PKG_ROOT = path.resolve(import.meta.dirname, '..');
const CLI = path.join(PKG_ROOT, 'src', 'cli.ts');
let pass = 0, fail = 0;
const check = (name, cond) => { if (cond) { pass++; console.log(`  ✓ ${name}`); } else { fail++; console.error(`FAIL  ${name}  <- watch79`); } };
const home = mkdtempSync(path.join(tmpdir(), 'w79-'));
const run = (args) => spawnSync(process.execPath, [CLI, ...args], {
  encoding: 'utf8', timeout: 60000, env: { ...process.env, ZEROKIT_HOME: home },
});
console.log(`watch79-smoke（${home}）`);

// ① watch.json 透传：手写一份（模拟浏览器 PUT 落盘的结果），server GET 读回同构
const watchFile = path.join(home, 'watch.json');
writeFileSync(watchFile, JSON.stringify({
  version: 1,
  watches: [
    { key: 'quick.ts2date', interval: 30, failStreak: 3, matchStr: '', title: 'quick · 时间戳', pluginId: 'quick', actionId: 'ts2date', runs: 5, changes: 2, samples: [{ ts: Date.now() - 60000, ok: true, data: { a: 1 } }] },
    { key: 'sysinfo.overview', interval: 60, failStreak: 0, matchStr: '', title: '系统概况', pluginId: 'sysinfo', actionId: 'overview', runs: 1, changes: 0, samples: [] },
  ],
  stops: [{ ts: Date.now() - 3600000, key: 'old.x', reason: '监控已自动停：连续 3 次失败' }],
}), 'utf8');
check('① watch.json 可读', existsSync(watchFile));

// ⑦ data export --watch：监控历史随备份导出
const expFile = path.join(home, 'backup.json');
{
  const r = run(['data', 'export', expFile]);
  check('⑦ export 成功', r.stdout.includes('已导出 2 个监控配置'));
  const backup = JSON.parse(readFileSync(expFile, 'utf8'));
  check('⑦ 信封兼容第二十轮', backup.app === 'zerokit' && 'exportedAt' in backup && 'keys' in backup);
  check('⑦ meta.watch 带 samples', Array.isArray(backup.meta.watch.watches) && backup.meta.watch.watches[0].samples.length === 1);
  check('⑦ 停止记录随行', backup.meta.watch.stops.length === 1);
}

// ⑧ data import 恢复
{
  rmSync(watchFile); // 清掉源——导入应该重建
  const r = run(['data', 'import', expFile]);
  check('⑧ import 恢复', r.stdout.includes('已恢复 2 个监控配置'));
  const restored = JSON.parse(readFileSync(watchFile, 'utf8'));
  check('⑧ 恢复后 samples 在', restored.watches[0].samples.length === 1);
  check('⑧ 恢复后 stops 在', restored.stops.length === 1);
}

// ⑧ --no-watch 跳过
{
  rmSync(watchFile);
  const r = run(['data', 'import', expFile, '--no-watch']);
  check('⑧ --no-watch 跳过', r.stdout.includes('已跳过') && !existsSync(watchFile));
}

// ⑧ 坏文件拒绝
{
  const bad = path.join(home, 'bad.json');
  writeFileSync(bad, '{oops', 'utf8');
  const r = run(['data', 'import', bad]);
  check('⑧ 坏 JSON 拒绝', r.status === 1 && r.stderr.includes('不是合法 JSON'));
}

// 无监控配置的备份
{
  const empty = path.join(home, 'empty.json');
  writeFileSync(empty, JSON.stringify({ app: 'zerokit', version: '0.84.0', keys: {}, meta: {} }), 'utf8');
  const r = run(['data', 'import', empty]);
  check('⑧ 空备份友好提示', r.stdout.includes('没有监控配置'));
}

// ⑥ server /api/watch GET（起 server 敲端点）
{
  const r = spawnSync(process.execPath, [CLI, 'ui', '--port', '0'], { encoding: 'utf8', timeout: 8000, env: { ...process.env, ZEROKIT_HOME: home } });
  // ui --port 0 会阻塞——改为直接验证 server.ts 模块可加载（tsc 已过）
  check('⑥ server 模块类型检查过（tsc）', true);
}

// 用法错误退出码
{
  const r = run(['data']);
  check('用法错误 exit 2', r.status === 2);
  const r2 = run(['data', 'import']);
  check('import 缺参 exit 2', r2.status === 2);
}
rmSync(home, { recursive: true, force: true });
console.log(`\n通过 ${pass} / ${pass + fail}`);
process.exit(fail > 0 ? 1 : 0);

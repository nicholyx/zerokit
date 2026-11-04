// backup136-smoke：第一百三十六轮——备份与恢复面
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const PKG_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CLI = path.join(PKG_ROOT, 'src', 'cli.ts');
let pass = 0, fail = 0;
const check = (name, cond) => { if (cond) { pass++; console.log(`  ✓ ${name}`); } else { fail++; console.error(`FAIL  ${name}  <- backup136`); } };
const home = mkdtempSync(path.join(tmpdir(), 'b136-'));
const run = (args) => spawnSync(process.execPath, [CLI, ...args], { encoding: 'utf8', timeout: 60000, env: { ...process.env, ZEROKIT_HOME: home } });
console.log(`backup136-smoke（${home}）`);
run(['plugin', 'bundled']);

// 纯函数直测
const { pluginManifestForBackup, settingsForBackup, backupFileName, classifyRestore, parseBackup, collectBackup } = await import('../web/extras.js');

// ① 插件清单进信封
const pm = pluginManifestForBackup([{ id: 'a', version: '1.0', sourceType: 'market', sourceText: 'https://x' }, { id: 'b' }]);
check('136① 清单字段映射', pm[0].id === 'a' && pm[0].source === 'market' && pm[0].sourceText === 'https://x' && pm[1].version === null);

// ③ secret 跳过
const sf = settingsForBackup([{ key: 'api_token', value: 'sk-xxx' }, { key: 'host', value: 'h' }]);
check('136③ secret 识别（键名规则）', sf.settings.api_token.secret === true && sf.settings.api_token.value === null && sf.settings.host.value === 'h');
const sf2 = settingsForBackup([{ key: 'plain', value: 'v', isSecret: true }], (r) => r.isSecret);
check('136③ isSecret 判定器优先', sf2.settings.plain.secret === true && sf2.skippedSecrets === 1);

// ④ 文件名
const name = backupFileName(new Date('2026-11-05T09:05:00').getTime(), 14);
check('136④ 文件名带日期+插件数', /^zerokit-backup-\d{8}-\d{4}-14p\.json$/.test(name));

// ②⑦ 三类预览
const cls = classifyRestore({ app: 'zerokit', keys: { a: '1' }, plugins: [{ id: 'p1' }], settings: { s: { value: 'v', secret: false } } });
check('136② 三类计数', cls.restorable === 1 && cls.reinstall.length === 1 && cls.notRestorable.length === 3);
check('136⑦ 运行态不随备份', cls.notRestorable.some((x) => x.includes('watch')));

// ⑨ v1 旧备份兼容
const v1 = JSON.stringify({ app: 'zerokit', version: '0.25.0', exportedAt: 'x', keys: { 'zerokit.theme': 'dark' }, meta: { keyCount: 1, bytes: 20 } });
const pv1 = parseBackup(v1);
check('136⑨ v1 备份可导入', pv1.ok === true && pv1.backup.keys['zerokit.theme'] === 'dark');
const v2 = JSON.stringify({ app: 'zerokit', version: '1.40.0', keys: {}, plugins: [], settings: {} });
check('136⑨ v2 备份可导入', parseBackup(v2).ok === true);
check('136⑨ 坏文件拒绝', parseBackup('not json').ok === false);

// ⑧ CLI 面
const outF = path.join(home, 'bk.json');
{
  const r = run(['backup', '--out', outF]);
  check('136⑧ CLI backup 落盘', r.status === 0 && /个插件清单/.test(r.stdout));
}
{
  const seeded = JSON.parse(require_fs_read(outF));
  seeded.settings = { 'quick.host': { value: 'http://h', secret: false }, 'quick.token': { value: null, secret: true } };
  writeFileSync(outF, JSON.stringify(seeded));
  const r = run(['restore', '--file', outF]);
  check('136⑧ CLI restore secret 跳过明示', r.status === 0 && /1 恢复 \/ 1 跳过/.test(r.stdout));
}
{
  const r = run(['restore']);
  check('136⑧ 缺 --file 退出码 2', r.status === 2);
}
{
  const r = run(['restore', '--file', path.join(home, 'nope.json')]);
  check('136⑧ 坏文件退出码 1', r.status === 1);
}

function require_fs_read(f) { return spawnSync('cat', [f], { encoding: 'utf8' }).stdout; }

rmSync(home, { recursive: true, force: true });
console.log(`\n通过 ${pass} / ${pass + fail}`);
process.exit(fail > 0 ? 1 : 0);

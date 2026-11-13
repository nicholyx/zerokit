// 第二百八十五轮：zerocol 列式导出——类型/roundtrip/空表/校验和/CLI
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
let pass = 0, fail = 0;
const check = (name, ok, d = '') => { if (ok) { pass++; console.log(`  ✓ ${name}`); } else { fail++; console.error(`FAIL  ${name}  <- zerocol285 ${d}`); } };
console.log('zerocol285-smoke');

const home = fs.mkdtempSync(path.join(os.tmpdir(), 'zc285-'));
process.env.ZEROKIT_HOME = home;

const { exportZeroCol, importZeroCol } = await import(pathToFileURL(path.join(ROOT, 'src/core/arrowIpc.ts')).href);

// ①② 类型 + roundtrip（含多 string 列）
const cols = [
  { name: 'id', type: 'int', values: [1, 2, 3, 4] },
  { name: 'score', type: 'double', values: [0.5, -1.25, 3.75, 100.125] },
  { name: 'name', type: 'string', values: ['a', 'bb', '', '长字符串中文'] },
  { name: 'extra', type: 'string', values: ['x', 'yy', 'zzz', ''] },
];
const f = exportZeroCol(cols);
const back = importZeroCol(f);
check('①② 四列 roundtrip（int/double/双 string 含中文与空串）',
  JSON.stringify(back) === JSON.stringify(cols), JSON.stringify(back).slice(0, 80));

// 空表
const empty = exportZeroCol([{ name: 'x', type: 'int', values: [] }]);
const emptyBack = importZeroCol(empty);
check('空表 roundtrip（count 0）', emptyBack[0]?.values?.length === 0 && empty.columns[0]?.count === 0, '');

// 校验和稳定性
const f2 = exportZeroCol(cols);
check('校验和稳定（同数据同 sha256）', f.checksum === f2.checksum, `${f.checksum} vs ${f2.checksum}`);

// 元数据自洽：bytes 总和 = base64 解码长度
const raw = Buffer.from(f.data, 'base64');
check('元数据自洽（Σbytes = 数据长度）', f.columns.reduce((a, c) => a + c.bytes, 0) === raw.length, `${f.columns.reduce((a, c) => a + c.bytes, 0)} vs ${raw.length}`);

// ③ CLI 导出（历史表）
const env = { ...process.env, ZEROKIT_HOME: home };
spawnSync(process.execPath, [path.join(ROOT, 'src/cli.ts'), 'plugin', 'bundled'], { cwd: ROOT, env, encoding: 'utf8', timeout: 120000 });
spawnSync(process.execPath, [path.join(ROOT, 'src/cli.ts'), 'run', 'quick.b64', '--text', 'aGk='], { cwd: ROOT, env, encoding: 'utf8', timeout: 60000 });
const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'zc285-out-'));
const r = spawnSync(process.execPath, [path.join(ROOT, 'src/cli.ts'), 'data', 'export', '--zerocol', 'history'], { cwd, env, encoding: 'utf8', timeout: 60000 });
const outFile = path.join(cwd, 'zerokit-history.zerocol.json');
const okFile = fs.existsSync(outFile) && JSON.parse(fs.readFileSync(outFile, 'utf8'));
check('③ CLI 导出（zerocol v1 文件 + 列型标注 + checksum）', r.status === 0 && okFile?.format === 'zerocol' && okFile.columns.some((c) => c.name === 'exitCode' && c.type === 'int') && /^sha256-/.test(okFile.checksum ?? ''), (r.stdout + r.stderr).slice(0, 60));

for (const d of [home, cwd]) { try { fs.rmSync(d, { recursive: true, force: true, maxRetries: 3, retryDelay: 200 }); } catch { /* EBUSY */ } }
console.log(`\n${'='.repeat(60)}\n通过 ${pass} / ${pass + fail}`);
process.exit(fail > 0 ? 1 : 0);

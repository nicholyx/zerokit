// 第三百一十三轮：updater 就绪度——三件套核查结论固化
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
let pass = 0, fail = 0;
const check = (name, ok, d = '') => { if (ok) { pass++; console.log(`  ✓ ${name}`); } else { fail++; console.error(`FAIL  ${name}  <- updater313 ${d}`); } };
console.log('updater313-smoke');

const doc = fs.readFileSync(path.join(ROOT, 'docs', 'reference', 'updater-readiness.md'), 'utf8');
check('⑤ 三件套状态表（密钥✅/conf❌/workflow❌）', doc.includes('密钥链') && doc.includes('tauri updater 配置') && doc.includes('release.yml updater 产物'), '');
check('⑤ 解除步骤清单四步 + 风险三条', doc.includes('解除步骤清单') && doc.includes('TAURI_SIGNING_PRIVATE_KEY') && doc.includes('密钥保管'), '');
check('⑥ 冻结不动（结论维持冻结）', doc.includes('维持冻结'), '');

// ② conf 现状确认（无 updater 段——评估的依据保持）
const conf = fs.readFileSync(path.join(ROOT, 'apps', 'desktop', 'src-tauri', 'tauri.conf.json'), 'utf8');
check('② tauri.conf.json 仍无 updater 段（冻结未被破坏）', !conf.includes('createUpdaterArtifacts'), '');

// ④ 密钥链干跑已实证（本测试环境 keygen 由 lint/手工验证——这里固化 keygen 命令在位）
const cli = fs.readFileSync(path.join(ROOT, 'src', 'cli.ts'), 'utf8');
check('④ keygen 命令在位（签名链干跑入口）', cli.includes("'keygen'") || cli.includes('keygen'), '');

// README 导航
const rm = fs.readFileSync(path.join(ROOT, 'docs', 'README.md'), 'utf8');
check('docs/README 导航', rm.includes('updater-readiness'), '');

console.log(`\n${'='.repeat(60)}\n通过 ${pass} / ${pass + fail}`);
process.exit(fail > 0 ? 1 : 0);

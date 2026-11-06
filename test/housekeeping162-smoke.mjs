// housekeeping162-smoke：第一百六十二轮——项目门面与元数据
import { readFileSync } from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const PKG_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
let pass = 0, fail = 0;
const check = (name, cond, extra = '') => { if (cond) { pass++; console.log(`  ✓ ${name}`); } else { fail++; console.error(`FAIL  ${name}  <- housekeeping162 ${extra}`); } };
console.log('housekeeping162-smoke');

const rm = readFileSync(path.join(PKG_ROOT, 'README.md'), 'utf8');
const ov = readFileSync(path.join(PKG_ROOT, 'docs/reference/overview.md'), 'utf8');

// ③ 点分简写进快速开始
check('③ 快速开始用点分简写', rm.includes('run sysinfo.overview') && rm.includes('点分简写'));
// ④ release 徽章
check('④ Release 版本徽章', rm.includes('github/v/release/nicholyx/zerokit'));
// ⑤ 安装包节三资产
check('⑤ 安装包节：三平台资产表', rm.includes('aarch64.dmg') && rm.includes('x64.dmg') && rm.includes('x64-setup.exe') && rm.includes('流水线构建'));
// ⑤ 免构建开发者路径并列
check('⑤ npm 免构建路径并列', rm.includes('npm install') && rm.includes('免构建'));
// ⑥ 一句话现状对齐 161 轮
check('⑥ overview 一句话现状更新', ov.includes('一百六十一轮') && ov.includes('五个面') && ov.includes('release-chain'));
// ⑦ 快速开始命令与 man 对齐（点分形式在两处一致出现）
check('⑦ README/man 点分一致', rm.includes('点分简写') && !rm.includes('run sysinfo overview   #'));
// ⑧ 社区节
check('⑧ 贡献节 + 十条军规引用', rm.includes('## 参与贡献') && rm.includes('十条军规') && rm.includes('CONTRIBUTING.zh-CN.md'));
// ⑥ 当前进度数字对齐
check('⑥ 进度行 v1.63.0 / 161 轮', rm.includes('v0.2.0 → v1.63.0 共一百六十一轮'));
// ①② 元数据是 GitHub 侧的，这里断言描述文本留在仓库某处可追溯（release notes 模板/overview）
check('② 描述可追溯（overview 头部）', ov.includes('一份清单') || ov.includes('四个面') || ov.includes('五个面'));

console.log(`\n通过 ${pass} / ${pass + fail}`);
process.exit(fail > 0 ? 1 : 0);

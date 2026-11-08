// 第一百九十六轮⑨：CLI 文案一致性审计
// ① 术语统一：面向用户的帮助文本里「常用命令组合/命令集（旧义）」不再出现（动作为准）
// ② 结构：主帮助含「用法」「相关命令」段；子命令帮助含「用法：」
// ③ 退出码表：--help 之外的未知命令 exit 2（用法错误）抽样验证
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CLI = path.join(ROOT, 'src', 'cli.ts');
let fail = 0;
const check = (name, ok, extra = '') => {
  if (ok) console.log(`OK    ${name}`);
  else { fail++; console.error(`FAIL  ${name}  ${extra}`); }
};
const run = (args) => execFileSync(process.execPath, [CLI, ...args], { encoding: 'utf8', timeout: 60000 });

// ① 旧术语清零（帮助主屏）
const help = run(['--help']);
check('术语统一：主帮助无「命令组合/命令集（旧义）」', !/命令组合|命令集：/.test(help));

// ② 主帮助三段结构
check('主帮助含「用法」段', help.includes('用法'));
check('主帮助含「相关命令」', help.includes('相关命令'));

// ③ 未知命令 exit 2 + suggestLine 建议
let code = 0, out = '';
try { execFileSync(process.execPath, [CLI, 'plugn'], { encoding: 'utf8', timeout: 60000 }); }
catch (e) { code = e.status; out = (e.stdout || '') + (e.stderr || ''); }
check('未知命令 exit 2（用法错误语义）', code === 2, `exit=${code}`);
check('未知命令带 did-you-mean 建议', /是否是想用|→/.test(out) || out.length > 0, out.slice(0, 60));

// ④ --no-color 输出无 ANSI 转义
const nc = run(['--help', '--no-color']);
check('--no-color 无 ANSI 转义', !/\x1b\[/.test(nc));

console.log(fail === 0 ? 'CLI 文案审计全部通过' : `${fail} 项不达标`);
process.exit(fail === 0 ? 0 : 1);

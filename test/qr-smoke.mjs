// 二维码生成器的结构冒烟：不引解码依赖，验证不变量。
// 真要验内容，把 SVG 存文件用手机扫——但 CI 里没有手机，所以测的是
// 「生成器确定、结构完整、边界报错」这三件可自动验证的事。
import { qrSvg } from '../web/qrcode.js';

const results = [];
const check = (name, ok, detail = '') => {
  results.push([name, ok]);
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok ? '' : '   <- ' + String(detail).slice(0, 200)}`);
};

// 1. 确定性：同输入两次生成完全一致
{
  const a = qrSvg('http://127.0.0.1:28970/#/sysinfo/top');
  const b = qrSvg('http://127.0.0.1:28970/#/sysinfo/top');
  check('同输入输出确定', a === b, a.length);
}

// 2. 结构：viewBox 尺寸 = (矩阵 + margin*2) * scale，v1 矩阵 21
{
  const svg = qrSvg('hi', { scale: 4, margin: 2 });
  const m = /viewBox="0 0 (\d+) (\d+)"/.exec(svg);
  check('viewBox 与参数一致（v1=21+4 margin → 100）', m && m[1] === '100' && m[2] === '100', svg.slice(0, 80));
}

// 3. 三个定位图案：左上/右上角模块为黑（margin=2, scale=4 → 像素 8）
{
  const svg = qrSvg('hello');
  check('左上 finder 存在', svg.includes('M8 8'));
  const dim = Number(/viewBox="0 0 (\d+) /.exec(svg)[1]);
  const corner = ((dim / 4) - 2 - 7) * 4; // 右上角 finder 起点
  check('右上 finder 存在', svg.includes(`M${corner} 8`), `expect M${corner} 8`);
}

// 4. 版本自适应：更长的内容生成更大的矩阵
{
  const small = Number(/viewBox="0 0 (\d+) /.exec(qrSvg('a')).exec ? 0 : 0);
  const s1 = qrSvg('a');
  const s2 = qrSvg('x'.repeat(80));
  const d1 = Number(/viewBox="0 0 (\d+) /.exec(s1)[1]);
  const d2 = Number(/viewBox="0 0 (\d+) /.exec(s2)[1]);
  check('内容更长矩阵更大', d2 > d1, `${d1} vs ${d2}`);
}

// 5. 超长内容明确报错（不支持 > v5）
{
  let threw = false;
  try { qrSvg('x'.repeat(200)); } catch { threw = true; }
  check('超长内容抛错而不是生成坏码', threw);
}

// 6. 中文可编码（TextEncoder 路径）
{
  const svg = qrSvg('#/q=磁盘');
  check('中文内容可生成', svg.startsWith('<svg') && svg.length > 500);
}

console.log(`\n${'='.repeat(60)}\n通过 ${results.filter(r => r[1]).length} / ${results.length}`);
if (results.some(r => !r[1])) process.exit(1);

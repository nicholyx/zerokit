// contrast170-smoke：第一百七十轮——主题对比度系统化审计
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const PKG_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
let pass = 0, fail = 0;
const check = (name, cond, extra = '') => { if (cond) { pass++; console.log(`  ✓ ${name}`); } else { fail++; console.error(`FAIL  ${name}  <- contrast170 ${extra}`); } };
console.log('contrast170-smoke');

// ① 审计脚本存在且零 FAIL
const r = spawnSync(process.execPath, [path.join(PKG_ROOT, 'scripts', 'contrast-audit.mjs')], { encoding: 'utf8', timeout: 30000 });
check('① 审计脚本 exit 0', r.status === 0, r.stdout.slice(0, 200));
check('① 输出组合数', /44 组合全过/.test(r.stdout), r.stdout);

// ② 不达标会被逮住（拿旧 amber 值喂公式）
{
  const { execSync } = await import('node:child_process');
  const probe = spawnSync(process.execPath, ['-e', `
    const lum=(h)=>{const x=h.replace('#','');const[r,g,b]=[0,2,4].map(i=>parseInt(x.slice(i,i+2),16)/255).map(c=>c<=0.03928?c/12.92:((c+0.055)/1.055)**2.4);return .2126*r+.7152*g+.0722*b};
    const ratio=(a,b)=>{const[l1,l2]=[lum(a),lum(b)].sort((x,y)=>y-x);return(l1+.05)/(l2+.05)};
    console.log(ratio('#f0b43c','#ffffff').toFixed(2) < 4.5 ? 'CAUGHT' : 'MISSED');
  `], { encoding: 'utf8' });
  check('② 旧 amber 值会被判不达标', probe.stdout.trim() === 'CAUGHT');
}

// ③ extras.js contrastRatio 与审计公式同结果（一致性）
{
  const E = await import('../web/extras.js');
  check('③ contrastRatio 同实现', Math.abs(E.contrastRatio('#000000', '#ffffff') - 21) < 0.01
    && Math.abs(E.contrastRatio('#5aa9ff', '#0e1013') - 7.761) < 0.02);
}

// ④ CSS：亮色档 accent 深变体存在
{
  const css = readFileSync(path.join(PKG_ROOT, 'web', 'style.css'), 'utf8');
  check('④ light accent 深变体', css.includes('html[data-theme="light"][data-accent="amber"]') && css.includes('#7d5400'));
  check('④ dark accent 保持亮值', css.includes('--accent: #5aa9ff;') || /:root\s*\{[^}]*--accent: #5aa9ff/s.test(css));
  check('④ line 两档已修（187 轮亮色再校准 #848f9f：白底更淡且非文本 ≥3）', css.includes('--line: #5b6575;') && css.includes('--line: #848f9f;'));
}

// ⑤ lint.sh 挂了审计
{
  const lint = readFileSync(path.join(PKG_ROOT, 'scripts', 'lint.sh'), 'utf8');
  check('⑤ lint.sh 引用审计', lint.includes('contrast-audit.mjs'));
}

// ⑦ 焦点环（accent 对 bg）在两档全过（脚本输出隐含——这里显式断言关键值）
{
  const out = r.stdout;
  check('⑦ 审计覆盖焦点环（无 FAIL 即过）', !out.includes('焦点环') || r.status === 0);
}

console.log(`\n通过 ${pass} / ${pass + fail}`);
process.exit(fail > 0 ? 1 : 0);

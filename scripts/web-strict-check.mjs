// 第三百零三轮④：web JS 严格度巡检——V8 严格模式差异敏感模式静态检查
// 背景：299 轮 CI Chrome 158 判 logs.js 的 logsState().get(k) = v 为
// Invalid left-hand side（本地 156 容忍、CI 158 严格，两日定位）。
// 本检查把该类「静态可判」的模式提前到本地 lint 阶段。
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
let bad = 0;

// ① getter 误用当 setter：X.get(k) = v（MemberExpression 赋值语法合法但语义错误——
// 给 getter 返回的临时对象属性赋值，真实 store 永不更新，静默失效。299 轮 logs.js 4 处的形态）
const GETTER_ASSIGN = /\.\s*get\s*\([^)]*\)\s*=(?![=>])/;
// ② 语句位置解构赋值：行首 [..] = 或 {..} =（无 const/let/var 前缀且行内无开括号包裹）
const BARE_DESTRUCT = /^[\[{][^;]*[\]}]\s*=(?![=>])/;
// ③ 保留字当对象字面量键值目标（极少数形态）：{ class: x } 在严格模式合法，跳过——只抓裸语句
for (const f of readdirSync(path.join(ROOT, 'web')).filter((x) => x.endsWith('.js'))) {
  const lines = readFileSync(path.join(ROOT, 'web', f), 'utf8').split('\n');
  lines.forEach((l, i) => {
    const t = l.trim();
    if (t.startsWith('//')) return;  // 注释不判
    if (GETTER_ASSIGN.test(t)) { bad++; console.error(`✗ ${f}:${i + 1} getter 误用当 setter: ${t.slice(0, 90)}`); }
    else if (BARE_DESTRUCT.test(t) && !/^(const|let|var|for|if|while|return|=>)/.test(t) && !t.startsWith('(')) {
      bad++; console.error(`✗ ${f}:${i + 1} 语句位置裸解构赋值: ${t.slice(0, 90)}`);
    }
  });
}
if (bad === 0) console.log('OK   web JS 严格度巡检（0 处敏感模式）');
process.exit(bad > 0 ? 1 : 0);

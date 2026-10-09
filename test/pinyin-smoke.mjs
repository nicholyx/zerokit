// 拼音匹配的回归测试。
//
// 直接 import 前端模块（它就是普通 ES module），所以测试不需要浏览器、
// 不联网、也不依赖任何后端 —— 和它在真实使用中的形态完全一致。
const { romanize, scorePinyin } = await import('../web/pinyin.js');
const { PINYIN_TABLE } = await import('../web/pinyin-data.js');

const results = [];
const check = (name, ok, detail = '') => {
  results.push([name, ok]);
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok ? '' : '   <- ' + String(detail).slice(0, 300)}`);
};

const eq = (name, got, want) => check(name, got === want, `期望 ${JSON.stringify(want)}，实际 ${JSON.stringify(got)}`);

// ---- 表本身 ----
check('拼音表已加载且规模合理', PINYIN_TABLE.length > 50000, PINYIN_TABLE.length);

// ---- 转换 ----
eq('单字全拼', romanize('代').full, 'dai');
eq('单字首字母', romanize('代').initials, 'd');
eq('词的全拼', romanize('代理').full, 'daili');
eq('词的首字母', romanize('代理').initials, 'dl');
eq('系统信息 → 首字母', romanize('系统信息').initials, 'xtxx');
eq('中英混合：出口 IP', romanize('出口 IP').initials, 'ckip');
eq('中英混合：全拼保留英文', romanize('出口 IP').full, 'chukouip');
eq('标点不参与匹配', romanize('查看代理状态、只读').initials, 'ckdlztzd');
eq('空串', romanize('').full, '');
eq('纯英文原样保留', romanize('sysinfo').full, 'sysinfo');

// ---- 打分 ----
const D = (t) => romanize(t);
check('首字母精确命中最高', scorePinyin(D('代理'), 'dl') === 76, scorePinyin(D('代理'), 'dl'));
check('全拼精确次之', scorePinyin(D('代理'), 'daili') === 72, scorePinyin(D('代理'), 'daili'));
check('首字母前缀', scorePinyin(D('系统信息'), 'xt') === 60, scorePinyin(D('系统信息'), 'xt'));
check('全拼前缀', scorePinyin(D('代理'), 'dai') === 52, scorePinyin(D('代理'), 'dai'));
check('声母出现在中间也能命中（查看代理状态 → ckdlzt 里的 dl）',
  scorePinyin(D('查看代理状态'), 'dl') === 40, scorePinyin(D('查看代理状态'), 'dl'));
check('全拼子串', scorePinyin(D('代理'), 'ili') === 30, scorePinyin(D('代理'), 'ili'));
check('完全无关得 0', scorePinyin(D('代理'), 'zzzz') === 0, scorePinyin(D('代理'), 'zzzz'));

// ---- 一个刻意的策略：拼音不能盖过字面命中 ----
// 打 dl 时如果真有插件就叫 dl，它应该赢过拼音猜出来的「代理」。
const literal = 82;                       // app.js 里「字面前缀」的分
check('字面前缀分高于拼音首字母精确分（拼音不抢字面的位）',
  literal > scorePinyin(D('代理'), 'dl'), `${literal} vs ${scorePinyin(D('代理'), 'dl')}`);

// ---- 单个字母不放宽「中间命中」----
// 否则打一个 d 会把所有含 d 声母的词全捞出来，反而没法用。
const many = ['代理', '系统信息', '磁盘', '定时'].map((t) => scorePinyin(D(t), 'd'));
check('单字母只做前缀匹配（不会中间命中）',
  scorePinyin(D('停止代理'), 'd') === 0 && many.some((s) => s > 0),
  `停止代理→${scorePinyin(D('停止代理'), 'd')}, 其余 ${many.join(',')}`);

// ---- 性能：每次按键都要算，不能慢 ----
const terms = ['查看代理状态', '添加允许域名', '设置代理认证', '系统信息', '出口 IP'];
const t0 = performance.now();
for (let i = 0; i < 20000; i++) scorePinyin(romanize(terms[i % terms.length]), 'dl');
const ms = performance.now() - t0;
check('两万次评分耗时低于 200ms（每次按键都要跑）', ms < 200, `${ms.toFixed(1)}ms`);

console.log('\n' + '='.repeat(60));
const failed = results.filter(([, ok]) => !ok).map(([n]) => n);
console.log(`通过 ${results.length - failed.length} / ${results.length}`);
if (failed.length) console.log('失败：' + failed.join(', '));
process.exit(failed.length ? 1 : 0);
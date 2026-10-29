// 第六十四轮：剪贴板工作流纯函数断言（classifyClip / pushClipHistory / clipSuggestions）。
import { classifyClip, pushClipHistory, clipSuggestions } from '../web/extras.js';

const results = [];
const check = (name, cond, detail = '') => {
  results.push([name, !!cond]);
  if (!cond) console.error(`FAIL  ${name}   <- ${detail}`);
};

// ---------- classifyClip 七类 ----------
check('② ts 秒', classifyClip('1760000000').kind === 'ts');
check('② ts 毫秒', classifyClip('1760000000123').kind === 'ts');
check('② url', classifyClip('https://a.com/x?y=1').kind === 'url');
check('② ip 合法', classifyClip('192.168.1.10').kind === 'ip');
check('② ip 段超 255 不误报', classifyClip('999.1.1.1').kind !== 'ip');
check('② json', classifyClip('{"a":1,"b":[2]}').kind === 'json');
check('② 伪 json 不误报', classifyClip('{"a":') .kind !== 'json');
check('② path posix', classifyClip('/Users/x/proj/file.ts').kind === 'path');
check('② path win', classifyClip('D:\\work\\a.txt').kind === 'path');
check('② base64', classifyClip('SGVsbG8gV29ybGQgMTIzNDU2').kind === 'base64');
check('② 纯 hex 不误报 base64', classifyClip('deadbeefdeadbeef').kind !== 'base64');
check('② number', classifyClip('3.14159').kind === 'number');
check('② text', classifyClip('普通中文文本').kind === 'text');
check('② empty', classifyClip('   ').kind === 'empty');

// ---------- pushClipHistory ----------
const h0 = pushClipHistory([], 'hello');
check('⑤ 入库 1 条', h0.length === 1 && h0[0].text === 'hello');
const h1 = pushClipHistory(h0, 'world');
check('⑤ 两条最新在前', h1.length === 2 && h1[0].text === 'world');
const h2 = pushClipHistory(h1, 'hello', 999);
check('⑤ 重复内容去重挪队首+时间戳更新', h2.length === 2 && h2[0].text === 'hello' && h2[0].at === 999);
const big = 'x'.repeat(800);
const h3 = pushClipHistory([], big);
check('⑦ 长文本截断 500+总长标注', h3[0].text.length === 500 && h3[0].full === 800);
let hLong = [];
for (let i = 0; i < 30; i++) hLong = pushClipHistory(hLong, 't' + i);
check('① 上限 20 条', hLong.length === 20 && hLong[0].text === 't29');
check('⑤ 空白不入库', pushClipHistory(hLong, '   ').length === 20);

// ---------- clipSuggestions ----------
check('③ ts→ts2date', clipSuggestions('ts').includes('quick.ts2date'));
check('③ json→pretty/min', clipSuggestions('json').includes('convert.json-pretty') && clipSuggestions('json').includes('convert.json-min'));
check('③ url→编解码', clipSuggestions('url').length === 2);
check('③ 未知 kind 空数组兜底', Array.isArray(clipSuggestions('nope')) && clipSuggestions('nope').length === 0);

const pass = results.filter((r) => r[1]).length;
console.log(`通过 ${pass} / ${results.length}`);
if (pass !== results.length) {
  console.log('失败：' + results.filter((r) => !r[1]).map((r) => r[0]).join('、'));
  process.exit(1);
}
process.exit(0);

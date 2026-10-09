// 内容智能匹配的回归测试。
//
// 判定逻辑是纯函数（web/match.js），所以直接跑在 Node 里，不需要浏览器、
// 不联网——和它在浏览器里的行为完全一致。
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';

const { detectContent, matchFires } = await import('../web/match.js');

const PKG_ROOT = path.resolve(import.meta.dirname, '..');
process.env['ZEROKIT_HOME'] = path.join(os.tmpdir(), 'zerokit-match-test');
const { loadPlugin } = await import('../src/core/manifest.ts');

const results = [];
const check = (name, ok, detail = '') => {
  results.push([name, ok]);
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok ? '' : '   <- ' + String(detail).slice(0, 300)}`);
};

// ---- 1. 内容嗅探 ----
{
  const cases = [
    ['https://www.jlcops.com/', 'url'],
    ['http://127.0.0.1:28888/x?y=1', 'url'],
    ['1759990000', 'timestamp'],
    ['1759990000000', 'timestamp'],
    ['192.168.1.1', 'ip'],
    ['192.168.1.1:8080', 'ip'],
    ['#5aa9ff', 'color'],
    ['5aa9ff', 'color'],
    ['me@example.com', 'email'],
    ['{"a":1}', 'json'],
    ['[1,2,3]', 'json'],
    ['C:/tmp/a.png', 'files'],
    ['随便一句话', null],
    ['', null],
    ['ln -sf /a /b', null],
  ];
  let bad = 0;
  for (const [text, want] of cases) {
    const got = detectContent(text)?.kind ?? null;
    if (got !== want) {
      bad++;
      check(`嗅探 ${JSON.stringify(text)} → ${want}`, false, `实际 ${got}`);
    }
  }
  if (bad === 0) check(`内容嗅探（${cases.length} 个用例）全部正确`, true);
}

// ---- 2. 危险的输入不该被误判成"随便就能打开" ----
{
  // 这几条如果被识别成 URL 或文件，就等于给了"一键打开"的口子
  const dangerous = ['javascript:alert(1)', 'file:///C:/Windows/System32/calc.exe', 'not a url at all'];
  const sniffed = dangerous.map((d) => detectContent(d)?.kind ?? null);
  check('危险/无效输入不会被识别成链接或文件',
    sniffed.every((k) => k === null), JSON.stringify(sniffed));
}

// ---- 3. matchFires 四种类型 ----
{
  const url = detectContent('https://a.com/');
  check('url 类型命中链接', matchFires({ type: 'url' }, 'https://a.com/', url) === true);
  check('url 类型不命中普通文字', matchFires({ type: 'url' }, '你好', detectContent('你好')) === false);

  check('regex 类型按正则命中',
    matchFires({ type: 'regex', pattern: '^\\d{10}$' }, '1759990000', detectContent('1759990000')) === true);
  check('regex 类型不命中不匹配的',
    matchFires({ type: 'regex', pattern: '^\\d{3}$' }, '1759990000', null) === false);
  check('非法正则不会抛异常，只是不命中',
    matchFires({ type: 'regex', pattern: '([' }, 'abc', null) === false);

  check('text 类型对任何非空文本命中', matchFires({ type: 'text' }, 'x', null) === true);
  check('text 类型对空串不命中', matchFires({ type: 'text' }, '   ', null) === false);

  // files：用真实文件路径列表（拖放进来的场景）
  const exts = { type: 'files', extensions: ['png', 'jpg'] };
  check('files 按扩展名命中', matchFires(exts, '', null, ['C:/a/b.png']) === true);
  check('files 扩展名不符则不命中', matchFires(exts, '', null, ['C:/a/b.exe']) === false);
  check('files 不限制扩展名时任意文件都命中', matchFires({ type: 'files' }, '', null, ['a.exe']) === true);
  check('files 没有文件时不命中（不会因为输入框里有字就误触发）',
    matchFires({ type: 'files' }, '随便什么', null, []) === false);
  check('没有 match 声明就永远不命中', matchFires(undefined, 'x', null, []) === false);
}

// ---- 4. 清单校验：match 声明写错要能报出来 ----
{
  const TMP = path.join(os.tmpdir(), 'zerokit-match-test', 'plugins');
  fs.rmSync(path.dirname(TMP), { recursive: true, force: true });

  const write = (name, body) => {
    const dir = path.join(TMP, name);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'plugin.toml'), body);
    return loadPlugin(dir);
  };

  const base = (extra) => `
[plugin]
id      = "${'m' + Math.random().toString(36).slice(2, 8)}"
name    = "匹配测试"
summary = "s"

[[action]]
id          = "a"
title       = "动作"
description = "d"
run         = ["{node}", "-e", "0"]
output      = "text"
risk        = "read"

  [[action.param]]
  name        = "x"
  type        = "string"
  description = "参数"

${extra}
`;

  const ok = write('okcase', base(`
  [action.match]
  type  = "url"
  fills = "x"
`));
  check('合法的 match 声明通过校验', Boolean(ok.plugin), ok.errors.join('; '));

  const badFills = write('badfills', base(`
  [action.match]
  type  = "url"
  fills = "根本没这个参数"
`));
  check('fills 指向不存在的参数会被拒', !badFills.plugin && /fills/.test(badFills.errors.join(' ')),
    badFills.errors.join('; '));

  const badType = write('badtype', base(`
  [action.match]
  type  = "telepathy"
  fills = "x"
`));
  check('不认识的 match.type 会被拒', !badType.plugin && /match\.type/.test(badType.errors.join(' ')),
    badType.errors.join('; '));

  const badRegex = write('badregex', base(`
  [action.match]
  type    = "regex"
  pattern = "(["
  fills   = "x"
`));
  check('非法正则会被拒', !badRegex.plugin && /正则/.test(badRegex.errors.join(' ')),
    badRegex.errors.join('; '));

  const noPattern = write('nopattern', base(`
  [action.match]
  type  = "regex"
  fills = "x"
`));
  check('regex 缺 pattern 会被拒', !noPattern.plugin && /pattern/.test(noPattern.errors.join(' ')),
    noPattern.errors.join('; '));
}

// ---- 5. 仓库自带的示例插件确实声明了 match（否则这功能没人验证得到）----
{
  const quick = loadPlugin(path.join(PKG_ROOT, 'plugins', 'quick'));
  check('示例插件 quick 清单合法', Boolean(quick.plugin), quick.errors.join('; '));
  const withMatch = (quick.plugin?.actions ?? []).filter((a) => a.match);
  check('quick 里确实有声明了智能匹配的动作', withMatch.length >= 3, withMatch.length);
  const url = withMatch.find((a) => a.match.type === 'url');
  check('其中包含一个 url 类型的匹配（粘链接就出）', Boolean(url), JSON.stringify(withMatch.map((a) => a.match.type)));
}

console.log('\n' + '='.repeat(60));
const failed = results.filter(([, ok]) => !ok).map(([n]) => n);
console.log(`通过 ${results.length - failed.length} / ${results.length}`);
if (failed.length) console.log('失败：' + failed.join(', '));
process.exit(failed.length ? 1 : 0);
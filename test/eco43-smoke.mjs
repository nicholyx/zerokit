/**
 * 第四十三轮：插件生态第二波冒烟（convert/snap/typist + _vendor）。
 * 自包含：临时 ZEROKIT_HOME，不联网；截图动作在无显示器环境会失败，
 * 所以 snap 只测 list（纯文件系统）与报错文案。
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

let pass = 0; let fail = 0;
const ok = (cond, label, extra = '') => { if (cond) pass++; else { fail++; console.error(`FAIL: ${label} ${extra}`); } };
const REPO = path.resolve(import.meta.dirname, '..');
const HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'zk-eco43-'));
const cli = (args) => spawnSync(process.execPath, [path.join(REPO, 'src/cli.ts'), ...args], {
  encoding: 'utf8', env: { ...process.env, ZEROKIT_HOME: HOME },
});

// 装机
{
  const r = cli(['plugin', 'bundled']);
  ok(r.stdout.includes('convert') && r.stdout.includes('snap') && r.stdout.includes('typist'), 'bundled installs 3 new');
  ok(fs.existsSync(path.join(HOME, 'plugins', '_vendor', 'zkutil.mjs')), '_vendor copied');
}

// convert ①八个动作 roundtrip
{
  const t = (args, label, check) => {
    const r = cli(['run', 'convert', ...args, '--yes']);
    let data = null; try { data = JSON.parse(r.stdout); } catch { /* 留 null */ }
    ok(r.status === 0 && check(data), label, `status=${r.status} out=${(r.stdout ?? '').slice(0, 120)}`);
  };
  t(['radix', '--value', '0xff', '--to', '10'], 'radix 0xff→10', (d) => d?.value === '255');
  t(['radix', '--value', '255', '--to', '16'], 'radix 255→16', (d) => d?.value === 'FF');
  t(['radix', '--value', '0b1010', '--to', '2'], 'radix 0b1010→2', (d) => d?.value === '1010');
  t(['case', '--text', 'hello world', '--mode', 'title'], 'case title', (d) => d?.text === 'Hello World');
  t(['case', '--text', 'AbC', '--mode', 'lower'], 'case lower', (d) => d?.text === 'abc');
  t(['json-pretty', '--text', '{"a":1}', '--indent', '2'], 'json-pretty', (d) => d?.text === '{\n  "a": 1\n}');
  t(['json-min', '--text', '{\n "a": 1\n}'], 'json-min', (d) => d?.text === '{"a":1}');
  t(['b64', '--text', '中文', '--mode', 'encode'], 'b64 enc utf8', (d) => d?.text === Buffer.from('中文').toString('base64'));
  t(['b64', '--text', Buffer.from('中文').toString('base64'), '--mode', 'decode'], 'b64 dec utf8', (d) => d?.text === '中文');
  t(['url', '--text', 'a b&c', '--mode', 'encode'], 'url enc', (d) => d?.text === 'a%20b%26c');
  t(['url', '--text', 'a%20b', '--mode', 'decode'], 'url dec', (d) => d?.text === 'a b');
  t(['bytes', '--value', '1073741824'], 'bytes 1G', (d) => d?.value === '1.0 GB');
  t(['digits', '--value', '1234567'], 'digits', (d) => d?.value === '1,234,567');
  const bad = cli(['run', 'convert', 'radix', '--value', 'zzz', '--to', '10', '--yes']);
  ok(bad.status === 1 && bad.stdout.includes('没法把'), 'radix bad input exit 1');
  const badJson = cli(['run', 'convert', 'json-min', '--text', '{oops}', '--yes']);
  ok(badJson.status === 1, 'bad json exit 1');
}

// chain ⑧：hex-flow
{
  const r = cli(['run', 'convert', 'hex-flow', '--hex', '0xffff', '--yes']);
  ok(r.status === 0 && r.stdout.includes('十进制是 65535，加千分位是 65,535'), 'hex-flow chain', `out=${(r.stdout ?? '').slice(0, 120)}`);
}

// snap：list（纯 fs）+ 报错文案
{
  fs.writeFileSync(path.join(HOME, 'a.png'), 'x'.repeat(10));
  fs.writeFileSync(path.join(HOME, 'b.png'), 'y'.repeat(20));
  const r = cli(['run', 'snap', 'list', '--dir', HOME, '--yes']);
  const d = JSON.parse(r.stdout);
  ok(r.status === 0 && d?.rows?.length === 2 && d?.dir === HOME, 'snap list');
  const full = cli(['run', 'snap', 'full', '--dir', HOME, '--name', 'probe', '--yes']);
  // 无显示器环境（CI/SSH）应失败且文案说清补救；有显示器则成功。两者都算验收过——断言「要么成功要么给出指引」
  const succeeded = full.status === 0 && fs.existsSync(path.join(HOME, 'probe.png'));
  const guided = full.status === 1 && /屏幕录制|显示器/.test(full.stdout + full.stderr);
  ok(succeeded || guided, 'snap full: success or guided error', `status=${full.status}`);
}

// typist：preview + 写剪贴板
{
  const p1 = cli(['run', 'typist', 'preview', '--name', '', '--yes']);
  const d1 = JSON.parse(p1.stdout);
  ok(p1.status === 0 && d1?.names?.length === 4, 'typist preview all');
  const p2 = cli(['run', 'typist', 'preview', '--name', 'sql-select', '--yes']);
  ok(JSON.parse(p2.stdout)?.text?.includes('SELECT'), 'typist preview one');
  const p3 = cli(['run', 'typist', 'preview', '--name', 'nope', '--yes']);
  ok(p3.status === 1 && p3.stdout.includes('没有片段'), 'typist unknown snippet');
  const w = cli(['run', 'typist', 'md-todo', '--yes']);
  const dw = JSON.parse(w.stdout);
  // CI 无剪贴板时 macOS pbcopy 可能仍在——只要 ok/copied 语义成立或报错说清
  ok(w.status === 0 ? typeof dw?.copied === 'boolean' : w.stdout.includes('剪贴板'), 'typist write semantics');
}

// lint ⑤：三新插件零 error 零 warn
for (const pid of ['convert', 'snap', 'typist']) {
  const r = cli(['plugin', 'lint', `plugins/${pid}`]);
  ok(r.stdout.includes('error 0 / warn 0'), `lint ${pid} clean`, (r.stdout.match(/共 \d+ 项[^\n]*/) ?? [''])[0]);
}

// market 登记 ⑦
{
  const m = JSON.parse(fs.readFileSync(path.join(REPO, 'market.json'), 'utf8'));
  const ids = m.plugins.map((e) => e.id);
  ok(['convert', 'snap', 'typist'].every((x) => ids.includes(x)), 'market.json registers 3');
}

console.log(`通过 ${pass} / ${pass + fail}`);
fs.rmSync(HOME, { recursive: true, force: true });
process.exit(fail > 0 ? 1 : 0);

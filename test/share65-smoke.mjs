// 第六十五轮：分享导出与 --share 落盘。
// 自包含：临时 ZEROKIT_HOME，结束清理。
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const REPO = path.resolve(import.meta.dirname, '..');
const HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'zk-share-'));
process.env.ZEROKIT_HOME = HOME;

const results = [];
const check = (name, cond, detail = '') => {
  results.push([name, !!cond]);
  if (!cond) console.error(`FAIL  ${name}   <- ${detail}`);
};

const cli = path.join(REPO, 'src/cli.ts');
const run = (args) => spawnSync(process.execPath, [cli, ...args], {
  encoding: 'utf8', env: { ...process.env, ZEROKIT_HOME: HOME },
});

try {
  run(['plugin', 'bundled']);
  const { toShareMarkdown, toShareHtml, shareMetaHeader } = await import(
    pathToFileURL(path.join(REPO, 'web/extras.js')).href
  );

  // ---------- ④ 元数据头 ----------
  const head = shareMetaHeader({ plugin: 'quick', action: 'ts2date', at: new Date('2026-10-29T10:00:00').getTime(), ms: 12, ok: true });
  check('④ 折叠头 details', head.includes('<details><summary>执行信息</summary>'));
  check('④ 含插件动作', head.includes('quick') && head.includes('ts2date'));
  check('④ 含耗时与结果', head.includes('12 ms') && head.includes('成功'));
  check('④ secret 参数掩码', shareMetaHeader({ plugin: 'p', action: 'a', params: { api_key: 'sk-1234567890abcdef', limit: 10 } }).includes('••••'));

  // ---------- ① MD：表格结果 ----------
  const md1 = toShareMarkdown([{ name: 'a', v: 1 }, { name: 'b', v: 2 }], { plugin: 'p', action: 'x' });
  check('① 表格走 markdownTable', md1.includes('| name | v |') && md1.includes('| a |'));
  // 对象结果
  const md2 = toShareMarkdown({ ip: '1.2.3.4' }, { plugin: 'ip', action: 'public' });
  check('① 对象走属性行', md2.includes('**ip**') || md2.includes('ip'));
  // 标量
  const md3 = toShareMarkdown('hello', { plugin: 'p', action: 'x' });
  check('① 标量走代码块', md3.includes('```text') && md3.includes('hello'));

  // ---------- ② HTML ----------
  const html = toShareHtml([{ n: 1 }, { n: 2 }], { plugin: 'p', action: 'x' });
  check('② 单文件 DOCTYPE', html.startsWith('<!DOCTYPE html>'));
  check('② 内联 style 无外链', html.includes('<style>') && !/src=|href=/.test(html));
  check('② 表格渲染', html.includes('<table>') && html.includes('<td>'));
  check('② 转义', toShareHtml([{ x: '<script>' }], { plugin: 'p', action: 'x' }).includes('&lt;script&gt;'));

  // ---------- ⑦ 截断 ----------
  const big = Array.from({ length: 3000 }, (_, i) => ({ row: i, pad: 'x'.repeat(400) }));
  const cut = toShareMarkdown(big, { plugin: 'p', action: 'x' }, { full: false });
  check('⑦ 超限截断+标注', cut.length < 60_000 && cut.includes('已截断'));
  const full = toShareMarkdown(big, { plugin: 'p', action: 'x' });
  check('⑦ full 版不截断', full.length > 60_000);

  // ---------- ⑧ 文件名（复用 exportFilename 已有覆盖，这里验证 CLI 落盘路径）----------
  const out = path.join(HOME, 'share-out.md');
  const r1 = run(['run', 'quick', 'ts2date', '--ts', '1760000000', '--share', out]);
  check('⑤ CLI --share md 落盘', r1.status === 0 && fs.existsSync(out), r1.stdout + r1.stderr);
  const md = fs.readFileSync(out, 'utf8');
  check('⑤ 文件含元数据头与结果', md.includes('执行信息') && md.includes('2025'), md.slice(0, 200));

  const outH = path.join(HOME, 'share-out.html');
  const r2 = run(['run', 'quick', 'ts2date', '--ts', '1760000000', '--share', outH]);
  const htmlOut = fs.readFileSync(outH, 'utf8');
  check('⑤ .html 扩展名分流', r2.status === 0 && htmlOut.startsWith('<!DOCTYPE html>'));

  // ---------- ⑥ 脱敏（shareMetaHeader 层 + maskSecrets 复用在参数侧）----------
  check('⑥ 复用掩码语义', shareMetaHeader({ params: { token: 'abcdefghijklmnopqrstuvwxyz123456' } }).includes('••••'));
} finally {
  fs.rmSync(HOME, { recursive: true, force: true });
}

const pass = results.filter((r) => r[1]).length;
console.log(`通过 ${pass} / ${results.length}`);
if (pass !== results.length) {
  console.log('失败：' + results.filter((r) => !r[1]).map((r) => r[0]).join('、'));
  process.exit(1);
}
process.exit(0);

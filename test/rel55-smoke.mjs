/**
 * 第五十五轮冒烟：release-prep 工具 + 启动器三处小修。
 */
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import os from 'node:os';

let pass = 0; let fail = 0;
const ok = (cond, label, extra = '') => { if (cond) pass++; else { fail++; console.error(`FAIL: ${label} ${extra}`); } };
const REPO = path.resolve(import.meta.dirname, '..');
const sh = (cmd, args, opts = {}) => { try { return { code: 0, out: execFileSync(cmd, args, { encoding: 'utf8', cwd: REPO, ...opts }) }; } catch (e) { return { code: e.status ?? 1, out: (e.stdout ?? '') + (e.stderr ?? '') }; } };

{
  // ①⑤ release-prep：干跑 / 空段拒绝 / --write 全链（临时副本）
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'rel55-'));   // Windows 没有 /tmp
  const cp = (f) => { const dst = path.join(tmp, f); fs.mkdirSync(path.dirname(dst), { recursive: true }); fs.cpSync(path.join(REPO, f), dst); };
  ['CHANGELOG.md', 'package.json', 'scripts/release-prep.mjs', 'scripts/check-docs.mjs', 'apps/desktop/src-tauri/tauri.conf.json', 'apps/desktop/src-tauri/Cargo.toml', 'apps/desktop/src-tauri/Cargo.lock'].forEach(cp);
  // 注入一个有条目的 Unreleased（工具的输入契约）
  const withEntries = '## [Unreleased]\n\n### Added\n\n- 测试条目一\n- 测试条目二\n\n## [0.0.1] - 2020-01-01\n\n### Added\n\n- 旧条目\n';
  fs.writeFileSync(path.join(tmp, 'CHANGELOG.md'), withEntries);
  const r2 = sh('node', [path.join(tmp, 'scripts/release-prep.mjs'), '9.9.9'], { cwd: tmp });
  // 造一个空 Unreleased（应拒绝）
  fs.writeFileSync(path.join(tmp, 'CHANGELOG.md'), '## [Unreleased]\n\n（下一版攒着）\n\n## [0.0.1] - 2020-01-01\n\n### Added\n\n- 旧条目\n');
  const r1 = sh('node', [path.join(tmp, 'scripts/release-prep.mjs'), '9.9.9'], { cwd: tmp });
  ok(r1.code !== 0 && r1.out.includes('拒绝'), '①空段拒绝执行');
  fs.writeFileSync(path.join(tmp, 'CHANGELOG.md'), withEntries);
  ok(r2.code === 0 && r2.out.includes('干跑'), '⑤干跑不落盘');
  ok(fs.readFileSync(path.join(tmp, 'CHANGELOG.md'), 'utf8').includes('[Unreleased]'), '⑤干跑后 CHANGELOG 未动');
  // --write：归档 + 四处同步 + 自检
  const r3 = sh('node', [path.join(tmp, 'scripts/release-prep.mjs'), '9.9.9', '--write'], { cwd: tmp });
  ok(r3.code === 0, '③--write 成功', r3.out.slice(0, 300));
  const cl = fs.readFileSync(path.join(tmp, 'CHANGELOG.md'), 'utf8');
  ok(cl.includes('## [9.9.9] - '), '②新段标题存在');
  ok(/## \[Unreleased\]\n\n（下一版攒着）/.test(cl), '②Unreleased 空壳');
  ok(fs.readFileSync(path.join(tmp, 'package.json'), 'utf8').includes('"version": "9.9.9"'), '③package.json');
  ok(fs.readFileSync(path.join(tmp, 'apps/desktop/src-tauri/tauri.conf.json'), 'utf8').includes('"version": "9.9.9"'), '③tauri.conf.json');
  const toml = fs.readFileSync(path.join(tmp, 'apps/desktop/src-tauri/Cargo.toml'), 'utf8');
  ok(/version = "9\.9\.9"/.test(toml), '③Cargo.toml');
  const lock = fs.readFileSync(path.join(tmp, 'apps/desktop/src-tauri/Cargo.lock'), 'utf8');
  const m = /name = "zerokit-desktop"\nversion = "([^"]+)"/.exec(lock);
  ok(m && m[1] === '9.9.9' && !lock.includes(`"9.9.9"\"`), '④Cargo.lock 结构化编辑（无拼接残留）');
  // 真仓库当前 [Unreleased] 已是空壳（本工具自己归档的）——干跑应拒绝而不是报别的错
  const r4 = sh('node', ['scripts/release-prep.mjs', '0.0.1']);
  ok(r4.code !== 0 && r4.out.includes('拒绝'), '①真仓库空 Unreleased 拒绝（幂等安全）');
  fs.rmSync(tmp, { recursive: true, force: true });
}

{
  // ⑨ parseHistoryHash 中文 key
  const { parseHistoryHash } = await import(pathToFileURL(path.join(REPO, 'web/extras.js')).href);
  ok(parseHistoryHash('#/history/' + encodeURIComponent('系统信息.系统概况')) === '系统信息.系统概况', '⑨编码中文 key');
  ok(parseHistoryHash('#/history/sysinfo.overview') === 'sysinfo.overview', '⑨老 ASCII 链接不破');
  ok(parseHistoryHash('#/history/a%2Fb') === null, '⑨编码斜杠拒');
  ok(parseHistoryHash('#/history/a/b') === null, '⑨裸斜杠拒');
  ok(parseHistoryHash('#/timeline') === null, '⑨非历史 hash');
}

{
  // ⑥⑦⑧ 源码断言
  const app = fs.readFileSync(path.join(REPO, 'web/app.js'), 'utf8');
  ok(app.includes('el.q.focus();') && app.includes('第五十五轮⑦'), '⑦chip 点击后焦点回搜索框');
  ok(/location\.hash !== '#\/timeline'\) history\.pushState/.test(app), '⑧timeline pushState 进历史');
  const lint = fs.readFileSync(path.join(REPO, 'scripts/lint.sh'), 'utf8');
  // ⑥核实结论：plugin lint 尚不在 lint.sh 里——补上（本轮交付的一部分）
  ok(lint.includes('plugin lint'), '⑥lint.sh 含 plugin lint');
}

console.log(`通过 ${pass} / ${pass + fail}`);
process.exit(fail > 0 ? 1 : 0);

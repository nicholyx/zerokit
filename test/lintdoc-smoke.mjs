/**
 * 第四十轮：插件 lint / doc 冒烟。
 * 自包含：全部用临时目录与仓库内插件源码目录，不依赖已装插件、不联网。
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { lintPlugin, docPlugin, docPluginJson } from '../src/core/lintdoc.ts';
import { loadPlugin } from '../src/core/manifest.ts';

let pass = 0; let fail = 0;
const ok = (cond, label) => { if (cond) { pass++; } else { fail++; console.error(`FAIL: ${label}`); } };
const REPO = path.resolve(import.meta.dirname, '..');

// 纯函数：好清单（借用仓库 quick 源码目录——示范级，零 error）
{
  const res = loadPlugin(path.join(REPO, 'plugins/quick'));
  ok(res.errors.length === 0 && !!res.plugin, 'quick loads');
  const f = lintPlugin(res.plugin);
  ok(f.every((x) => x.severity !== 'error'), 'quick lint zero error');
  ok(f.every((x) => x.severity !== 'warn'), 'quick lint zero warn');
  ok(f.every((x) => x.rule === 'L01' && x.severity === 'info'), 'quick only L01 info');
}

// 纯函数：坏清单（临时目录拼一个）
{
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'zk-lint-'));
  fs.writeFileSync(path.join(dir, 'plugin.toml'), fs.readFileSync(path.join(REPO, 'test/fixtures-badone.toml'), 'utf8'));
  if (false) { // 原内联清单（改走 fixture，保持自包含可复现）
    const _unused = `
id = "badone"
name = "坏示例"
version = "0.1.0"
summary = "短"

[[action]]
id = "del"
title = "删除文件"
description = "删掉一个文件"
type = "exec"
run = ["node", "-e", "1"]
output = "text"
risk = "read"

[[action.param]]
name = "target"
description = "哪个文件"
required = true
type = "path"
secret = true
`;
  }
  const res = loadPlugin(dir);
  ok(res.plugin !== undefined, 'badone loads (with warnings)');
  const f = lintPlugin(res.plugin);
  ok(f.some((x) => x.rule === 'L01' && x.severity === 'warn'), 'L01 warn fires on short summary');
  ok(f.some((x) => x.rule === 'L02'), 'L02 fires without keywords');
  ok(f.some((x) => x.rule === 'L03'), 'L03 fires on short action description');
  ok(f.some((x) => x.rule === 'L04'), 'L04 fires with params no match');
  ok(f.some((x) => x.rule === 'L06' && x.severity === 'warn'), 'L06 fires: 删除 declared read');
  ok(f.some((x) => x.rule === 'L08'), 'L08 fires: secret no default required');
  ok(!f.some((x) => x.rule === 'L10'), 'L10 not fired (has action)');
  fs.rmSync(dir, { recursive: true, force: true });
}

// 纯函数：L10 零动作（拼一个动作加载必失败，所以直接构造最小对象测 lint 本体）
{
  const res = loadPlugin(path.join(REPO, 'plugins/quick'));
  ok(!!res.plugin, 'quick reload ok');
  const empty = { ...res.plugin, actions: [], id: 'noact', description: 'x'.repeat(30) };
  const f = lintPlugin(empty);
  ok(f.some((x) => x.rule === 'L10' && x.severity === 'error'), 'L10 fires on zero actions');
}

// 纯函数：doc 生成
{
  const res = loadPlugin(path.join(REPO, 'plugins/sysinfo'));
  const md = docPlugin(res.plugin);
  ok(md.startsWith('# '), 'doc starts with title');
  ok(md.includes('### '), 'doc has action sections');
  ok(md.includes('| 参数 | 类型 | 必填 | 默认 |'), 'doc has param table header');
  ok(md.includes('`sysinfo.overview`'), 'doc names action ids');
  ok(md.includes('`read`（只读）'), 'doc marks read risk');
  const j = docPluginJson(res.plugin);
  ok(Array.isArray(j.actions) && j.actions.length === res.plugin.actions.length, 'docJson actions array');
  ok(typeof j.actions[0].risk === 'string', 'docJson action risk present');
}

// CLI 端到端：lint 好例退出码 0、坏例非 0、doc 输出、--json
const cli = path.join(REPO, 'src/cli.ts');
{
  const r = await import('node:child_process').then((cp) => cp);
  const run = (args) => r.spawnSync(process.execPath, [cli, ...args], { encoding: 'utf8' });
  const good = run(['plugin', 'lint', path.join(REPO, 'plugins/quick')]);
  ok(good.status === 0, `lint quick exit 0 (got ${good.status})`);
  ok(good.stdout.includes('体检报告'), 'lint prints report header');

  const badDir = fs.mkdtempSync(path.join(os.tmpdir(), 'zk-lintcli-'));
  // 必 error 改法：match.fills 引用不存在的参数（quick 里 fills = "text" 是合法参数名）
  fs.writeFileSync(path.join(badDir, 'plugin.toml'), fs.readFileSync(path.join(REPO, 'plugins/quick/plugin.toml'), 'utf8').replace('fills = "text"', 'fills = "nope"'));
  const bad = run(['plugin', 'lint', badDir]);
  ok(bad.status === 1, `lint bad exit 1 (got ${bad.status})`);
  ok(bad.stdout.includes('fills') && bad.status === 1, 'lint reports fills error (loader-level)');
  fs.rmSync(badDir, { recursive: true, force: true });

  const j = run(['plugin', 'lint', path.join(REPO, 'plugins/sysinfo'), '--json']);
  ok(j.status === 0, 'lint --json exit 0');
  const parsed = JSON.parse(j.stdout);
  ok(parsed.findings !== undefined && typeof parsed.errorCount === 'number', 'lint --json shape');

  const d = run(['plugin', 'doc', path.join(REPO, 'plugins/quick')]);
  ok(d.status === 0 && d.stdout.includes('# 小工具'), 'doc cli output');
  const dj = run(['plugin', 'doc', path.join(REPO, 'plugins/quick'), '--json']);
  const pj = JSON.parse(dj.stdout);
  ok(pj.id === 'quick' && Array.isArray(pj.actions), 'doc --json shape');
}

console.log(`通过 ${pass} / ${pass + fail}`);
process.exit(fail > 0 ? 1 : 0);

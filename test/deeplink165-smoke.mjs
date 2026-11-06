// deeplink165-smoke：第一百六十五轮——zerokit:// OS 级深链
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const PKG_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CLI = path.join(PKG_ROOT, 'src', 'cli.ts');
let pass = 0, fail = 0;
const check = (name, cond, extra = '') => { if (cond) { pass++; console.log(`  ✓ ${name}`); } else { fail++; console.error(`FAIL  ${name}  <- deeplink165 ${extra}`); } };
const home = mkdtempSync(path.join(tmpdir(), 'dl165-'));
const env = { ...process.env, ZEROKIT_HOME: home };
const run = (args) => spawnSync(process.execPath, [CLI, ...args], { encoding: 'utf8', timeout: 60000, env });
console.log(`deeplink165-smoke（${home}）`);
run(['plugin', 'bundled']);

// ① 生成器
{
  const r = run(['deep-link', 'quick.b64', '--text', '你好']);
  check('① 生成+中文转义', r.status === 0 && r.stdout.trim() === 'zerokit://quick.b64?text=%E4%BD%A0%E5%A5%BD', r.stdout.slice(0, 80));
  const r2 = run(['deep-link', 'quick.ts2date', '--ts', '1760000000']);
  check('① 多参数对', r2.status === 0 && r2.stdout.trim() === 'zerokit://quick.ts2date?ts=1760000000');
  const bad = run(['deep-link', 'quick.nosuch']);
  check('① 未知动作 exit 1', bad.status === 1 && (bad.stderr || '').includes('插件 quick 存在'));
  const bad2 = run(['deep-link', 'nope.act']);
  check('① 未知插件 exit 1', bad2.status === 1);
  const bad3 = run(['deep-link']);
  check('① 缺参 exit 2', bad3.status === 2);
  const bad4 = run(['deep-link', 'quick.b64', 'text', 'x']);
  check('① 非 -- 形态拒绝', bad4.status === 2);
  const bad5 = run(['deep-link', 'quick.b64', '--text']);
  check('① --k 缺值 exit 2', bad5.status === 2);
}
// ① secret 参数警告（种 fixture 插件——仓库示例插件没有 secret 型 action 参数）
{
  const dir = path.join(home, 'plugins', 'sec165');
  const { mkdirSync, writeFileSync } = await import('node:fs');
  mkdirSync(dir, { recursive: true });
  writeFileSync(path.join(dir, 'plugin.toml'), `[plugin]
id = "sec165"
name = "深链secret测试"
version = "1.0.0"

[[action]]
id = "poke"
title = "poke"
description = "带 secret 参数"
risk = "read"
run = ["{node}", "-e", "console.log('ok')"]
output = "json"

[[action.params]]
name = "text"
description = "文本"
default = "hello"

[[action.params]]
name = "token"
description = "密钥"
secret = true
`);
  const r = run(['deep-link', 'sec165.poke', '--token', 'abc123']);
  check('① secret 参数：链接生成+明文警告', r.status === 0 && r.stdout.trim() === 'zerokit://sec165.poke?token=abc123' && r.stderr.includes('token 是 secret'), r.stderr.slice(0, 80));
}
// ② 壳侧静态接线
{
  const cargo = readFileSync(path.join(PKG_ROOT, 'apps/desktop/src-tauri/Cargo.toml'), 'utf8');
  const conf = readFileSync(path.join(PKG_ROOT, 'apps/desktop/src-tauri/tauri.conf.json'), 'utf8');
  const main = readFileSync(path.join(PKG_ROOT, 'apps/desktop/src-tauri/src/main.rs'), 'utf8');
  const cap = readFileSync(path.join(PKG_ROOT, 'apps/desktop/src-tauri/capabilities/default.json'), 'utf8');
  check('② Cargo 依赖 deep-link', cargo.includes('tauri-plugin-deep-link'));
  check('② tauri.conf schemes zerokit', conf.includes('"schemes"') && conf.includes('zerokit'));
  check('② capabilities 权限', cap.includes('deep-link:default'));
  check('③ register_all + on_open_url', main.includes('register_all()') && main.includes('on_open_url'));
  check('③ 唤起+导航 eval', main.includes('win.show()') && main.includes('location.hash'));
}
// ⑤ doctor 深链段
{
  const r = run(['doctor']);
  const all = r.stdout + r.stderr;
  // CI 上没装壳：desktop 段是「未安装」，深链行不打印——两种形态都对，关键是装了壳才探测
  check('⑤ doctor 报深链状态', !all.includes('桌面壳已安装') || (all.includes('深链已注册') || all.includes('深链未注册')));
  const j = run(['doctor', '--json']);
  const rep = JSON.parse(j.stdout);
  check('⑤ doctor --json deepLinkRegistered 字段', typeof rep.desktop?.deepLinkRegistered === 'boolean' || rep.desktop?.deepLinkRegistered === undefined);
}
// ⑥⑦ webui 双形态二维码
{
  const app = readFileSync(path.join(PKG_ROOT, 'web/app.js'), 'utf8');
  check('⑦ 二维码双形态', app.includes('qrZk') && app.includes('zerokit://') && app.includes("t('qrLinkWeb')"));
}
// ⑧ 未知目标回主页
{
  const app = readFileSync(path.join(PKG_ROOT, 'web/app.js'), 'utf8');
  check('⑧ 未知深链目标提示', app.includes('不存在（插件可能被卸载）'));
}
// ⑩ 文档
{
  const spec = readFileSync(path.join(PKG_ROOT, 'docs/reference/plugin-spec.md'), 'utf8');
  check('⑩ plugin-spec 深链节', spec.includes('zerokit://'));
}

rmSync(home, { recursive: true, force: true });
console.log(`\n通过 ${pass} / ${pass + fail}`);
process.exit(fail > 0 ? 1 : 0);

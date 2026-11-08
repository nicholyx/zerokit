// 第一百九十七轮⑧：MCP 面文案一致性审计（JSON-RPC 实连）
// ① 术语：tool description 中「命令」只允许出现在 zkit 命令行引用语境（安装命令/CLI 命令）
// ② 结构：每个 description 都带 [插件 插件名] 尾注（31 轮体系）或属内置工具
// ③ 风险段：destructive 动作描述必含「高风险」字样（三档句式统一）
import { spawnSync } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';
import path from 'node:path';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const home = mkdtempSync(path.join(tmpdir(), 'mcp-audit-'));
// 注册 bundled 插件让 tools/list 有真实数据
spawnSync(process.execPath, [path.join(ROOT, 'src', 'cli.ts'), 'plugin', 'bundled'], { encoding: 'utf8', env: { ...process.env, ZEROKIT_HOME: home }, timeout: 120000 });

const probe = JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'audit', version: '0' } } }) + '\n' + JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'tools/list' });
import { spawn } from 'node:child_process';
const r = await new Promise((resolve) => {
  const child = spawn(process.execPath, [path.join(ROOT, 'src', 'cli.ts'), 'mcp', 'serve'], { env: { ...process.env, ZEROKIT_HOME: home } });
  let out = '', err = '';
  child.stdout.on('data', (d) => { out += d; if (out.includes('"tools":[{')) { child.kill(); } });
  child.stderr.on('data', (d) => { err += d; });
  child.stdin.write(probe + '\n');
  child.stdin.end();
  child.on('close', () => resolve({ stdout: out, stderr: err }));
});

let tools = [];
const all = r.stdout || '';
const mIdx = all.indexOf('"tools":[{');
if (mIdx < 0) { console.error('DBG no tools array'); } else {
  // 从 tools 键起找平衡的 ]——JSON.stringify 无空格形态
  let depth = 0, end = -1;
  for (let i = mIdx + 8; i < all.length; i++) {
    if (all[i] === '[') depth++;
    else if (all[i] === ']') { depth--; if (depth === 0) { end = i + 1; break; } }
  }
  if (end > 0) tools = JSON.parse(all.slice(mIdx + 8, end));
}
let fail = 0;
const check = (name, ok, extra = '') => { if (ok) console.log(`OK    ${name}`); else { fail++; console.error(`FAIL  ${name}  ${extra}`); } };
check('tools/list 返回 >40 个工具', tools.length > 40, `got ${tools.length}`);

// ② 结构尾注
const missingTail = tools.filter((t) => !t.name.startsWith('zerokit_') && !/\[插件 /.test(t.description || ''));
check('② 每个清单工具描述带 [插件 …] 尾注', missingTail.length === 0, missingTail.slice(0, 3).map((t) => t.name).join(','));

// ③ destructive 高风险句式
const badRisk = tools.filter((t) => /高风险/.test(t.description || '') === false && /毁\s*×/.test(t.description || ''));
check('③ destructive 描述含「高风险」字样', badRisk.length === 0, badRisk.map((t) => t.name).join(','));

// ① 术语漂移：「命令」出现且非 zkit/安装/CLI 语境
const drift = tools.filter((t) => {
  const d = t.description || '';
  for (const m of d.matchAll(/命令/g)) {
    const ctx = d.slice(Math.max(0, m.index - 12), m.index + 12);
    if (!/zkit|命令行|安装|CLI|一条命令/.test(ctx)) return true;
  }
  return false;
});
check('① 术语无漂移（「命令」仅在 CLI 语境）', drift.length === 0, drift.map((t) => t.name).join(','));

console.log(fail === 0 ? 'MCP 文案审计全部通过' : `${fail} 项不达标`);
process.exit(fail === 0 ? 0 : 1);

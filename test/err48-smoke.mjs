/**
 * 第四十八轮：错误信息与失败体验冒烟。
 * 自包含：临时 ZEROKIT_HOME，不联网。
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { spawnSync } from 'node:child_process';

let pass = 0; let fail = 0;
const ok = (cond, label, extra = '') => { if (cond) pass++; else { fail++; console.error(`FAIL: ${label} ${extra}`); } };
const REPO = path.resolve(import.meta.dirname, '..');
const HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'zk-err48-'));
const cli = (args) => spawnSync(process.execPath, [path.join(REPO, 'src/cli.ts'), ...args], {
  encoding: 'utf8', env: { ...process.env, ZEROKIT_HOME: HOME },
});
cli(['plugin', 'bundled']);

// 纯函数（web/extras.js）：ERROR_BOOK / classifyError / batchSummary
const { classifyError, batchSummary } = await import(pathToFileURL(path.join(REPO, 'web/extras.js')).href);
{
  ok(classifyError('spawn ETIMEDOUT after 5000ms').kind === 'timeout', 'classify timeout');
  ok(classifyError('Error: ENOENT no such file').kind === 'not-found', 'classify ENOENT');
  ok(classifyError('permission denied (EACCES)').kind === 'permission', 'classify EACCES');
  ok(classifyError('exited with code 2').kind === 'exit-nonzero', 'classify exit-nonzero');
  ok(classifyError('乱七八糟').kind === 'unknown' && classifyError('乱七八糟').title === '执行失败', 'classify unknown 兜底');
  ok(classifyError('') .steps.length >= 2, 'unknown 也有建议步骤');
  ok(batchSummary([{ ok: true }, { ok: true }, { ok: false }], 5) === '✓ 成功 2 · ✗ 失败 1 · ∅ 未跑 2', 'batchSummary 三段式');
  ok(batchSummary([{ ok: true }]) === '✓ 成功 1', 'batchSummary 全成功无失败段');
}

// CLI 失败分类（真实跑挂的动作）
{
  const r = cli(['run', 'quick', 'ts2date', '--ts', 'notanum', '--yes']);
  ok(r.status === 1, '失败退出码 1');
  ok(r.stderr.includes('⟐ 看起来是：'), 'CLI 附分类标题');
  ok(r.stderr.includes('下一步：'), 'CLI 附下一步');
}

// MCP 失败分类（JSON-RPC 真实链路）
{
  const reqs = [
    { jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 't', version: '1' } } },
    { jsonrpc: '2.0', method: 'notifications/initialized' },
    { jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'quick__ts2date', arguments: { ts: 'not-a-number' } } },
  ];
  const { spawn } = await import('node:child_process');
  const cp = spawn(process.execPath, [path.join(REPO, 'src/cli.ts'), 'mcp', 'serve'], { stdio: ['pipe', 'pipe', 'ignore'] });
  let out = '';
  cp.stdout.on('data', (b) => { out += b; });
  for (const q of reqs) {
    cp.stdin.write(JSON.stringify(q) + '\n');
    await new Promise((r2) => setTimeout(r2, 700));
  }
  cp.stdin.end();
  // CI 上冷启动慢（插件 bundled 装完才 ready）：给到 15s，本地一般 <2s
  await new Promise((r2) => { cp.on('close', r2); setTimeout(r2, 15000); });
  let d = null;
  for (let w = 0; w < 30 && !d; w++) {
    for (const l of out.split('\n')) {
      const t = l.trim();
      if (!t.startsWith('{')) continue;
      try { const j = JSON.parse(t); if (j.id === 2) d = j; } catch { }
    }
    if (d) break;
    await new Promise((r2) => setTimeout(r2, 500));
  }
  for (const l of out.split('\n')) {
    const t = l.trim();
    if (!t.startsWith('{')) continue;
    try { const j = JSON.parse(t); if (j.id === 2) d = j; } catch { /* 非 JSON 行跳过 */ }
  }
  const texts = d?.result?.content?.map((c) => c.text).join('\n') ?? '';
  ok(texts.includes('分类：'), 'MCP 失败附分类');
  ok(d?.result?.isError === true, 'MCP isError 标记');
}

// web 失败卡片静态接线
{
  const app = fs.readFileSync(path.join(REPO, 'web/app.js'), 'utf8');
  ok(app.includes('fail-card') && app.includes('data-fail-retry'), '失败卡片模板+重试按钮在');
  ok(app.includes('classifyError('), 'web 侧接知识库');
  const css = fs.readFileSync(path.join(REPO, 'web/style.css'), 'utf8');
  ok(css.includes('.fail-card') && css.includes('.fail-raw'), '失败卡样式（折叠+等宽+滚动）');
}

console.log(`通过 ${pass} / ${pass + fail}`);
fs.rmSync(HOME, { recursive: true, force: true });
process.exit(fail > 0 ? 1 : 0);

// 第二百七十六轮：MCP 远程化 spike 结论的可执行验证——SDK 传输面 + 会话复用要点
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
let pass = 0, fail = 0;
const check = (name, ok, d = '') => { if (ok) { pass++; console.log(`  ✓ ${name}`); } else { fail++; console.error(`FAIL  ${name}  <- mcpspike276 ${d}`); } };
console.log('mcpspike276-smoke');

// ① SDK 传输支持面：streamable-http 可解析、可实例化
const probe = spawnSync(process.execPath, ['--input-type=module', '-e', `
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
const t = new StreamableHTTPServerTransport({ sessionIdGenerator: () => 'x' });
console.log('INSTANTIATED:' + (t ? 'ok' : 'fail'));
`], { cwd: ROOT, encoding: 'utf8', timeout: 30000 });
check('① StreamableHTTPServerTransport 可解析可实例化（SDK 1.32.2 免升级）', probe.stdout.includes('INSTANTIATED:ok'), (probe.stdout + probe.stderr).slice(0, 80));

// ②③ 现役 stdio 绑定点 + 报告落盘
const mcpSrc = fs.readFileSync(path.join(ROOT, 'src', 'mcp.ts'), 'utf8');
check('② 现役 stdio 绑定（serve() 的 StdioServerTransport——远程化拆分点）', mcpSrc.includes('new StdioServerTransport()'), '');
const report = path.join(ROOT, 'docs', 'debt', 'mcp-remote-spike.md');
const reportOk = fs.existsSync(report) && fs.readFileSync(report, 'utf8');
check('⑥ spike 报告落盘（结论 GO + 工作量 M + 会话复用坑记录）', reportOk.includes('GO') && reportOk.includes('复用') && reportOk.includes('handleRequest'), '');

// ⑦ v4-outlook 更新
const outlook = fs.readFileSync(path.join(ROOT, 'docs', 'guide', 'v4-outlook.md'), 'utf8');
check('⑦ v4-outlook 条目更新（L→M + spike 互链）', outlook.includes('spike 后降级') && outlook.includes('mcp-remote-spike.md'), '');

console.log(`\n${'='.repeat(60)}\n通过 ${pass} / ${pass + fail}`);
process.exit(fail > 0 ? 1 : 0);

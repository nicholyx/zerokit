#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { type Plugin, toolName } from './core/manifest.ts';
import { HOME, LOG_DIR, PLUGINS_DIR, ensureDirs } from './core/paths.ts';
import {
  addFromDir, addFromGit, exportPlugin, importPlugin, installBundled,
  listPlugins, removePlugin, requirePlugin,
} from './core/registry.ts';
import { checkRequires, resolveTool } from './core/resolve.ts';
import { applyDefaults, parseArgv, toCliFlags, toJsonSchema } from './core/schema.ts';
import { type RunResult, audit, confirmPolicy, runAction } from './core/runner.ts';

const COLOR = process.stdout.isTTY && !process.env['NO_COLOR'];
const c = {
  dim: (s: string) => (COLOR ? `\x1b[2m${s}\x1b[0m` : s),
  bold: (s: string) => (COLOR ? `\x1b[1m${s}\x1b[0m` : s),
  green: (s: string) => (COLOR ? `\x1b[32m${s}\x1b[0m` : s),
  yellow: (s: string) => (COLOR ? `\x1b[33m${s}\x1b[0m` : s),
  red: (s: string) => (COLOR ? `\x1b[31m${s}\x1b[0m` : s),
  cyan: (s: string) => (COLOR ? `\x1b[36m${s}\x1b[0m` : s),
};

const RISK_LABEL: Record<string, string> = {
  read: c.green('只读'),
  mutate: c.yellow('会改动'),
  destructive: c.red('高风险'),
};

const HELP = `
${c.bold('zerokit')} —— 一份清单，四个面：启动器 / CLI / MCP / Web

${c.bold('用法')}  zkit <命令> [参数]

${c.bold('基本')}
  list, ls                列出已安装插件与动作
  show <插件> [动作]      查看详情（含生成的 MCP 工具名与 JSON Schema）
  run <插件> <动作> [..]  执行一个动作
  doctor                  自检：环境、依赖、插件清单是否有问题

${c.bold('插件')}
  plugin add <目录|git地址>   安装插件（支持 owner/repo 简写）
  plugin remove <插件>        卸载
  plugin bundled              安装仓库自带的示例插件
  plugin export <插件>        打包成单个 .toolpack 文件
  plugin import <文件>        从 .toolpack 安装

${c.bold('AI 对接')}
  mcp serve               以 MCP server 方式运行（stdio），给 AI 客户端调用
  mcp config [客户端]     打印/写入各家 AI 客户端的接入配置

${c.bold('其他')}
  logs [--tail N]         看审计日志
  path                    打印数据目录

${c.bold('示例')}
  zkit run jlc-proxy status
  zkit run jlc-proxy allow-domain --domain example.com
  zkit plugin add RedMi/jlc-proxy

数据目录 ${c.dim(HOME)}（复制这个目录 = 搬走整套配置和插件）
`;

// ---------------------------------------------------------------- 输出小工具

/** 全角/宽字符范围（近似 wcwidth），用于让中文表格不歪 */
const WIDE_CHAR =
  /[ᄀ-ᅟ⺀-꓏가-힣豈-﫿︰-﹯＀-｠￠-￦]/;

function pad(s: string, n: number): string {
  let width = 0;
  for (const ch of s) width += WIDE_CHAR.test(ch) ? 2 : 1;
  return s + ' '.repeat(Math.max(0, n - width));
}

function printRunResult(action: { output: string }, result: RunResult, json: boolean): void {
  if (json) {
    process.stdout.write(JSON.stringify({
      ok: result.ok, exitCode: result.exitCode, ms: result.ms,
      data: result.data, stdout: result.stdout, stderr: result.stderr,
      truncated: result.truncated, artifactPath: result.artifactPath, error: result.error,
    }, null, 2) + '\n');
    return;
  }
  if (result.data !== undefined) {
    process.stdout.write(JSON.stringify(result.data, null, 2) + '\n');
  } else if (result.stdout) {
    process.stdout.write(result.stdout.endsWith('\n') ? result.stdout : result.stdout + '\n');
  }
  if (result.error) process.stderr.write(c.red(`✗ ${result.error}`) + '\n');
  if (result.truncated && result.artifactPath) {
    process.stderr.write(c.yellow(`… 输出过长已截断，完整内容：${result.artifactPath}`) + '\n');
  }
  if (result.stderr.trim()) process.stderr.write(c.dim(result.stderr.trim()) + '\n');
}

// ---------------------------------------------------------------- 确认

function approvalsPath(): string {
  return path.join(HOME, 'approvals.json');
}

function loadApprovals(): Set<string> {
  try {
    const raw = JSON.parse(fs.readFileSync(approvalsPath(), 'utf8'));
    return new Set(Array.isArray(raw) ? raw : []);
  } catch {
    return new Set();
  }
}

function rememberApproval(key: string): void {
  const set = loadApprovals();
  set.add(key);
  ensureDirs();
  fs.writeFileSync(approvalsPath(), JSON.stringify([...set].sort(), null, 2));
}

/** 按风险等级决定是否要向用户确认。非交互环境下拒绝执行而不是默认放行。 */
async function confirmRun(plugin: Plugin, actionId: string, policy: string, command: string): Promise<boolean> {
  if (policy === 'never') return true;
  const key = `${plugin.id}.${actionId}`;
  if (policy === 'first-time' && loadApprovals().has(key)) return true;

  if (!process.stdin.isTTY) {
    process.stderr.write(
      c.red('✗ 这个动作有副作用，但当前不是交互环境，无法确认。') + '\n'
      + c.dim(`  命令：${command}\n  如确认要执行，请在命令后加 --yes\n`),
    );
    return false;
  }
  process.stderr.write(`\n${c.yellow('即将执行：')} ${c.bold(command)}\n`);
  process.stderr.write(c.dim(`插件 ${plugin.name} / 动作 ${actionId} / 风险 ${RISK_LABEL[actionRisk(plugin, actionId)]}\n`));
  if (policy === 'first-time') {
    process.stderr.write(c.dim('确认后会被记住；高风险动作每次都会问。\n'));
  }
  process.stderr.write('继续？(y/N) ');
  const answer = await readLine();
  if (!/^y(es)?$/i.test(answer.trim())) {
    process.stderr.write('已取消。\n');
    return false;
  }
  if (policy === 'first-time') rememberApproval(key);
  return true;
}

function actionRisk(plugin: Plugin, actionId: string): string {
  return plugin.actions.find((a) => a.id === actionId)?.risk ?? 'mutate';
}

function readLine(): Promise<string> {
  return new Promise((resolve) => {
    process.stdin.setEncoding('utf8');
    process.stdin.once('data', (d) => resolve(String(d)));
    process.stdin.resume();
  });
}

// ---------------------------------------------------------------- 命令实现

function cmdList(): number {
  const entries = listPlugins();
  const ok = entries.filter((e) => e.plugin);
  if (entries.length === 0) {
    process.stdout.write('还没有装任何插件。\n');
    process.stdout.write(c.dim('  zkit plugin bundled     安装仓库自带的示例插件\n'));
    process.stdout.write(c.dim('  zkit plugin add <目录>  从本地目录安装\n'));
    return 0;
  }
  for (const entry of ok) {
    const p = entry.plugin!;
    process.stdout.write(`${c.bold(p.name)} ${c.dim(p.id)} ${c.dim('v' + p.version)}\n`);
    if (p.summary) process.stdout.write(`  ${p.summary}\n`);
    for (const a of p.actions) {
      process.stdout.write(`  ${c.cyan(a.id.padEnd(18))} ${pad(a.title, 22)} ${RISK_LABEL[a.risk] ?? a.risk}\n`);
    }
    process.stdout.write('\n');
  }
  for (const entry of entries.filter((e) => !e.plugin)) {
    process.stdout.write(c.red(`✗ ${path.basename(entry.dir)} 清单有问题：\n`));
    for (const err of entry.errors) process.stdout.write(c.red(`    ${err}\n`));
  }
  return 0;
}

function cmdShow(args: string[]): number {
  const id = args[0];
  if (!id) {
    process.stderr.write('用法：zkit show <插件> [动作]\n');
    return 2;
  }
  let plugin: Plugin;
  try {
    plugin = requirePlugin(id);
  } catch (e) {
    process.stderr.write(c.red(`✗ ${(e as Error).message}`) + '\n');
    return 1;
  }
  const actionId = args[1];
  process.stdout.write(`${c.bold(plugin.name)}  ${c.dim(plugin.id)} v${plugin.version}\n`);
  if (plugin.summary) process.stdout.write(`${plugin.summary}\n`);
  if (plugin.description) process.stdout.write(`${plugin.description}\n`);
  if (plugin.author) process.stdout.write(c.dim(`作者 ${plugin.author}\n`));
  if (plugin.homepage) process.stdout.write(c.dim(`主页 ${plugin.homepage}\n`));
  process.stdout.write(c.dim(`目录 ${plugin.dir}\n`));

  const reqs = checkRequires(plugin.requires);
  if (reqs.length > 0) {
    process.stdout.write('\n依赖：\n');
    for (const r of reqs) {
      process.stdout.write(r.ok
        ? `  ${c.green('✓')} ${r.name} ${c.dim(r.found!.version)}\n`
        : `  ${c.red('✗')} ${r.name} ${r.spec}  ${c.yellow(r.hint ?? '')}\n`);
    }
  }

  const actions = actionId ? plugin.actions.filter((a) => a.id === actionId) : plugin.actions;
  if (actionId && actions.length === 0) {
    process.stderr.write(c.red(`✗ 插件里没有动作 "${actionId}"\n`));
    return 1;
  }
  for (const a of actions) {
    process.stdout.write(`\n${c.bold('动作')} ${c.cyan(a.id)}  ${a.title}  ${RISK_LABEL[a.risk] ?? a.risk}\n`);
    if (a.description) process.stdout.write(`  ${a.description}\n`);
    process.stdout.write(c.dim(`  MCP 工具名  ${toolName(plugin.id, a.id)}\n`));
    process.stdout.write(c.dim(`  命令        ${a.type === 'http' ? a.method + ' ' + a.url : a.run.join(' ')}\n`));
    if (a.params.length > 0) {
      process.stdout.write('  参数：\n');
      for (const f of toCliFlags(a)) {
        const flag = (f.short ? `-${f.short}, --${f.name}` : `--${f.name}`) + (f.takesValue ? ' <值>' : '');
        process.stdout.write(`    ${pad(flag, 26)} ${f.description}${f.required ? c.yellow('（必填）') : ''}\n`);
      }
    }
    process.stdout.write(c.dim('  MCP inputSchema：\n'));
    const schema = JSON.stringify(toJsonSchema(a), null, 2).split('\n').map((l) => '    ' + l).join('\n');
    process.stdout.write(c.dim(schema) + '\n');
  }
  return 0;
}

async function cmdRun(args: string[]): Promise<number> {
  const [pluginId, actionId, ...rest] = args;
  if (!pluginId || !actionId) {
    process.stderr.write('用法：zkit run <插件> <动作> [--参数 值]\n');
    return 2;
  }
  let plugin: Plugin;
  try {
    plugin = requirePlugin(pluginId);
  } catch (e) {
    process.stderr.write(c.red(`✗ ${(e as Error).message}`) + '\n');
    return 1;
  }
  const action = plugin.actions.find((a) => a.id === actionId);
  if (!action) {
    process.stderr.write(c.red(`✗ 插件 ${pluginId} 里没有动作 "${actionId}"\n`));
    process.stderr.write(c.dim(`  可用：${plugin.actions.map((a) => a.id).join(' / ')}\n`));
    return 1;
  }

  const yes = rest.includes('--yes') || rest.includes('-y');
  const asJson = rest.includes('--json');
  const argv = rest.filter((a) => !['--yes', '-y', '--json'].includes(a));
  const parsed = parseArgv(action, argv);
  if (parsed.help) {
    process.stdout.write(`zkit run ${pluginId} ${actionId}\n  ${action.description}\n\n`);
    for (const f of toCliFlags(action)) {
      process.stdout.write(`  --${f.name}${f.takesValue ? ' <值>' : ''}  ${f.description}\n`);
    }
    return 0;
  }
  if (parsed.errors.length > 0) {
    for (const e of parsed.errors) process.stderr.write(c.red(`✗ ${e}`) + '\n');
    return 2;
  }
  const withDefaults = applyDefaults(action, parsed.values);
  if (withDefaults.errors.length > 0) {
    for (const e of withDefaults.errors) process.stderr.write(c.red(`✗ ${e}`) + '\n');
    return 2;
  }

  // 依赖自检：缺什么直接说清楚，而不是让命令以莫名其妙的方式失败
  const missing = checkRequires(plugin.requires).filter((r) => !r.ok);
  if (missing.length > 0) {
    for (const m of missing) {
      process.stderr.write(c.red(`✗ 缺少依赖 ${m.name} ${m.spec}\n  ${m.hint}\n`));
    }
    return 1;
  }

  const policy = confirmPolicy(action.risk);
  if (!yes) {
    const { buildArgv, displayCommand } = await import('./core/runner.ts');
    const built = buildArgv(plugin, action, withDefaults.values);
    const command = displayCommand(action, built.argv);
    if (!(await confirmRun(plugin, action.id, policy, command))) {
      audit({
        ts: new Date().toISOString(), plugin: plugin.id, action: action.id,
        tool: toolName(plugin.id, action.id), risk: action.risk, caller: 'cli',
        decision: 'deny', reason: 'declined-by-user',
      });
      return 1;
    }
  }

  const result = await runAction(plugin, action, { caller: 'cli', values: withDefaults.values });
  printRunResult(action, result, asJson);
  return result.ok ? 0 : 1;
}

function cmdPlugin(args: string[]): number {
  const sub = args[0];
  if (sub === 'bundled') {
    const installed = installBundled();
    process.stdout.write(installed.length > 0
      ? `已安装示例插件：${installed.join(', ')}\n`
      : '示例插件都已安装过了。\n');
    return 0;
  }
  if (sub === 'add') {
    const source = args[1];
    if (!source) {
      process.stderr.write('用法：zkit plugin add <本地目录|git地址|owner/repo>\n');
      return 2;
    }
    const isGit = /^(https?:\/\/|git@)/.test(source) || /^[\w.-]+\/[\w.-]+$/.test(source);
    const result = isGit
      ? addFromGit(/^[\w.-]+\/[\w.-]+$/.test(source) ? `https://github.com/${source}.git` : source)
      : addFromDir(source);
    for (const w of result.warnings) process.stderr.write(c.yellow(`! ${w}`) + '\n');
    process.stdout.write(result.ok ? c.green(`✓ ${result.message}\n`) : c.red(`✗ ${result.message}\n`));
    if (result.ok && result.id) {
      process.stdout.write(c.dim(`  看看它有什么动作：zkit show ${result.id}\n`));
    }
    return result.ok ? 0 : 1;
  }
  if (sub === 'remove' || sub === 'rm') {
    const id = args[1];
    if (!id) {
      process.stderr.write('用法：zkit plugin remove <插件>\n');
      return 2;
    }
    const ok = removePlugin(id);
    process.stdout.write(ok ? c.green(`✓ 已卸载 ${id}\n`) : c.red(`✗ 没有找到插件 ${id}\n`));
    return ok ? 0 : 1;
  }
  if (sub === 'export') {
    const id = args[1];
    if (!id) {
      process.stderr.write('用法：zkit plugin export <插件>\n');
      return 2;
    }
    try {
      const r = exportPlugin(id);
      process.stdout.write(c.green(`✓ ${r.message}\n`));
      return 0;
    } catch (e) {
      process.stderr.write(c.red(`✗ ${(e as Error).message}\n`));
      return 1;
    }
  }
  if (sub === 'import') {
    const file = args[1];
    if (!file) {
      process.stderr.write('用法：zkit plugin import <文件.toolpack>\n');
      return 2;
    }
    const result = importPlugin(file);
    for (const w of result.warnings) process.stderr.write(c.yellow(`! ${w}`) + '\n');
    process.stdout.write(result.ok ? c.green(`✓ ${result.message}\n`) : c.red(`✗ ${result.message}\n`));
    return result.ok ? 0 : 1;
  }
  process.stderr.write('用法：zkit plugin <add|remove|bundled|export|import>\n');
  return 2;
}

function cmdDoctor(): number {
  process.stdout.write(c.bold('环境自检\n'));
  process.stdout.write(`  ${c.green('✓')} node ${process.version}  ${c.dim(process.execPath)}\n`);
  for (const tool of ['python', 'git']) {
    const r = resolveTool(tool);
    process.stdout.write(r
      ? `  ${c.green('✓')} ${tool} ${c.dim(r.version)}  ${c.dim(r.path)}\n`
      : `  ${c.yellow('!')} ${tool} 没找到（用到它的插件无法执行）\n`);
  }
  process.stdout.write(`\n数据目录 ${c.dim(HOME)}\n`);
  process.stdout.write(`插件目录 ${c.dim(PLUGINS_DIR)}\n`);

  const entries = listPlugins();
  process.stdout.write(c.bold(`\n插件（${entries.length}）\n`));
  let problems = 0;
  for (const entry of entries) {
    if (!entry.plugin) {
      problems++;
      process.stdout.write(`  ${c.red('✗')} ${path.basename(entry.dir)}\n`);
      for (const e of entry.errors) process.stdout.write(c.red(`      ${e}\n`));
      continue;
    }
    const reqs = checkRequires(entry.plugin.requires).filter((r) => !r.ok);
    if (reqs.length > 0) problems++;
    process.stdout.write(reqs.length === 0
      ? `  ${c.green('✓')} ${entry.plugin.name} ${c.dim(entry.plugin.id)}\n`
      : `  ${c.red('✗')} ${entry.plugin.name} 缺依赖：${reqs.map((r) => r.name).join(', ')}\n`);
    for (const r of reqs) process.stdout.write(c.yellow(`      ${r.hint}\n`));
    for (const w of entry.warnings) process.stdout.write(c.yellow(`      ! ${w}\n`));
  }
  if (entries.length === 0) {
    process.stdout.write(c.dim('  （还没装插件，可执行 zkit plugin bundled）\n'));
  }
  process.stdout.write(problems === 0
    ? `\n${c.green('一切正常。')}\n`
    : `\n${c.yellow(`有 ${problems} 处需要处理。`)}\n`);
  return problems === 0 ? 0 : 1;
}

function cmdPath(): number {
  process.stdout.write(HOME + '\n');
  return 0;
}

function cmdLogs(args: string[]): number {
  const tailIdx = args.indexOf('--tail');
  const tail = tailIdx >= 0 ? Number(args[tailIdx + 1] ?? 30) : 30;
  const file = path.join(LOG_DIR, args[0] === 'denied' ? 'denied.log' : 'audit.log');
  if (!fs.existsSync(file)) {
    process.stdout.write(c.dim(`还没有日志：${file}\n`));
    return 0;
  }
  const lines = fs.readFileSync(file, 'utf8').trimEnd().split('\n');
  for (const line of lines.slice(-tail)) {
    try {
      const r = JSON.parse(line);
      const mark = r.decision === 'allow' ? c.green('✓') : c.red('✗');
      process.stdout.write(
        `${mark} ${c.dim(r.ts?.slice(11, 19) ?? '')} ${pad(r.plugin ?? '', 16)} ${pad(r.action ?? '', 16)} `
        + `${c.dim(r.caller ?? '')} ${r.error ? c.red(r.error) : ''}\n`,
      );
      if (r.command) process.stdout.write(c.dim(`    ${r.command}\n`));
    } catch {
      process.stdout.write(line + '\n');
    }
  }
  return 0;
}

async function main(): Promise<number> {
  const [, , cmd, ...rest] = process.argv;
  switch (cmd) {
    case undefined:
    case 'help':
    case '-h':
    case '--help':
      process.stdout.write(HELP);
      return 0;
    case 'list':
    case 'ls':
      return cmdList();
    case 'show':
      return cmdShow(rest);
    case 'run':
      return cmdRun(rest);
    case 'plugin':
      return cmdPlugin(rest);
    case 'doctor':
      return cmdDoctor();
    case 'path':
      return cmdPath();
    case 'logs':
      return cmdLogs(rest);
    case 'mcp': {
      const mcp = await import('./mcp.ts');
      return mcp.cli(rest);
    }
    default:
      process.stderr.write(c.red(`未知命令：${cmd}`) + '\n');
      process.stdout.write(HELP);
      return 2;
  }
}

main().then((code) => process.exit(code)).catch((err) => {
  process.stderr.write(c.red(`✗ ${err?.stack ?? err}`) + '\n');
  process.exit(1);
});
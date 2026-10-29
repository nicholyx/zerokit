#!/usr/bin/env node
import fs from 'node:fs';
import { suggestLine, suggestLineMulti, diagnose, diagnoseExitCode, timeoutDiagnosis, missingSettingHint, foreignPath, findOrphanPlugins } from './core/suggest.ts';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { type Plugin, type RiskLevel, toolName } from './core/manifest.ts';
import { HOME, LOG_DIR, PLUGINS_DIR } from './core/paths.ts';
import { actionStats, gcAudit, readAudit, readAuditDetailed, recentErrors, SLOW_MS } from './core/ops.ts';
import { packPluginWithManifest as packPlugin, publishReady, unpackPlugin, verifyInstalled } from './core/distro.ts';
import * as distroNs from './core/distro.ts';
import { lintPlugin, docPlugin, docPluginJson } from './core/lintdoc.ts';
import * as auditNs from './core/audit.ts';
import { needsConfirm, rememberApproval } from './core/approvals.ts';
import type { ConfirmPolicy } from './core/runner.ts';
import {
  addFromDir, addFromGit, devLink, exportPlugin, findPlugin, importPlugin, installBundled,
  installBundledPlugin, listPlugins, loadDir, removePlugin, requirePlugin,
} from './core/registry.ts';
import { type ScaffoldExample, type ScaffoldRuntime, scaffoldPlugin } from './core/scaffold.ts';
import { applyUpdate, checkUpdate, listUpdateStates } from './core/update.ts';
import { checkRequires } from './core/resolve.ts';
import { buildDoctorReport, toHistoryEntry, appendDoctorHistory, readDoctorHistory, diffDoctorHistory, persistCount, doctorSummaryLine } from './core/doctor.ts';
import { killAllProcesses, killProcess, listProcesses } from './core/runtime.ts';
import { readSource } from './core/sources.ts';
import { makeSnapshot, parseSnapshot, restoreSnapshot, diffSnapshot } from './core/migrate.ts';
import { listServices, stopService } from './core/services.ts';
import {
  addMarket, buildIndex, installFromMarket, loadMarkets, previewInstall,
  readIndex, refreshMarket, removeMarket, searchMarkets,
} from './core/market.ts';
import { applyDefaults, parseArgv, toCliFlags, toJsonSchema } from './core/schema.ts';
import { depHealth, depStates, depTree, dependents, findCycle, installDeps, missingDeps, topoOrder } from './core/deps.ts';
import { loadTimers, nextFireTime, removeTimer, setTimerPaused, upsertTimer, humanNextFire, missedRun, markCatchupDone, saveTimers, firesOnDay } from './core/timers.ts';
import {
  SECRET_MASK, publicSettings, resolveSettings, settingsHints, writeSettings,
} from './core/pluginConfig.ts';
import { type RunResult, audit, chainDisplay, confirmPolicy, runAction } from './core/runner.ts';

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
  list, ls                列出已安装插件与动作（--json --brief 精简机读输出）
                          list --health 一屏健康状态（--json 机读；非零退出码=有异常）
  show <插件> [动作]      查看详情（含生成的 MCP 工具名与 JSON Schema）
  run <插件> <动作> [..]  执行一个动作
  doctor                  自检：环境、依赖、插件清单是否有问题（--json 机读输出）
  ps                      看正在运行的东西（托管的进程 + 插件声明的服务）
  kill <进程id|插件.服务> 结束一个；kill all 全部结束

${c.bold('配置')}
  config <插件>               列出设置项（值、来源、是否缺失）
  config <插件> set <项> [值] 写入一项；密钥项用 --stdin 从标准输入读
  config <插件> get <项>      打印一项的值（密钥项加 --reveal 才回显）
  config <插件> unset <项>    清除一项，回到默认值/未设置
                              --json 以 JSON 输出 list / get 的结果

${c.bold('插件')}
  plugin new <id> [--runtime node|python] [--web] [--dir <目录>] [--name <名字>]
                              生成插件骨架（带教学注释，生成即校验）
  plugin dev <目录>           开发模式：以链接安装本地目录，改文件即生效
  plugin validate <目录>      校验任意目录的清单并摊开能力
  plugin install <插件id>     从集市安装（会先摊开它的全部能力让你确认；--with-deps 一并补依赖）
  plugin add <目录|git地址>   从本地目录或 git 仓库安装（--with-deps 一并补依赖）
  plugin deps [插件]          依赖树与安装状态；不带插件则只列缺依赖的
  plugin update [插件]        列出可更新的；带插件 id 则检查并更新（来源处拉新版）
  plugin remove <插件>        卸载
  plugin bundled              安装仓库自带的示例插件
  plugin export <插件>        打包成单个 .toolpack 文件
  plugin import <文件>        从 .toolpack 安装

${c.bold('集市')}
  market add <地址|目录>      添加集市（集市 = 一个 git 仓库 + 根目录 market.json）
  market list                 已添加的集市
  market search [关键词]      在集市里找插件
  market refresh [集市名]     拉取最新索引
  market index [目录]         把一个插件目录生成为集市索引

${c.bold('界面')}
  ui [--port N] [--open]  启动本地启动器界面（浏览器打开，也是 Tauri 壳用的同一套）
  web <插件id> [--port N] 起界面并直达插件自带的富交互页面（render = "web" 的动作）

${c.bold('AI 对接')}
  mcp serve               以 MCP server 方式运行（stdio），给 AI 客户端调用
  mcp config [客户端]     打印/写入各家 AI 客户端的接入配置
  mcp allow [动作]        授权有副作用的动作给 AI 调用

${c.bold('其他')}
  logs [--tail N]         看审计日志
  path                    打印数据目录
  last [--show]           重跑最近一条成功命令（--show 只看不跑）
  history [N]             最近 N 条命令；--rerun N 重跑第 N 条
  completion bash|zsh|fish  shell 补全脚本（eval "$(zkit completion bash)"）
  man                     完整命令参考（比本屏详细）
  --version / -V          版本号

run 进阶
  --out table|json|yaml|csv   输出格式（table 人看，其余给管道）
  --copy                      成功后把结果 JSON 复制到剪贴板
  --quiet                     只输出结果 JSON 单行（脚本管道用）
  --watch N                   每 N 秒轮询重跑，只打印变化（Ctrl-C 退出）

${c.bold('示例')}
  zkit run proxy status
  zkit run proxy allow-domain --domain example.com
  zkit plugin add RedMi/proxy

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

/** 第六十八轮②：轻量点路径查询——.a.b[0].c。不引完整 jq（依赖与语义都过重），
 * 只支持最常用的字段链 + 数组下标 + 末尾切片 [.a[].b 不支持，够用就好）。 */
function jqPath(root: unknown, expr: string): { hit: boolean; value?: unknown; why?: string } {
  if (!expr.startsWith('.')) return { hit: false, why: '表达式要以 . 开头（如 .data.ip）' };
  let cur: unknown = root;
  const tokens = expr.slice(1).split(/[.[]|(?<=\d)\]/).filter(Boolean);
  for (const raw of tokens) {
    const idx = /^\d+$/.test(raw) ? Number(raw) : undefined;
    if (idx !== undefined) {
      if (!Array.isArray(cur) || cur.length <= idx) return { hit: false, why: `下标 [${idx}] 越界或不是数组` };
      cur = cur[idx];
    } else {
      if (cur === null || typeof cur !== 'object') return { hit: false, why: `${raw} 之前已经不是对象` };
      cur = (cur as Record<string, unknown>)[raw];
      if (cur === undefined) return { hit: false, why: `没有字段 ${raw}` };
    }
  }
  return { hit: true, value: cur };
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

/** 按风险等级决定是否要向用户确认。非交互环境下拒绝执行而不是默认放行。 */
async function confirmRun(plugin: Plugin, actionId: string, policy: string, command: string): Promise<boolean> {
  if (policy === 'never') return true;
  if (!needsConfirm(actionRisk(plugin, actionId), policy as ConfirmPolicy, plugin.id, actionId)) {
    return true;
  }

  if (!process.stdin.isTTY) {
    process.stderr.write(
      c.red('✗ 这个动作有副作用，但当前不是交互环境，无法确认。') + '\n'
      + c.dim(`  命令：${command}\n  如确认要执行，请在命令后加 --yes\n`),
    );
    return false;
  }
  process.stderr.write(`\n${c.yellow('即将执行：')} ${c.bold(command)}\n`);
  process.stderr.write(c.dim(`插件 ${plugin.name} / 动作 ${actionId} / 风险 ${RISK_LABEL[actionRisk(plugin, actionId)]}\n`));
  // 第四十一轮⑤：高危动作距上次执行太久时先给个清醒提示（久未用的危险操作更容易手滑）
  if (actionRisk(plugin, actionId) !== 'read') {
    const last = auditNs.lastRunOf(readAudit().map((r) => ({ ts: r.ts ?? '', key: `${r.plugin}.${r.action}` })), `${plugin.id}.${actionId}`);
    if (auditNs.isLongGap(last)) {
      process.stderr.write(c.yellow(`⚠ 距上次执行已超过 7 天（${last?.slice(0, 19) ?? ''}）——确认参数没变再继续\n`));
    }
  }
  if (policy === 'first-time') {
    process.stderr.write(c.dim('确认后会被记住；高风险动作每次都会问。\n'));
  }
  // 第六十七轮②：destructive 双重确认——只按 y 太容易带过去，要求输入动作 id 本身。
  if (actionRisk(plugin, actionId) === 'destructive') {
    process.stderr.write(c.red(`\n这是 destructive 动作。请输入动作 id「${actionId}」确认执行：`));
    const typed = (await readLine()).trim();
    if (typed !== actionId) {
      process.stderr.write(c.dim(`输入的是「${typed}」，与动作 id 不一致。已取消。\n`));
      return false;
    }
  } else {
    process.stderr.write('继续？(y/N) ');
    const answer = await readLine();
    if (!/^y(es)?$/i.test(answer.trim())) {
      process.stderr.write('已取消。\n');
      return false;
    }
  }
  if (policy === 'first-time') rememberApproval(plugin.id, actionId);
  return true;
}

function actionRisk(plugin: Plugin, actionId: string): RiskLevel {
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
  // 第四十五轮⑨：plugin list --health 列健康状态列（--json 时机器可读）
  if (process.argv.includes('--health')) {
    const rows = entries.map((e) => e.plugin
      ? { id: e.plugin.id, health: missingDeps(e.plugin).length === 0 && resolveSettings(e.plugin).missing.length === 0 ? 'ok'
          : [missingDeps(e.plugin).length ? `缺依赖 ${missingDeps(e.plugin).join('+')}` : '', resolveSettings(e.plugin).missing.length ? `缺设置 ${resolveSettings(e.plugin).missing.length}` : ''].filter(Boolean).join('，'), actions: e.plugin.actions.length }
      : { id: path.basename(e.dir), health: '清单损坏', errors: e.errors.slice(0, 2) });
    if (process.argv.includes('--json')) {
      process.stdout.write(JSON.stringify(rows, null, 2) + '\n');
    } else {
      process.stdout.write(c.bold('插件健康：\n'));
      for (const r of rows) {
        const tag = r.health === 'ok' ? c.green('✓ ok') : c.yellow(r.health);
        process.stdout.write(`  ${pad(r.id, 16)} ${tag}\n`);
      }
    }
    return rows.some((r) => r.health !== 'ok') ? 1 : 0;
  }
  // 第二十九轮④：--brief 给脚本消费的精简 JSON——id/name/version/健康四字段，
  // 不带颜色码、不带动作明细；缺参照常全量人类可读输出
  const briefIdx = process.argv.indexOf('--brief');
  const jsonIdx = process.argv.indexOf('--json');
  if (briefIdx >= 0 || (jsonIdx >= 0 && briefIdx >= 0)) {
    const out = entries.map((e) => e.plugin
      ? (() => {
          const missSet = resolveSettings(e.plugin).missing.length;
          const missDep = missingDeps(e.plugin).length;
          // 第六十八轮③：brief 补动作摘要（脚本不用二次查询）
          const risks = e.plugin.actions.reduce((m, a) => { m[a.risk] = (m[a.risk] ?? 0) + 1; return m; }, {} as Record<string, number>);
          // 第八十一轮⑥：安装来源进机读输出（bundled/git/market/dev/dir + 时间）——
          // 审计「这个插件哪来的」不用翻数据目录
          const src = readSource(e.plugin.dir);
          const installedFrom = src ? `${src.type}${src.url ? ` ${src.url}` : ''}${src.installedAt ? ` @${src.installedAt.slice(0, 10)}` : ''}` : 'unknown';
          return { id: e.plugin.id, name: e.plugin.name, version: e.plugin.version,
            actions: e.plugin.actions.length, riskMix: risks,
            installedFrom,
            health: missDep === 0 && missSet === 0 ? 'ok'
              : [missDep ? `缺依赖 ${missDep}` : '', missSet ? `缺设置 ${missSet}` : ''].filter(Boolean).join('，') || 'ok' };
        })()
      : { id: path.basename(e.dir), name: '', version: '', health: '清单损坏', errors: e.errors });
    process.stdout.write(JSON.stringify(out, null, 2) + '\n');
    return 0;
  }
  const ok = entries.filter((e) => e.plugin);
  if (entries.length === 0) {
    process.stdout.write('还没有装任何插件。\n');
    process.stdout.write(c.dim('  zkit plugin bundled     安装仓库自带的示例插件\n'));
    process.stdout.write(c.dim('  zkit plugin add <目录>  从本地目录安装\n'));
    return 0;
  }
  for (const entry of ok) {
    const p = entry.plugin!;
    const missing = resolveSettings(p).missing.length;
    const settingsTag = missing > 0 ? `  ${c.yellow(`缺 ${missing} 项设置`)}` : '';
    const depTag = missingDeps(p).length > 0 ? `  ${c.red(`缺插件依赖 ${missingDeps(p).join(', ')}`)}` : '';
    process.stdout.write(`${c.bold(p.name)} ${c.dim(p.id)} ${c.dim('v' + p.version)}${settingsTag}${depTag}\n`);
    if (p.summary) process.stdout.write(`  ${p.summary}\n`);
    for (const a of p.actions) {
      const tag = a.type === 'chain' ? c.dim('  · 组合') : '';
      process.stdout.write(`  ${c.cyan(a.id.padEnd(18))} ${pad(a.title, 22)} ${RISK_LABEL[a.risk] ?? a.risk}${tag}\n`);
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
  const deps = depStates(plugin);
  if (reqs.length > 0 || deps.length > 0) {
    process.stdout.write('\n依赖：\n');
    for (const r of reqs) {
      process.stdout.write(r.ok
        ? `  ${c.green('✓')} ${r.name} ${c.dim(r.found!.version)}\n`
        : `  ${c.red('✗')} ${r.name} ${r.spec}  ${c.yellow(r.hint ?? '')}\n`);
    }
    for (const d of deps) {
      process.stdout.write(d.installed
        ? `  ${c.green('✓')} 插件 ${d.id} ${c.dim('v' + (d.version ?? '?'))}\n`
        : `  ${c.red('✗')} 插件 ${d.id}  ${c.yellow('未安装')}  ${c.dim(`zkit plugin install ${d.id}`)}\n`);
    }
  }

  if (plugin.settings.length > 0) {
    const view = resolveSettings(plugin);
    process.stdout.write('\n设置项：\n');
    for (const st of view.states) {
      const st_ = st.setting;
      const title = st_.title && st_.title !== st_.name ? `  ${st_.title}` : '';
      const flags = [
        st_.required ? c.yellow('必填') : '',
        st_.secret ? c.red('密钥') : '',
      ].filter(Boolean).join(' ');
      let shown: string;
      if (st.error) shown = c.red(`值不合法：${st.error}`);
      else if (st.source === 'unset') shown = c.yellow(st_.required ? '未设置（必填）' : '未设置');
      else if (st_.secret) shown = c.dim(SECRET_MASK);
      else shown = JSON.stringify(st.value);
      const source = st.source === 'default' ? c.dim(' 默认值') : '';
      process.stdout.write(`  ${pad(st_.name, 18)} ${pad(st_.type, 8)} ${shown}${source}`
        + `  ${c.dim(flags)}${title}\n`);
      if (st_.description) process.stdout.write(`    ${c.dim(st_.description)}\n`);
    }
    const hints = settingsHints(plugin, view);
    if (hints.length > 0) {
      process.stdout.write(c.dim(`  先设置：\n  ${hints.join('\n  ')}\n`));
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
    const command = a.type === 'http'
      ? `${a.method} ${a.url}`
      : a.type === 'chain' ? chainDisplay(a) : a.run.join(' ');
    process.stdout.write(c.dim(`  命令        ${command}\n`));
    if (a.type === 'chain') {
      // 链路要在安装后、执行前就能被看懂：哪一步调谁、结果记在哪个名字下、传了什么
      for (const [i, step] of a.steps.entries()) {
        const extra = Object.keys(step.params).length > 0 ? `  参数 ${JSON.stringify(step.params)}` : '';
        process.stdout.write(c.dim(`  步骤 ${i + 1}      ${step.use} → {${step.as}}${extra}\n`));
      }
    }
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

/** 从标准输入读一个值（密钥用：不进 shell 历史，也不出现在进程列表里） */
function readStdinValue(): Promise<string> {
  return new Promise((resolve, reject) => {
    let data = '';
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', (chunk) => { data += chunk; });
    process.stdin.on('end', () => resolve(data.replace(/\r?\n$/, '')));
    process.stdin.on('error', reject);
  });
}

/** 第六十八轮④：zkit config 无参数——全部插件的设置状态总览（配了什么/缺什么一眼看全）。 */
function cmdConfigOverview(): number {
  const entries = listPlugins().filter((e) => e.plugin);
  const withSettings = entries.filter((e) => e.plugin!.settings.length > 0);
  // 第七十一轮⑥：config --json（无插件参数）机读输出全部设置项（secret 恒掩码）
  if (process.argv.includes('--json')) {
    const plugins = withSettings.map((e) => {
      const p = e.plugin!;
      const view = resolveSettings(p);
      return {
        plugin: p.id,
        items: p.settings.map((st) => {
          const state = view.states.find((x) => x.setting.name === st.name);
          return {
            name: st.name,
            secret: st.secret === true,
            required: st.required === true,
            source: state?.source ?? 'unset',
            value: st.secret ? (state && state.source !== 'unset' ? '******' : null)
              : state && state.source !== 'unset' ? state.value : null,
          };
        }),
      };
    });
    process.stdout.write(JSON.stringify({ plugins }, null, 2) + '\n');
    return 0;
  }
  if (withSettings.length === 0) {
    process.stdout.write('所有插件都没有设置项。\n');
    return 0;
  }
  process.stdout.write(c.bold('设置状态总览（zkit config <插件> 看单个插件明细）：\n'));
  for (const e of withSettings) {
    const p = e.plugin!;
    const view = resolveSettings(p);
    const set = view.values ? Object.keys(view.values).filter((k) => view.values?.[k] !== undefined).length : 0;
    const total = p.settings.length;
    const missing = view.missing.length;
    const tag = missing > 0 ? c.yellow(`缺 ${missing} 项必填`)
      : view.invalid.length > 0 ? c.red(`${view.invalid.length} 项不合法`)
      : c.green('✓ 配齐');
    process.stdout.write(`  ${pad(p.id, 14)} ${set}/${total} 已设置  ${tag}\n`);
  }
  const noSettings = entries.length - withSettings.length;
  if (noSettings > 0) process.stdout.write(c.dim(`  （另有 ${noSettings} 个插件无设置项）\n`));
  return 0;
}

function cmdConfigUsage(): number {
  process.stderr.write('用法：zkit config <插件> [list | get <项> | set <项> [值] | unset <项>]'
    + ' [--json] [--stdin] [--reveal]\n');
  return 2;
}

async function cmdConfig(args: string[]): Promise<number> {
  const json = args.includes('--json');
  const reveal = args.includes('--reveal');
  const fromStdin = args.includes('--stdin');
  const clean = args.filter((a) => a !== '--json' && a !== '--reveal' && a !== '--stdin');
  const [pluginId, sub = 'list', name, ...rest] = clean;
  if (!pluginId) return cmdConfigOverview();

  let plugin: Plugin;
  try {
    plugin = requirePlugin(pluginId);
  } catch (e) {
    process.stderr.write(c.red(`✗ ${(e as Error).message}`) + '\n');
    return 1;
  }
  if (plugin.settings.length === 0) {
    process.stdout.write(`插件 ${plugin.id} 没有声明设置项（清单里加 [[setting]]）。\n`);
    return 0;
  }

  const viewOf = () => resolveSettings(plugin);
  const listView = () => publicSettings(plugin);

  if (sub === 'list' || sub === 'ls') {
    const list = listView();
    if (json) {
      process.stdout.write(JSON.stringify({ plugin: plugin.id, settings: list }, null, 2) + '\n');
      return 0;
    }
    process.stdout.write(`${c.bold(plugin.name)} ${c.dim(plugin.id)} 的设置项\n`);
    for (const s of list) {
      const flags = [s.required ? c.yellow('必填') : '', s.secret ? c.red('密钥') : '']
        .filter(Boolean).join(' ');
      let shown: string;
      if (s.error) shown = c.red(`值不合法：${s.error}`);
      else if (s.missing) shown = c.yellow('未设置（必填）');
      else if (s.source === 'unset') shown = c.dim('未设置');
      else if (s.secret) shown = c.dim(s.masked ?? SECRET_MASK);
      else shown = JSON.stringify(s.value);
      const source = s.source === 'default' ? c.dim(' 默认值') : '';
      process.stdout.write(`  ${pad(s.name, 18)} ${pad(s.type, 8)} ${shown}${source}`
        + `  ${c.dim(flags)}\n`);
      if (s.description) process.stdout.write(`    ${c.dim(s.description)}\n`);
    }
    const view = viewOf();
    const hints = settingsHints(plugin, view);
    if (hints.length > 0) process.stdout.write(c.dim(`  先设置：\n  ${hints.join('\n  ')}\n`));
    return 0;
  }

  if (sub !== 'get' && sub !== 'set' && sub !== 'unset') return cmdConfigUsage();
  if (!name) return cmdConfigUsage();
  const declared = plugin.settings.find((s) => s.name === name);
  if (!declared) {
    process.stderr.write(c.red(`✗ 插件 ${plugin.id} 没有设置项 "${name}"`)
      + c.dim(`。可用的是：${plugin.settings.map((s) => s.name).join(' / ')}\n`));
    return 1;
  }

  if (sub === 'get') {
    const view = viewOf();
    const state = view.states.find((st) => st.setting.name === name)!;
    if (state.error) {
      process.stderr.write(c.red(`✗ ${state.error}`) + '\n');
      return 1;
    }
    if (state.source === 'unset') {
      process.stderr.write(c.red(`✗ ${name} 还没设置\n`));
      return 1;
    }
    const value = declared.secret && !reveal ? SECRET_MASK : state.value;
    if (json) {
      process.stdout.write(JSON.stringify({
        plugin: plugin.id, name, type: declared.type, secret: declared.secret === true,
        value: declared.secret && !reveal ? null : state.value, source: state.source,
      }, null, 2) + '\n');
    } else {
      process.stdout.write(`${typeof value === 'string' ? value : JSON.stringify(value)}\n`);
    }
    return 0;
  }

  if (sub === 'unset') {
    const r = writeSettings(plugin, { [name]: null });
    if (!r.ok) {
      process.stderr.write(c.red(`✗ ${r.error}`) + '\n');
      return 1;
    }
    const back = declared.default !== undefined
      ? `已回到默认值 ${JSON.stringify(declared.default)}`
      : '已清除（这项现在是未设置）';
    process.stdout.write(`${c.green('✓')} ${name}：${back}\n`);
    return 0;
  }

  // set
  let value: string | undefined = rest[0];
  if (fromStdin) {
    if (process.stdin.isTTY) {
      process.stderr.write(c.red('✗ --stdin 需要从管道读入') + '\n'
        + c.dim(`  例如：printf '%s' "$TOKEN" | zkit config ${plugin.id} set ${name} --stdin\n`));
      return 2;
    }
    value = await readStdinValue();
    if (value === '') {
      process.stderr.write(c.red('✗ --stdin 读到空值，已拒绝') + c.dim('（要清除请用 unset）\n'));
      return 1;
    }
    process.stderr.write(c.dim('· 已从标准输入读取，不会留在 shell 历史里\n'));
  }
  if (value === undefined) {
    process.stderr.write(c.red(`✗ 缺少要写入的值`) + '\n'
      + c.dim(`  zkit config ${plugin.id} set ${name} <值>`)
      + (declared.secret ? c.dim(`\n  密钥建议：… | zkit config ${plugin.id} set ${name} --stdin`) : '')
      + '\n');
    return 2;
  }
  if (declared.secret && !fromStdin) {
    process.stderr.write(c.yellow('! 密钥是命令行参数，会留在 shell 历史里——下次改用 --stdin\n'));
  }
  const r = writeSettings(plugin, { [name]: value });
  if (!r.ok) {
    process.stderr.write(c.red(`✗ ${r.error}`) + '\n');
    return 1;
  }
  const shown = declared.secret ? SECRET_MASK : JSON.stringify(value);
  process.stdout.write(`${c.green('✓')} 已保存 ${name} = ${shown}\n`);
  const view = r.view!;
  const hints = settingsHints(plugin, view);
  if (hints.length > 0) {
    process.stderr.write(c.yellow(`还差 ${view.missing.length} 项必填设置：\n`));
    for (const h of hints) process.stderr.write(c.dim(`  ${h}\n`));
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
    return 2;  // 第四十六轮⑥：用法错误（插件/动作不存在）=2，执行失败才是 1
  }
  const action = plugin.actions.find((a) => a.id === actionId);
  if (!action) {
    // 第三十五轮②：动作打错也给模糊建议
    process.stderr.write(c.red(`✗ 插件 ${pluginId} 里没有动作 "${actionId}"\n`));
    const hint = suggestLine(actionId, plugin.actions.map((a) => a.id));
    if (hint) process.stderr.write(c.yellow(`  ${hint}\n`));
    process.stderr.write(c.dim(`  可用：${plugin.actions.map((a) => a.id).join(' / ')}\n`));
    return 2;  // 用法错误
  }

  const yes = rest.includes('--yes') || rest.includes('-y');
  const asJson = rest.includes('--json');
  // 第四十五轮：新控制旗标——out/copy/quiet/watch
  const outIdx = rest.indexOf('--out');
  // 第七十四轮④⑤：--format <yaml|csv|table|md|tsv>（与 --out <file> 区分：--out 后跟的是文件名时当文件写）
  const fmtIdx = rest.indexOf('--format');
  const fmtNext = fmtIdx >= 0 ? rest[fmtIdx + 1] : undefined;
  const fmtVal = fmtIdx >= 0 && fmtNext && ['yaml', 'csv', 'table', 'md', 'tsv'].includes(fmtNext) ? fmtNext : undefined;
  const outFmt = fmtVal ?? (outIdx >= 0 && rest[outIdx + 1] && ['yaml', 'csv', 'table'].includes(rest[outIdx + 1]!) ? rest[outIdx + 1] : undefined);
  const doCopy = rest.includes('--copy');
  // 第六十八轮②：--jq <路径> 轻量查询（.data.ip / .data.items[0].name 这类点路径）
  const jqIdx = rest.indexOf('--jq');
  const jqNext = jqIdx >= 0 ? rest[jqIdx + 1] : undefined;
  const jqExpr = jqIdx >= 0 && jqNext && !jqNext.startsWith('--') ? jqNext : undefined;
  // 第六十八轮①：--out <file> 结果落文件（文本写原文、JSON 写格式化）。
  // outFile 判定与 outFmt 无关：--out 后跟的值只要不是已知格式名（那是 --out csv 的简写）就是文件名。
  const outNext = outIdx >= 0 ? rest[outIdx + 1] : undefined;
  const outFile = outIdx >= 0 && outNext && !outNext.startsWith('--') && !['yaml', 'csv', 'table', 'md', 'tsv'].includes(outNext)
    ? outNext : (fmtIdx >= 0 ? undefined : undefined);
  // 第六十五轮⑤：--share <file.md|file.html> 执行完直接落分享文件
  const shareIdx = rest.indexOf('--share');
  const shareNext = shareIdx >= 0 ? rest[shareIdx + 1] : undefined;
  const shareFile = shareNext && !shareNext.startsWith('--') ? shareNext : undefined;
  const quiet = rest.includes('--quiet');
  const watchIdx = rest.indexOf('--watch');
  const watchSec = watchIdx >= 0 && rest[watchIdx + 1] ? rest[watchIdx + 1] : undefined;
  // 第七十一轮②：--env KEY=VAL 临时环境变量（可多次；只在本次进程注入，不落盘）
  const envOverrides: Record<string, string> = {};
  for (let i = 0; i < rest.length; i++) {
    if (rest[i] === '--env' && rest[i + 1]) {
      const kv = rest[i + 1]!;
      const eq = kv.indexOf('=');
      if (eq > 0) envOverrides[kv.slice(0, eq)] = kv.slice(eq + 1);
      i++; continue;
    }
    if (rest[i]!.startsWith('--env=')) {
      const kv = rest[i]!.slice(6);
      const eq = kv.indexOf('=');
      if (eq > 0) envOverrides[kv.slice(0, eq)] = kv.slice(eq + 1);
    }
  }
  // 剥控制旗标（含其后随值），只留动作参数
  const argv: string[] = [];
  for (let i = 0; i < rest.length; i++) {
    const a = rest[i]!;
    if (a === '--out' || a === '--watch' || a === '--share' || a === '--jq' || a === '--env' || a === '--format'
        || a === '--sort' || a === '--pick' || a === '--uniq' || a === '--sum' || a === '--head') { i++; continue; }
    if (a.startsWith('--out=') || a.startsWith('--watch=') || a.startsWith('--share=') || a.startsWith('--jq=') || a.startsWith('--env=') || a.startsWith('--format=')
        || a.startsWith('--sort=') || a.startsWith('--pick=') || a.startsWith('--uniq=') || a.startsWith('--sum=') || a.startsWith('--head=')) continue;
    if (['--yes', '-y', '--json', '--copy', '--quiet', '--full'].includes(a)) continue;
    // 第七十五轮：--sort -列 的降序值（-内存 不是短旗标，前一个是 --sort 就吞掉）
    if (a.startsWith('-') && !a.startsWith('--') && i > 0 && rest[i - 1] === '--sort') continue;
    argv.push(a);
  }
  const parsed = parseArgv(action, argv);
  if (parsed.help) {
    process.stdout.write(`zkit run ${pluginId} ${actionId}\n  ${action.description}\n\n`);
    for (const f of toCliFlags(action)) {
      process.stdout.write(`  --${f.name}${f.takesValue ? ' <值>' : ''}  ${f.description}\n`);
    }
    return 0;
  }
  const paramTable = (): void => {
    // 第三十五轮③：缺参数不只是报错——把这张动作的参数表和完整示例摊给人看
    process.stderr.write(c.bold(`\n${pluginId} ${actionId} 的参数：\n`));
    for (const f of toCliFlags(action)) {
      const req = f.required ? c.yellow('（必填）') : c.dim('（可选）');
      process.stderr.write(`  --${f.name}${f.takesValue ? ' <值>' : ''}  ${f.description}${req}\n`);
    }
    process.stderr.write(c.dim(`  完整帮助：zkit run ${pluginId} ${actionId} --help\n`));
  };
  if (parsed.errors.length > 0) {
    for (const e of parsed.errors) process.stderr.write(c.red(`✗ ${e}`) + '\n');
    paramTable();
    return 2;
  }
  const withDefaults = applyDefaults(action, parsed.values);
  if (withDefaults.errors.length > 0) {
    for (const e of withDefaults.errors) process.stderr.write(c.red(`✗ ${e}`) + '\n');
    paramTable();
    return 2;
  }

  // 第三十五轮⑨：参数里混入异平台路径（mac 上给 C:\...）提前点破——
  // 这类错误跑起来才炸，报错还指向插件本身，排障方向全错
  const fp = foreignPath(Object.values(withDefaults.values).map(String));
  if (fp) {
    process.stderr.write(c.yellow(`! 参数里像是混入了另一个平台的路径：${fp}\n`) +
      c.dim(`  当前平台 ${process.platform}；跨平台脚本建议用 / 或让插件自己拼 path.join\n`));
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
    // 组合动作没有自己的 argv，把链路摊开给人看；http 动作直接显示请求行
    const command = action.type === 'chain'
      ? chainDisplay(action)
      : action.type === 'http'
        ? `${action.method} ${action.url}`
        : displayCommand(buildArgv(plugin, action, withDefaults.values).redacted);
    if (!(await confirmRun(plugin, action.id, policy, command))) {
      audit({
        ts: new Date().toISOString(), plugin: plugin.id, action: action.id,
        tool: toolName(plugin.id, action.id), risk: action.risk, caller: 'cli',
        decision: 'deny', reason: 'declined-by-user',
      });
      return 1;
    }
  }

  // 注入 --env 覆盖（子进程继承 process.env，这里临时改、跑完还原）
  const savedEnv: [string, string | undefined][] = [];
  for (const [k, v] of Object.entries(envOverrides)) {
    savedEnv.push([k, process.env[k]]);
    process.env[k] = v;
  }
  const result = await runAction(plugin, action, { caller: 'cli', values: withDefaults.values });
  for (const [k, v] of savedEnv) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
  // 第四十五轮⑤：成功执行进历史（重放要干净的参数面）
  if (result.ok) {
    const cliX = await import('./core/cliX.ts');
    cliX.appendHistory({
      ts: new Date().toISOString(), plugin: plugin.id, action: action.id,
      argv: cliX.stripControlFlags(argv), exitCode: result.ok ? 0 : 1,
    });
  }
  // 第六十八轮②：--jq 点路径查询（在 --out/--copy 之前改写 result.data）
  if (jqExpr && result.ok) {
    const picked = jqPath(result.data ?? JSON.parse(result.stdout || 'null'), jqExpr);
    if (picked.hit) result.data = picked.value;
    else {
      process.stderr.write(c.red(`✗ --jq ${jqExpr} 没取到值（${picked.why}）\n`));
      return 1;
    }
  }
  // 第六十八轮①：--out 文件——文本写原文、JSON 写两空格格式化
  // 第四十五轮③④⑦：输出格式 / 复制 / 安静模式
  const cliX = await import('./core/cliX.ts');
  // 第七十五轮：结果再加工——pick/sort/uniq/head/sum（只影响显示输出，--json/--quiet/--out 拿原始数据）
  const flagVal = (name: string): string | undefined => {
    const i = rest.indexOf(name);
    return i >= 0 ? rest[i + 1] : undefined;
  };
  const tf: import('./core/cliX.ts').TransformOpts = {};
  const tfSort = flagVal('--sort');
  const tfPick = flagVal('--pick');
  const tfUniq = flagVal('--uniq');
  const tfSum = flagVal('--sum');
  const tfHead = flagVal('--head');
  if (tfSort) tf.sort = tfSort;
  if (tfPick) tf.pick = tfPick.split(',').map((s) => s.trim()).filter(Boolean);
  if (tfUniq) tf.uniq = tfUniq;
  if (tfSum) tf.sum = tfSum;
  if (tfHead && /^\d+$/.test(tfHead)) tf.head = Number(tfHead);
  const hasTf = !!(tf.sort || tf.pick || tf.uniq || tf.sum || tf.head !== undefined);
  // 加工标志位：四个表格类格式 + 默认 JSON 展示路径都走加工后数据；--json/--quiet 不走
  let tfRows: import('./core/cliX.ts').Row[] = [];
  let tfError: string | undefined;
  if (hasTf && result.ok) {
    const t = cliX.transformRows(cliX.toRows(result.data), tf);
    tfRows = t.rows; tfError = t.error;
    if (tfError) {
      process.stderr.write(c.red(`✗ ${tfError}\n`));
      return 1;
    }
  }
  // 第七十四轮④⑤：--format md / tsv；②：--full 展开大结果（默认 30 行截断）
  const wantFull = rest.includes('--full');
  const dispRows = hasTf ? tfRows : undefined;
  if (outFmt === 'yaml') {
    process.stdout.write(cliX.renderYaml(result.data));
  } else if (outFmt === 'csv') {
    process.stdout.write(cliX.renderCsv(dispRows ?? cliX.toRows(result.data)));
  } else if (outFmt === 'md') {
    process.stdout.write(cliX.renderMdTable(dispRows ?? cliX.toRows(result.data)));
  } else if (outFmt === 'tsv') {
    process.stdout.write(cliX.renderTsv(dispRows ?? cliX.toRows(result.data)));
  } else if (outFmt === 'table') {
    process.stdout.write(cliX.renderTable(dispRows ?? cliX.toRows(result.data)));
  } else if (hasTf && !quiet && !asJson) {
    // 第七十五轮：加工后没有指定格式时默认表格展示（比裸 JSON 可读）；--json/--quiet 走原始数据
    process.stdout.write(cliX.renderTable(tfRows));
  } else if (!wantFull && !quiet && !asJson && result.data !== undefined
             && result.data && typeof result.data === 'object') {
    // 第七十四轮②：大 JSON 默认截断摘要（--full 展开；--quiet/--json 不受影响——它们面向管道）
    const t = cliX.truncateJsonLines(result.data, 30);
    if (t.truncated) {
      process.stdout.write(t.text + '\n');
      process.stderr.write(c.yellow(`… 结果共 ${t.totalLines} 行，已截到 30 行——加 --full 展开\n`));
    } else {
      process.stdout.write(t.text + '\n');
    }
  } else {
    if (quiet) {
      // 第四十五轮⑦：--quiet 只出结果 JSON 单行，头部装饰全免
      process.stdout.write(JSON.stringify({ ok: result.ok, data: result.data, error: result.error }) + '\n');
    } else {
      printRunResult(action, result, asJson);
    }
  }
  if (outFile && result.ok) {
    const { writeFileSync } = await import('node:fs');
    const body = result.data !== undefined ? JSON.stringify(result.data, null, 2) + '\n' : (result.stdout || '');
    writeFileSync(outFile, body, 'utf8');
    if (!quiet) process.stdout.write(c.green(`✓ 已写入 ${outFile}（${body.length} 字符）\n`));
  }
  if (doCopy && result.ok) {
    // @ts-expect-error 插件侧 .mjs 无类型声明（运行时存在；类型层留白是刻意的——插件代码不该被内核类型卡住）
    const { clipboardIO } = await import('../plugins/clipboard/clipio.mjs');
    const r = clipboardIO().write(JSON.stringify(result.data ?? result.stdout, null, 2));
    if (!quiet) process.stdout.write(r.ok ? c.green('✓ 已复制到剪贴板\n') : c.yellow(`! 复制失败：${String(r.error).slice(0, 80)}\n`));
  }
  // 第六十五轮⑤：分享文件落盘（.md/.html 按扩展名分流，其它按 md）
  if (shareFile && result.ok) {
    const { toShareMarkdown, toShareHtml } = await import('./core/share.ts');
    const meta = { plugin: pluginId, action: actionId, at: Date.now(), ms: result.ms, ok: true };
    const isHtml = /\.html?$/i.test(shareFile);
    const text = isHtml ? toShareHtml(result.data, meta) : toShareMarkdown(result.data, meta);
    const { writeFileSync } = await import('node:fs');
    writeFileSync(shareFile, text, 'utf8');
    process.stdout.write(c.green(`✓ 分享文件已生成：${shareFile}（${isHtml ? 'HTML 单文件' : 'Markdown'}，${text.length} 字符）\n`));
  }
  // 第四十五轮⑧：--watch N 进入轮询，只打印 diff，Ctrl-C 退出
  if (watchSec && result.ok) {
    const sec = cliX.normalizeWatchSec(watchSec);
    if (!quiet) process.stderr.write(c.dim(`（每 ${sec}s 轮询一次，Ctrl-C 退出）\n`));
    let prev: unknown = result.data;
    for (;;) {
      await new Promise((r) => setTimeout(r, sec * 1000));
      const cur = await runAction(plugin, action, { caller: 'cli', values: withDefaults.values });
      if (!cur.ok) { process.stdout.write(c.red(`✗ ${new Date().toLocaleTimeString()} 轮询失败：${cur.error}\n`)); prev = undefined; continue; }
      for (const line of cliX.diffTopLevel(prev, cur.data)) {
        process.stdout.write(`${c.dim(new Date().toLocaleTimeString())} ${line}\n`);
      }
      prev = cur.data;
    }
  }
  if (!result.ok && !asJson) {
    // 第三十五轮⑤⑥：失败输出自诊断——error 与 stderr 都扫，认不出就不添乱
    // 第四十八轮⑥：与 UI/MCP 同一套知识库——认不出也给 exit-nonzero 兜底分类
    const d = diagnose(String((result as { error?: string }).error ?? '') + '\n' + String(result.stderr ?? ''))
      ?? { kind: 'exit-nonzero', headline: '程序报错退出', nextSteps: ['看上方 stderr 原文定位报错行', '同参数重试一次排除偶发'] };
    process.stderr.write(c.yellow(`\n⟐ 看起来是：${d.headline}\n下一步：\n`));
    for (const st of d.nextSteps) process.stderr.write(`  - ${st}\n`);
    // 第八十三轮①②：退出码语义 + 超时对照（只加有把握的增量信息，未知码不硬猜）
    const oc = (result as { exitCode?: number | null }).exitCode ?? null;
    const codeDiag = diagnoseExitCode(oc);
    if (codeDiag) process.stderr.write(c.dim(`⟐ 退出码 ${codeDiag.code}：${codeDiag.headline}\n  ${codeDiag.detail}\n`));
    const r = result as { timedOut?: boolean; ms?: number; timeoutSec?: number };
    if (r.timedOut && typeof r.ms === 'number' && typeof r.timeoutSec === 'number') {
      const t = timeoutDiagnosis(r.ms, r.timeoutSec);
      if (t) process.stderr.write(c.dim(`⟐ ${t}\n`));
    }
  }
  return result.ok ? 0 : 1;
}

/**
 * zkit plugin update [id]：不带 id 列出全部插件的可更新状态，带 id 则检查并更新。
 *
 * 更新 = 从当初的安装来源拉新版替换目录。替换前把「版本变化 + 动作增删」
 * 摊开让人确认——更新本质上和装一个新插件一样，能力面变了就该再看一眼。
 */
async function cmdPluginUpdate(args: string[]): Promise<number> {
  const id = args.find((a) => !a.startsWith('-'));
  const yes = args.includes('--yes');

  if (!id) {
    const list = listUpdateStates();
    process.stdout.write(c.bold(`已装 ${list.length} 个插件：\n`));
    for (const u of list) {
      const state = u.available
        ? c.yellow(`有更新（来源处是 ${u.latest ?? '?'}）`)
        : c.dim(u.reason ?? '已是最新');
      process.stdout.write(`  ${pad(u.id, 16)} ${pad('v' + u.current, 12)} ${pad(u.sourceText, 30)} ${state}\n`);
    }
    process.stdout.write(c.dim('\n检查并更新某一个：zkit plugin update <插件id>\n'));
    return 0;
  }

  const check = checkUpdate(id);
  if (!check.source) {
    process.stderr.write(c.red(`✗ ${id}：${check.reason ?? '无法更新'}\n`));
    return 1;
  }
  process.stdout.write(`${c.bold(check.name)} ${c.dim(id)}  ${check.sourceText}\n`);
  process.stdout.write(`  当前版本 v${check.current}\n`);
  if (!check.available) {
    process.stdout.write(c.green(`✓ ${check.reason ?? '已是最新版本'}\n`));
    return 0;
  }
  process.stdout.write(`  最新版本 ${c.bold('v' + (check.latest ?? '?'))}\n`);
  if (check.addedActions.length > 0) {
    process.stdout.write(c.green(`  新增动作：${check.addedActions.join(', ')}\n`));
  }
  if (check.removedActions.length > 0) {
    process.stdout.write(c.yellow(`  移除动作：${check.removedActions.join(', ')}\n`));
  }
  process.stdout.write(c.dim('  插件目录会被整体替换；持久数据放在数据目录里不受影响。\n'));
  // 第八十七轮④：升级顺序提示——依赖树里被依赖的先升，反过来升会有一段「新链旧环」的窗口
  {
    const installed = listPlugins().map((e) => e.plugin).filter((x): x is NonNullable<typeof x> => Boolean(x));
    const order = topoOrder(installed);
    const myPos = order.indexOf(id);
    const dependents = order.filter((oid) => {
      const op = installed.find((x) => x.id === oid);
      return op?.pluginDeps.includes(id);
    });
    if (dependents.length > 0) {
      process.stdout.write(c.dim(`  有 ${dependents.length} 个插件依赖它（${dependents.join(', ')}）；如果一起升级，先升本插件（拓扑序：${order.join(' → ')}）。\n`));
    } else if (myPos >= 0) {
      process.stdout.write(c.dim('  无插件依赖它，升级顺序无关。\n'));
    }
  }

  if (!yes) {
    if (!process.stdin.isTTY) {
      process.stderr.write(c.red('✗ 更新会替换插件代码，非交互环境需要 --yes 确认。\n'));
      return 1;
    }
    process.stderr.write('继续更新？(y/N) ');
    const answer = await readLine();
    if (!/^y(es)?$/i.test(answer.trim())) {
      process.stderr.write('已取消。\n');
      return 1;
    }
  }

  const result = applyUpdate(id);
  for (const w of result.warnings) process.stderr.write(c.yellow(`! ${w}`) + '\n');
  process.stdout.write(result.ok ? c.green(`✓ ${result.message}\n`) : c.red(`✗ ${result.message}\n`));
  // 新版本可能引入了新的插件依赖：更新完立刻说清楚，别等第一次执行才炸
  if (result.ok) finishDeps(id, false);
  return result.ok ? 0 : 1;
}

/**
 * 装完插件后处理依赖：withDeps 时先补，再报告仍然缺什么。
 *
 * 返回 1 只在「明确要求补依赖但没补齐」时发生——安装本身是成功的，
 * 不该因为缺依赖而让脚本以为装失败了。
 */
function finishDeps(id: string, withDeps: boolean): number {
  const plugin = requirePlugin(id);
  if (withDeps) {
    const r = installDeps(plugin);
    for (const dep of r.installed) process.stdout.write(c.green(`  ✓ 补装依赖 ${dep}\n`));
    for (const err of r.errors) process.stderr.write(c.red(`  ✗ ${err}\n`));
  }
  const missing = missingDeps(requirePlugin(id));
  if (missing.length === 0) return 0;
  process.stderr.write(c.yellow(`  缺少插件依赖：${missing.join(', ')}\n`));
  for (const dep of missing) process.stderr.write(c.dim(`    zkit plugin install ${dep}\n`));
  return withDeps ? 1 : 0;
}

function printDepTree(nodes: ReturnType<typeof depTree>, indent: string): void {
  for (const n of nodes) {
    const head = n.installed
      ? `${c.green('✓')} ${n.id}  ${c.dim('v' + (n.version ?? '?'))}`
      : `${c.red('✗')} ${n.id}  ${c.yellow('未安装')}  ${c.dim(`zkit plugin install ${n.id}`)}`;
    process.stdout.write(`${indent}${head}\n`);
    printDepTree(n.children, indent + '  ');
  }
}

async function cmdPlugin(args: string[]): Promise<number> {
  const sub = args[0];
  if (sub === 'new') {
    const rest = args.slice(1);
    const id = rest.find((a) => !a.startsWith('--'));
    if (!id) {
      process.stderr.write('用法：zkit plugin new <id> [--name 名字] [--author 作者] [--description 一句话简介] [--runtime node|python] [--web] [--dir 目录] [--example chain|setting|http]\n');
      return 2;
    }
    const flag = (name: string): string | undefined => {
      const i = rest.indexOf(`--${name}`);
      return i >= 0 ? rest[i + 1] : undefined;
    };
    const runtime = flag('runtime');
    if (runtime && runtime !== 'node' && runtime !== 'python') {
      process.stderr.write(c.red(`✗ --runtime 只支持 node 或 python，收到 "${runtime}"\n`));
      return 2;
    }
    // 第三十六轮③：专题模板 --example chain|setting|http
    const exampleFlag = flag('example');
    if (exampleFlag && !['chain', 'setting', 'http'].includes(exampleFlag)) {
      process.stderr.write(c.red(`✗ --example 只支持 chain / setting / http，收到 "${exampleFlag}"\n`));
      return 2;
    }
    const r = scaffoldPlugin(id, {
      name: flag('name'),
      // 第六十八轮⑧：--author/--description 免得装完不知道谁写的/干嘛的
      author: flag('author'),
      summary: flag('description'),
      runtime: runtime as ScaffoldRuntime | undefined,
      web: rest.includes('--web'),
      dir: flag('dir'),
      example: exampleFlag as ScaffoldExample | undefined,
    });
    if (!r.ok || !r.dir || !r.load?.plugin) {
      process.stderr.write(c.red(`✗ ${r.message}\n`));
      return 1;
    }
    const p = r.load.plugin;
    process.stdout.write(c.green(`✓ ${r.message}：${r.dir}（${exampleFlag ? exampleFlag + ' 专题' : (runtime ?? 'node')} 模板）\n`));
    for (const f of r.files) process.stdout.write(c.dim(`  ${f}\n`));
    process.stdout.write(`\n清单校验通过，${p.name} 有 ${p.actions.length} 个动作：\n`);
    for (const a of p.actions) {
      process.stdout.write(`  ${c.bold(a.id)}  ${a.title}（${RISK_LABEL[a.risk] ?? a.risk}，${a.params.length} 个参数）\n`);
    }
    // 把「一份清单 → 四个面」在创建的第一秒摊开：内容全部从生成的清单对象推导
    const first = p.actions[0]!;
    const firstParam = first.params[0];
    const example = firstParam
      ? `zkit run ${p.id} ${first.id} --${firstParam.name} ${String(firstParam.default ?? '值')}`
      : `zkit run ${p.id} ${first.id}`;
    process.stdout.write(`\n装进 zerokit 后，${c.bold('同一份清单')}在四个面的样子：\n`);
    process.stdout.write(`  ${c.cyan('CLI')}        ${example}\n`);
    process.stdout.write(`  ${c.cyan('MCP')}        工具 ${toolName(p.id, first.id)}（inputSchema 自动生成）\n`);
    process.stdout.write(`  ${c.cyan('启动器')}     关键词 ${p.keywords.map((k) => `"${k}"`).join(' / ') || p.id} → 动作列表 → 参数表单\n`);
    process.stdout.write(`  ${c.cyan('工作台')}     模型的工具，对话式调用，${RISK_LABEL[first.risk] ?? first.risk}动作按策略确认\n`);
    process.stdout.write(`\n${c.bold('下一步')}：\n`);
    process.stdout.write(c.dim(`  zkit plugin dev ${r.dir}   进入开发模式（改文件即生效，四个面都会跟上）\n`));
    return 0;
  }
  if (sub === 'dev') {
    const source = args[1];
    if (!source) {
      process.stderr.write('用法：zkit plugin dev <目录> [--open] [--watch]\n');
      return 2;
    }
    // 第七十一轮⑤：--open 装好后立即自动验证（清单加载 + 首个只读动作实跑）；
    // --watch 目录监听（fs.watch 递归），改动即重新验证——反馈回路从「手动跑」缩到「存盘即验」
    const doOpen = args.includes('--open');
    const doWatch = args.includes('--watch');
    const result = devLink(source);
    for (const w of result.warnings) process.stderr.write(c.yellow(`! ${w}`) + '\n');
    process.stdout.write(result.ok ? c.green(`✓ ${result.message}\n`) : c.red(`✗ ${result.message}\n`));
    if (!result.ok) return 1;
    if (result.id) {
      process.stdout.write(c.dim(`  跑一下看看：zkit run ${result.id} hello\n`));
      process.stdout.write(c.dim(`  退出开发模式：zkit plugin remove ${result.id}（只删链接，不碰源目录）\n`));
    }
    const srcAbs = path.resolve(source);
    const verify = async (label: string): Promise<void> => {
      const v = loadDir(srcAbs);
      if (!v.plugin) {
        for (const e of v.errors) process.stdout.write(c.red(`  ✗ [${label}] ${e}\n`));
        return;
      }
      process.stdout.write(c.green(`  ✓ [${label}] 清单有效：${v.plugin.name} v${v.plugin.version} ${v.plugin.actions.length} 个动作\n`));
      const ro = v.plugin.actions.find((a) => a.risk === 'read');
      if (ro) {
        const r = await runAction(v.plugin!, ro, { caller: 'cli', values: {} });
        process.stdout.write(r.ok
          ? c.green(`  ✓ [${label}] 首个只读动作 ${ro.id} 实跑通过（${r.ms}ms）\n`)
          : c.yellow(`  ! [${label}] ${ro.id} 跑失败：${r.error ?? ''}（可能是参数必填，先看 zkit run ${v.plugin.id} ${ro.id} --help）\n`));
      }
    };
    // 第八十六轮①：--web 开发模式提示——dev 链接后宿主页直接能看到（symlink 即实时），
    // 沙箱资源走 /plugin/<id>/ 的正式路径；改文件即生效（symlink 直指源目录），浏览器刷新即可
    if (args.includes('--web')) {
      const port = args.find((a, i) => args[i - 1] === '--port');
      const portNo = port ? String(Number(port)) : '28970';
      process.stdout.write(c.green(`  ✓ Web 开发模式：宿主页 http://127.0.0.1:${portNo} → 搜「${result.id ?? '插件'}」直接跑 web 动作\n`));
      process.stdout.write(c.dim(`    沙箱资源即改即生效（dev 链接直指源目录）；宿主页刷新一次即可看到新资源\n`));
      process.stdout.write(c.dim(`    zkit ui ${port ? `--port ${portNo} ` : ''}先起界面（若未起）\n`));
      process.stdout.write(c.dim(`    dev 状态接口：/api/dev/status（清单摘要+文件树）、/api/dev/poll（变更时间戳）\n`));
    }
    if (doOpen) await verify('open');
    if (doWatch) {
      process.stdout.write(c.dim(`（监听 ${srcAbs} 改动即重新验证，Ctrl-C 退出）\n`));
      let timer: ReturnType<typeof setTimeout> | undefined;
      try {
        const watcher = fs.watch(srcAbs, { recursive: true }, () => {
          clearTimeout(timer);
          timer = setTimeout(() => { void verify('watch'); }, 250);  // 防抖：编辑器连写只验一次
        });
        await new Promise<void>((resolve) => {
          process.on('SIGINT', () => { watcher.close(); resolve(); });
        });
      } catch (e) {
        process.stderr.write(c.yellow(`! 监听失败（${(e as Error).message}），--watch 在此平台不可用\n`));
      }
    }
    return 0;
  }
  if (sub === 'validate') {
    const dir = args[1];
    if (!dir) {
      process.stderr.write('用法：zkit plugin validate <目录>\n');
      return 2;
    }
    const abs = path.resolve(dir);
    if (!fs.existsSync(path.join(abs, 'plugin.toml'))) {
      process.stderr.write(c.red(`✗ ${abs} 下没有 plugin.toml\n`));
      return 1;
    }
    const result = loadDir(abs);
    for (const e of result.errors) process.stderr.write(c.red(`✗ ${e}\n`));
    for (const w of result.warnings) process.stderr.write(c.yellow(`! ${w}\n`));
    if (!result.plugin) return 1;
    const p = result.plugin;
    process.stdout.write(c.green(`✓ ${p.name} ${p.id} v${p.version} 清单有效\n`));
    for (const a of p.actions) {
      const params = a.params.map((x) => `${x.name}:${x.type}${x.required ? '' : '?'}`).join(' ');
      process.stdout.write(`  ${c.bold(a.id)}  ${a.title}  ${c.dim(`<${toolName(p.id, a.id)}>`)} ${params}\n`);
    }
    return 0;
  }
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
    // 本地目录优先，而且优先于"形状像不像 owner/repo"的判断。
    // 否则 `zkit plugin add plugins/clipboard` 会因为恰好是「一段/一段」的形状
    // 被当成 GitHub 仓库去 clone（实测踩到，还会白等一次网络超时）。
    // 真要装同名的远端仓库，写全 https://github.com/owner/repo 即可。
    let isLocalDir = false;
    try {
      isLocalDir = fs.statSync(source).isDirectory();
    } catch {
      /* 不存在就当它不是本地目录 */
    }
    const isGit = !isLocalDir
      && (/^(https?:\/\/|git@)/.test(source) || /^[\w.-]+\/[\w.-]+$/.test(source));
    const withDeps = args.includes('--with-deps');
    const result = isGit
      ? addFromGit(/^[\w.-]+\/[\w.-]+$/.test(source) ? `https://github.com/${source}.git` : source)
      : addFromDir(source, {
        // 本地目录也记来源：update 时如实提示「去源目录改完重新 add」而不是瞎猜
        source: { type: 'dir', installedAt: new Date().toISOString(), installedVersion: '' },
      });
    for (const w of result.warnings) process.stderr.write(c.yellow(`! ${w}`) + '\n');
    process.stdout.write(result.ok ? c.green(`✓ ${result.message}\n`) : c.red(`✗ ${result.message}\n`));
    if (!result.ok) return 1;
    const depCode = result.id ? finishDeps(result.id, withDeps) : 0;
    if (result.id) process.stdout.write(c.dim(`  看看它有什么动作：zkit show ${result.id}\n`));
    return depCode;
  }
  if (sub === 'remove' || sub === 'rm') {
    const id = args[1];
    if (!id) {
      process.stderr.write('用法：zkit plugin remove <插件> [--force]\n');
      return 2;
    }
    // 别人还在依赖它时先拦住：删掉依赖会让那些插件的动作在运行时才炸
    const users = dependents(id);
    if (users.length > 0 && !args.includes('--force')) {
      process.stderr.write(c.red(`✗ 还有插件依赖 "${id}"：${users.join(', ')}\n`));
      process.stderr.write(c.dim('  真要删就先卸载它们，或者加 --force 强行删除（会留下跑不起来的插件）\n'));
      return 1;
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
  if (sub === 'deps') {
    const id = args[1] && !args[1].startsWith('-') ? args[1] : undefined;
    if (!id) {
      let bad = 0;
      for (const entry of listPlugins()) {
        const p = entry.plugin;
        if (!p) continue;
        const missing = missingDeps(p);
        if (missing.length === 0) continue;
        bad++;
        process.stdout.write(`${c.bold(p.name)} ${c.dim(p.id)}  ${c.red(`缺 ${missing.join(', ')}`)}\n`);
        for (const dep of missing) process.stdout.write(c.dim(`  zkit plugin install ${dep}\n`));
      }
      if (bad === 0) process.stdout.write(c.green('✓ 所有插件的依赖都齐了\n'));
      return bad === 0 ? 0 : 1;
    }
    const plugin = requirePlugin(id);
    process.stdout.write(`${c.bold(plugin.name)} ${c.dim(plugin.id)} v${plugin.version}\n`);
    const tree = depTree(plugin);
    if (tree.length === 0) {
      process.stdout.write(c.dim('  没有声明插件依赖。\n'));
      return 0;
    }
    process.stdout.write('\n依赖：\n');
    printDepTree(tree, '  ');
    // 第八十七轮①：健康态（版本核对）——现在无版本区间形态，satisfies 恒 true，接口留给未来
    process.stdout.write('\n健康态：\n');
    for (const h of depHealth(plugin)) {
      const mark = h.installed ? c.green('✓ 已装') : c.red('✗ 缺失');
      const ver = h.version ? ` v${h.version}` : '';
      const sat = h.installed && h.satisfies === false ? c.yellow(`（不满足 ${h.requirement ?? ''}）`) : '';
      process.stdout.write(`  ${mark} ${h.id}${ver}${sat}\n`);
    }
    return missingDeps(plugin).length > 0 ? 1 : 0;
  }
  if (sub === 'install') {
    return cmdPluginInstall(args.slice(1));
  }
  if (sub === 'update' || sub === 'outdated') {
    return cmdPluginUpdate(args.slice(1));
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
  // ---- 第三十四轮：分发与市场工具 ----
  if (sub === 'pack') return cmdPluginPack(args.slice(1));
  if (sub === 'unpack') return cmdPluginUnpack(args.slice(1));
  if (sub === 'verify') return cmdPluginVerify(args.slice(1));
  if (sub === 'info') return cmdPluginInfo(args.slice(1));
  if (sub === 'recommend') return cmdPluginRecommend(args.slice(1));
  if (sub === 'lint') return cmdPluginLint(args.slice(1));
  if (sub === 'doc') return cmdPluginDoc(args.slice(1));
  if (sub === 'publish-ready') return cmdPublishReady(args.slice(1));
  process.stderr.write('用法：zkit plugin <new|dev|validate|install|add|update|remove|bundled|export|import|pack|unpack|info|recommend|lint|doc|publish-ready>\n');
  return 2;
}

/** ①⑤⑥zkit plugin lint <id|目录>：清单体检。error 非零退出（CI 可用），warn/info 不影响。 */
function cmdPluginLint(args: string[]): number {
  const rest = args.filter((a) => !a.startsWith('-'));
  const target = rest[0];
  if (!target) { process.stderr.write('用法：zkit plugin lint <id|目录> [--json]\n'); return 2; }
  let dir: string | null = null;
  if (fs.existsSync(path.join(target, 'plugin.toml'))) dir = path.resolve(target);
  else {
    const guess = path.join(PLUGINS_DIR, target);
    if (fs.existsSync(path.join(guess, 'plugin.toml'))) dir = guess;
  }
  if (!dir) { process.stderr.write(c.red(`✗ 没找到插件 "${target}"（既不是含 plugin.toml 的目录，也不在已装列表里）\n`)); return 1; }
  const { loadPlugin } = loadPluginRef;
  const res = loadPlugin(dir);
  if (res.errors.length > 0 || !res.plugin) {
    process.stdout.write(c.bold(`体检报告：${target}\n`));
    for (const e of res.errors) process.stdout.write(c.red(`  ✗ error  ${e}\n`));
    process.stdout.write(c.dim('  清单本身加载失败，先修上面的错误再体检。\n'));
    return 1;
  }
  const findings = lintPlugin(res.plugin);
  if (args.includes('--json')) {
    process.stdout.write(JSON.stringify({ id: res.plugin.id, findings, errorCount: findings.filter((f) => f.severity === 'error').length }, null, 2) + '\n');
    return findings.some((f) => f.severity === 'error') ? 1 : 0;
  }
  process.stdout.write(c.bold(`体检报告：${res.plugin.name}（${res.plugin.id}）\n`));
  if (findings.length === 0) {
    process.stdout.write(c.green('  ✓ 全部通过，零发现\n'));
    return 0;
  }
  const icon: Record<string, string> = { error: c.red('✗ error'), warn: c.yellow('! warn '), info: c.dim('· info ') };
  for (const f of findings) process.stdout.write(`  ${icon[f.severity]}  ${c.dim(f.rule)} ${f.target}：${f.message}\n`);
  const errs = findings.filter((f) => f.severity === 'error').length;
  const warns = findings.filter((f) => f.severity === 'warn').length;
  process.stdout.write(c.dim(`  共 ${findings.length} 项（error ${errs} / warn ${warns} / info ${findings.length - errs - warns}）\n`));
  return errs > 0 ? 1 : 0;
}

/** ②④zkit plugin doc <id|目录> [--json]：从清单生成参考文档。 */
function cmdPluginDoc(args: string[]): number {
  const rest = args.filter((a) => !a.startsWith('-'));
  const target = rest[0];
  if (!target) { process.stderr.write('用法：zkit plugin doc <id|目录> [--json]\n'); return 2; }
  let plugin: Plugin;
  try { plugin = requirePlugin(target); } catch (e) {
    // 装好的找不到时，回退读目录（作者在源码目录里就能生成）
    const dir = path.resolve(target);
    if (!fs.existsSync(path.join(dir, 'plugin.toml'))) {
      process.stderr.write(c.red(`✗ ${(e as Error).message}\n`)); return 1;
    }
    const res = loadPluginRef.loadPlugin(dir);
    if (!res.plugin) { process.stderr.write(c.red(`✗ ${res.errors.join('; ')}\n`)); return 1; }
    plugin = res.plugin;
  }
  if (args.includes('--json')) {
    process.stdout.write(JSON.stringify(docPluginJson(plugin), null, 2) + '\n');
  } else {
    process.stdout.write(docPlugin(plugin) + '\n');
  }
  return 0;
}

/** 惰性拿 loadPlugin（避免顶层 import 抖动到无关路径）。 */
const loadPluginRef = await import('./core/manifest.ts');

/** ①③zkit plugin pack <id> [--out 目录] [--list-only]：打包/清单。 */
function cmdPluginPack(args: string[]): number {
  const id = args.find((a) => !a.startsWith('-'));
  if (!id) {
    process.stderr.write('用法：zkit plugin pack <id> [--out 目录] [--list-only 只看清单不落盘]\n');
    return 2;
  }
  const outIdx = args.indexOf('--out');
  if (args.includes('--list-only')) {
    // 只列文件不打包：先 pack 到临时目录再删——简单直接，pack 本身很快
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'zkit-pack-'));
    const r = packPlugin(id, tmp);
    fs.rmSync(tmp, { recursive: true, force: true });
    if (!r.ok) { process.stderr.write(c.red(`✗ ${r.message}\n`)); return 1; }
    process.stdout.write(`${id} 将打包 ${r.files?.length} 个文件（约 ${r.bytes} 字节）：\n`);
    for (const f of r.files ?? []) process.stdout.write(c.dim(`  ${f}\n`));
    return 0;
  }
  const r = packPlugin(id, outIdx >= 0 ? args[outIdx + 1] : undefined);
  if (!r.ok) { process.stderr.write(c.red(`✗ ${r.message}\n`)); return 1; }
  const r2 = r as { integrity?: string };
  process.stdout.write(c.green(`✓ ${r.file}（${r.files?.length} 个文件，${r.bytes} 字节）\n`));
  for (const f of r.files ?? []) process.stdout.write(c.dim(`  ${f}\n`));
  if (r2.integrity) process.stdout.write(c.dim(`  完整性：${r2.integrity}\n`));
  process.stdout.write(c.dim('  包里不含用户设置值（settings 只带 .example 模板）\n'));
  return 0;
}

/** ②zkit plugin unpack <zip> [--replace] */
function cmdPluginUnpack(args: string[]): number {
  const file = args.find((a) => !a.startsWith('-'));
  if (!file) {
    process.stderr.write('用法：zkit plugin unpack <zip 文件> [--replace 覆盖已装版本] [--strict 拒绝无签名清单的包]\n');
    return 2;
  }
  const r = unpackPlugin(file, { replace: args.includes('--replace'), verify: !args.includes('--no-verify'), strict: args.includes('--strict') });
  if (!r.ok) { process.stderr.write(c.red(`✗ ${r.message}\n`)); return 1; }
  process.stdout.write(c.green(`✓ ${r.message}\n`));
  return 0;
}

/** 第六十二轮⑤：zkit plugin verify <id>——对已装插件复验完整性。 */
function cmdPluginVerify(args: string[]): number {
  const id = args.find((a) => !a.startsWith('-'));
  if (!id) { process.stderr.write('用法：zkit plugin verify <id>\n'); return 2; }
  const v = verifyInstalled(id);
  if (v.noSnapshot) { process.stdout.write(c.yellow(`! ${v.message}\n`)); return 0; }
  if (!v.ok && v.message && !v.changed.length && !v.missing.length) {
    process.stderr.write(c.red(`✗ ${v.message}\n`)); return 1;
  }
  if (v.ok) {
    process.stdout.write(c.green(`✓ ${id} ${v.message}\n`));
    if (v.added.length) process.stdout.write(c.yellow(`! 后加的 ${v.added.length} 个文件（装时快照里没有）：\n`) + v.added.map((f) => c.dim(`  + ${f}\n`)).join(''));
    return 0;
  }
  process.stderr.write(c.red(`✗ ${id} 与装时不一致：\n`));
  for (const f of v.changed) process.stderr.write(c.red(`  ~ ${f}（内容被改动）\n`));
  for (const f of v.missing) process.stderr.write(c.red(`  - ${f}（被删除）\n`));
  process.stderr.write(c.dim('  被改过的插件别直接用：重装（plugin unpack --replace）或找作者确认\n'));
  return 1;
}

/** ④zkit plugin publish-ready <id>：上架检查。 */
function cmdPublishReady(args: string[]): number {
  const id = args.find((a) => !a.startsWith('-'));
  if (!id) { process.stderr.write('用法：zkit plugin publish-ready <id>\n'); return 2; }
  let plugin: Plugin | null = null;
  try { plugin = requirePlugin(id); } catch { /* 清单可能本身有硬伤——走静态检查 */ }
  if (!plugin) {
    const tomlFile = path.join(PLUGINS_DIR, id, 'plugin.toml');
    if (!fs.existsSync(tomlFile)) {
      process.stderr.write(c.red(`✗ 没有找到插件 "${id}"（目录与清单都不存在）\n`));
      return 1;
    }
    const text = fs.readFileSync(tomlFile, 'utf8');
    const problems: Array<{ level: 'error' | 'warning'; text: string; hint?: string }> = [];
    if (!/^risk\s*=/m.test(text)) problems.push({ level: 'error', text: '有动作没声明 risk——清单加载直接失败', hint: 'read / mutate / destructive 三选一' });
    const vm = text.match(/^version\s*=\s*"([^"]+)"/m);
    if (!vm || !/^\d+\.\d+\.\d+/.test(vm[1] ?? '')) problems.push({ level: 'error', text: `版本号 "${vm?.[1] ?? '缺失'}" 不是语义化格式` });
    for (const p2 of problems) process.stdout.write(c.red(`✗ ${p2.text}${p2.hint ? c.dim(`（${p2.hint}）`) : ''}\n`));
    process.stdout.write(c.red('✗ 清单无法加载，先修以上硬伤（zkit plugin validate 可看完整诊断）\n'));
    return 1;
  }
  const plug: Plugin = plugin;
  const r = publishReady(id, plug);
  for (const p of r.problems) {
    const mark = p.level === 'error' ? c.red('✗') : c.yellow('!');
    process.stdout.write(`${mark} ${p.text}${p.hint ? c.dim(`（${p.hint}）`) : ''}\n`);
  }
  if (r.ok && r.problems.length === 0) process.stdout.write(c.green(`✓ ${plug.name} 达到上架标准\n`));
  else if (r.ok) process.stdout.write(c.yellow(`! 可以上架，但有 ${r.problems.length} 条建议先处理\n`));
  else process.stdout.write(c.red(`✗ ${r.problems.filter((x) => x.level === 'error').length} 个硬伤，先修再上架\n`));
  return r.ok ? 0 : 1;
}

/** ⑦zkit plugin info <id>：一页看全。 */
function cmdPluginInfo(args: string[]): number {
  const id = args.find((a) => !a.startsWith('-'));
  if (!id) { process.stderr.write('用法：zkit plugin info <id>\n'); return 2; }
  let plugin: Plugin;
  try { plugin = requirePlugin(id); } catch (e) {
    process.stderr.write(c.red(`✗ ${(e as Error).message}\n`)); return 1;
  }
  const risk: Record<string, number> = {};
  for (const a of plugin.actions) risk[a.risk] = (risk[a.risk] ?? 0) + 1;
  const stats = actionStats(readAudit()).find((s) => s.key === `${id}.*` || s.plugin === id);
  process.stdout.write(c.bold(`${plugin.name} ${c.dim(`v${plugin.version} · ${plugin.id}`)}\n`));
  process.stdout.write(`  ${plugin.summary ?? ''}\n`);
  process.stdout.write(`  动作 ${plugin.actions.length} 个（${Object.entries(risk).map(([k, v]) => `${k} ${v}`).join(' / ') || '无'}）\n`);
  if (stats) {
    process.stdout.write(`  最近使用 ${stats.count} 次，P50 ${stats.p50Ms ?? '—'}ms\n`);
  } else {
    process.stdout.write(c.dim('  还没有执行记录\n'));
  }
  if (plugin.settings && plugin.settings.length > 0) {
    process.stdout.write(`  设置项 ${plugin.settings.length} 个：${plugin.settings!.map((x: { name: string }) => x.name).join(', ')}\n`);
  }
  process.stdout.write(c.dim('  分享：zkit plugin pack ' + id + '  /  检查：zkit plugin publish-ready ' + id + '\n'));
  return 0;
}

/** ⑧zkit plugin recommend <id>：可粘贴的推荐语。 */
function cmdPluginRecommend(args: string[]): number {
  const id = args.find((a) => !a.startsWith('-'));
  if (!id) { process.stderr.write('用法：zkit plugin recommend <id>\n'); return 2; }
  let plugin: Plugin;
  try { plugin = requirePlugin(id); } catch (e) {
    process.stderr.write(c.red(`✗ ${(e as Error).message}\n`)); return 1;
  }
  const reads = plugin.actions.filter((a) => a.risk === 'read').length;
  const lines = [
    `【zerokit 插件推荐】${plugin.name}（${plugin.id}）`,
    plugin.summary ?? '',
    `一共 ${plugin.actions.length} 个动作，其中 ${reads} 个只读即用；关键词：${plugin.keywords.slice(0, 5).join('、') || plugin.id}。`,
    `安装：zkit plugin install ${id}（或从集市面板搜索「${plugin.name}」）`,
  ].filter(Boolean);
  process.stdout.write(lines.join('\n') + '\n');
  return 0;
}



/**
 * 第三十二轮⑨：zkit desktop —— 桌面壳体检。
 * 壳是可选组件（Tauri 原生应用），没装不算错，只说明用不了桌面体验。
 */
function cmdDesktop(args: string[]): number {
  const asJson = args.includes('--json');
  const os = process.platform;
  // 壳的可执行文件名按平台约定
  const exeName = os === 'win32' ? 'zerokit-desktop.exe' : 'zerokit-desktop';
  // 可能的安装位置：仓库本地构建（target/release）与 ~/.zerokit/bin
  const candidates: string[] = [];
  const repoTarget = path.join(import.meta.dirname ?? '.', '..', 'apps', 'desktop', 'src-tauri', 'target', 'release', exeName);
  candidates.push(path.resolve(repoTarget));
  const home = process.env['ZEROKIT_HOME']
    ? path.resolve(process.env['ZEROKIT_HOME'])
    : path.join(os === 'win32' ? (process.env['USERPROFILE'] ?? '') : (process.env['HOME'] ?? ''), '.zerokit');
  candidates.push(path.join(home, 'bin', exeName));

  const found = candidates.find((p) => { try { return fs.statSync(p).isFile(); } catch { return false; } });
  // 桌面配置（壳写的 ~/.zerokit/desktop.json）顺带读出来
  let desktopConfig: unknown = null;
  try { desktopConfig = JSON.parse(fs.readFileSync(path.join(home, 'desktop.json'), 'utf8')); } catch { /* 没配过 */ }

  if (asJson) {
    process.stdout.write(JSON.stringify({
      installed: !!found, path: found ?? null, platform: os,
      config: desktopConfig,
      hint: found ? null : '未安装桌面壳不影响 CLI/Web/MCP；想要全局热键与托盘体验时再装（apps/desktop 下 cargo build --release）。',
    }, null, 2) + '\n');
    return 0;
  }
  if (found) {
    process.stdout.write(c.green('✓') + ` 桌面壳已安装\n  ${c.dim(found)}\n`);
  } else {
    process.stdout.write(c.yellow('!') + ' 桌面壳未安装（不影响 CLI / Web / MCP）\n'
      + c.dim('  想要全局热键、托盘、失焦隐藏体验时：cd apps/desktop/src-tauri && cargo build --release\n'));
  }
  if (desktopConfig && typeof desktopConfig === 'object') {
    const cfg = desktopConfig as { hotkey?: string; window?: { width: number; height: number } };
    const bits: string[] = [];
    if (cfg.hotkey) bits.push(`热键 ${cfg.hotkey}`);
    if (cfg.window) bits.push(`窗口 ${cfg.window.width}x${cfg.window.height}`);
    if (bits.length) process.stdout.write(`  ${c.dim(bits.join(' · '))}\n`);
  }
  return 0;
}

/**
 * 第八十轮①—⑥：首次运行体验——环境体检 + 上手三步 + 首个插件建议。
 * 首次/回访分开：回访只报状态变化，不把整个体检再念一遍。
 */
async function cmdWelcome(): Promise<number> {
  const { HOME, ensureDirs } = await import('./core/paths.ts');
  const fsmod = await import('node:fs');
  const marker = HOME + '/.welcomed';
  const first = !fsmod.existsSync(marker);
  const report = buildDoctorReport();

  // ③ 分级摘要：✓/⚠/✗ 一行总览（回访也看这行）
  const errs = report.summary.errors;
  const warns = report.summary.warnings;
  const okCount = report.tools.filter((t) => t.ok).length + report.plugins.filter((pl) => !pl.problems.length).length;

  // ⑤ 首个插件建议按平台（零依赖起步）
  const starter = process.platform === 'win32' ? 'sysinfo.overview'
    : process.platform === 'darwin' ? 'quick.now' : 'sysinfo.top';

  // ④ 缺 python 的安装命令（doctor 只说「没找到」，这里给可复制命令）
  const pyInstall = process.platform === 'win32' ? 'winget install Python.Python.3.13'
    : process.platform === 'darwin' ? 'brew install python' : 'sudo apt install python3';

  if (process.argv.includes('--json')) {
    // ⑥ 机读：AI 客户端引导用户
    process.stdout.write(JSON.stringify({
      firstRun: first,
      summary: { ok: okCount, warnings: warns, errors: errs },
      starterAction: starter,
      missingTools: report.tools.filter((t) => !t.ok).map((t) => ({ name: t.name, install: t.name === 'python' ? pyInstall : null })),
      nextSteps: errs > 0
        ? ['zkit doctor 看具体错误', '修好 error 级问题后 zkit run ' + starter]
        : ['zkit plugin bundled 装示例插件', 'zkit run ' + starter, 'zkit ui 打开启动器'],
    }, null, 2) + '\n');
    if (first) { ensureDirs(); fsmod.writeFileSync(marker, String(Date.now())); }
    return errs > 0 ? 1 : 0;
  }

  process.stdout.write(c.bold(first ? '欢迎使用 zerokit\n' : 'zerokit 状态\n'));
  process.stdout.write(`  ${errs > 0 ? c.red(`✗ ${errs}`) : c.green('✓ 0')} 项必须修 · ${warns > 0 ? c.yellow(`⚠ ${warns}`) : '⚠ 0'} 项建议 · ✓ ${okCount} 项通过\n`);
  if (!first) {
    // ② 回访：只报变化——比上次 welcome 之后新出现的 error
    if (errs > 0) {
      process.stdout.write(c.yellow('  上次以来有新问题：zkit doctor 看明细\n'));
    } else {
      process.stdout.write(c.dim('  一切正常。\n'));
    }
    return errs > 0 ? 1 : 0;
  }
  // 首次：上手三步
  process.stdout.write('\n三步跑通：\n');
  process.stdout.write(`  1. ${c.cyan('zkit plugin bundled')}    装示例插件（${report.plugins.length} 个已装则跳过）\n`);
  process.stdout.write(`  2. ${c.cyan(`zkit run ${starter}`)}${' '.repeat(Math.max(1, 20 - starter.length))}跑第一个动作\n`);
  process.stdout.write(`  3. ${c.cyan('zkit ui')}               打开启动器\n`);
  for (const t of report.tools.filter((x) => !x.ok)) {
    process.stdout.write(c.yellow(`  ! ${t.name} 没找到`));
    if (t.name === 'python') process.stdout.write(c.dim(`——要跑 python 插件：${pyInstall}`));
    process.stdout.write('\n');
  }
  if (report.plugins.length === 0) process.stdout.write(c.dim('  （还没装插件——第 1 步会装上）\n'));
  ensureDirs(); fsmod.writeFileSync(marker, String(Date.now()));
  return errs > 0 ? 1 : 0;
}

async function cmdDoctor(): Promise<number> {
  const report = buildDoctorReport();
  // ⑨最近错误计数：审计里的 deny/非零退出——「环境没坏但一直在失败」要浮出来
  const auditView = readAuditDetailed();
  const recentErrs = recentErrors(auditView.records, 50);
  const last24h = recentErrs.filter((r) => Date.now() - new Date(r.ts).getTime() < 86400_000).length;
  // 第八十四轮②：本次体检摘要落历史（report.history 里已带此前 5 条）
  const passedCount = report.tools.filter((t) => t.ok).length
    + report.plugins.filter((pl) => pl.problems.length === 0).length;
  const entry = toHistoryEntry(report, passedCount);
  appendDoctorHistory(entry);
  const fullHistory = readDoctorHistory();
  const diff = diffDoctorHistory(entry, fullHistory[1]);
  // 第八十四轮③：--diff 只看变化
  if (process.argv.includes('--diff')) {
    if (fullHistory.length < 2) {
      process.stdout.write('没有上一次体检记录（这是第一次）。先跑一次 zkit doctor 建立基线。\n');
      return 0;
    }
    process.stdout.write(c.bold(`与上一次（${String(fullHistory[1]!.ts).slice(0, 19).replace('T', ' ')}）对比：\n`));
    if (diff.added.length === 0 && diff.resolved.length === 0 && diff.persist.length === 0) {
      process.stdout.write(c.green('  无变化。\n'));
    }
    for (const t of diff.added) process.stdout.write(c.red(`  + 新增：${t}\n`));
    for (const t of diff.resolved) process.stdout.write(c.green(`  - 已解决：${t}\n`));
    for (const t of diff.persist) {
      const n = persistCount(t, fullHistory);
      process.stdout.write(c.yellow(`  = 仍在：${t}${n > 1 ? c.dim(`（持续 ${n} 次）`) : ''}\n`));
    }
    return 0;
  }
  // 第二十九轮⑥：--json 机读输出——CI/脚本消费诊断结果；退出码语义不变
  if (process.argv.includes('--json')) {
    process.stdout.write(JSON.stringify({
      ok: report.summary.errors === 0,
      summary: report.summary,
      summaryLine: doctorSummaryLine(report, passedCount),
      history: fullHistory.slice(0, 5),
      diff,
      recentErrors: { last24h, total: recentErrs.length },
      tools: report.tools.map((t) => ({ name: t.name, ok: t.ok, version: t.version ?? null, path: t.path ?? null })),
      dirs: report.dirs,
      desktop: report.desktop,
      orphanTimerKeys: report.orphanTimerKeys,
      integrity: report.integrity,
      plugins: report.plugins.map((pl) => ({
        id: pl.id ?? null, name: pl.name ?? null, ok: !pl.problems.some((x) => x.level === 'error'),
        problems: pl.problems.map((x) => ({ level: x.level, text: x.text, hint: x.hint ?? null })),
      })),
    }, null, 2) + '\n');
    return report.summary.errors === 0 ? 0 : 1;
  }
  // 第三十五轮⑦⑧：--fix 自动修可修项 + 半安装插件检测
  const fix = process.argv.includes('--fix');
  const orphans = findOrphanPlugins(report.dirs.plugins);
  if (orphans.length > 0) {
    process.stdout.write(c.yellow(`! 发现 ${orphans.length} 个装了一半的插件目录（无 plugin.toml）：\n`));
    for (const o of orphans) {
      process.stdout.write(c.yellow(`    ${o.id}  ${c.dim(o.hasFiles.join(' ') || '空目录')}\n`));
    }
    if (fix) {
      const fsmod = await import('node:fs');
      for (const o of orphans) {
        fsmod.rmSync(o.dir, { recursive: true, force: true });
        process.stdout.write(c.green(`  ✓ 已清理 ${o.id}\n`));
      }
    } else {
      process.stdout.write(c.dim('    zkit doctor --fix 可清理这些残留目录\n'));
    }
  }
  if (fix) {
    // 缺数据目录/缓存目录直接补齐（ensure 系幂等）
    const { ensureDirs } = await import('./core/paths.ts');
    ensureDirs();
    process.stdout.write(c.green('✓ 数据目录结构已确保齐全\n'));
  }
  process.stdout.write(c.bold('环境自检\n'));
  // 第八十四轮①：三级汇总行置顶——先给全局结论再看明细
  process.stdout.write(`  ${doctorSummaryLine(report, passedCount)}\n`);
  // 第八十四轮④：最近 5 次体检趋势（新→旧）
  if (fullHistory.length >= 2) {
    const trend = fullHistory.slice(0, 5).map((e) => `✗${e.errors}/⚠${e.warnings}`).join(' → ');
    process.stdout.write(c.dim(`  最近体检：${trend}\n`));
  }
  // 第三十二轮⑩：桌面壳是可选组件，单独一行说清状态
  process.stdout.write(report.desktop.installed
    ? `  ${c.green('✓')} 桌面壳已安装${report.desktop.hotkey ? c.dim(`（热键 ${report.desktop.hotkey}）`) : ''}\n`
    : `  ${c.yellow('!')} 桌面壳未安装（可选，不影响 CLI / Web / MCP）\n`);
  for (const tool of report.tools) {
    process.stdout.write(tool.ok
      ? `  ${c.green('✓')} ${tool.name} ${c.dim(tool.version ?? '')}  ${c.dim(tool.path ?? '')}\n`
      : `  ${c.yellow('!')} ${tool.name} 没找到（用到它的插件无法执行）\n`);
  }
  // ⑨人读面：最近 24h 错误行
  process.stdout.write(last24h > 0
    ? `  ${c.red('✗')} 最近 24 小时执行失败 ${last24h} 次（zkit audit --last 10 看明细）\n`
    : `  ${c.green('✓')} 最近 24 小时无执行失败\n`);
  process.stdout.write(`\n数据目录 ${c.dim(report.dirs.home)}\n`);
  process.stdout.write(`插件目录 ${c.dim(report.dirs.plugins)}\n`);

  // 第八十一轮⑦：供应链完整性改动的点名
  if (report.integrity.tampered.length || report.integrity.missingFiles.length || report.integrity.noSnapshot.length) {
    process.stdout.write(c.bold('\n供应链完整性\n'));
    for (const id of report.integrity.tampered) {
      process.stdout.write(c.red(`  ✗ ${id} 内容与装时不一致（被改动）——重装或找作者确认\n`));
    }
    for (const id of report.integrity.missingFiles) {
      process.stdout.write(c.red(`  ✗ ${id} 有文件被删除\n`));
    }
    const ns = report.integrity.noSnapshot;
    for (const id of ns.slice(0, 5)) {
      process.stdout.write(c.yellow(`  ! ${id} 没有装时快照，无法复验（老插件或手动拷入）\n`));
    }
    if (ns.length > 5) process.stdout.write(c.yellow(`  ! …等共 ${ns.length} 个（重新安装即可获得装时快照）\n`));
  } else if (report.integrity.checked > 0) {
    process.stdout.write(c.green(`\n供应链完整性：${report.integrity.clean}/${report.integrity.checked} 个插件复验通过\n`));
  }
  process.stdout.write(c.bold(`\n插件（${report.plugins.length}）\n`));
  for (const plugin of report.plugins) {
    const bad = plugin.problems.some((x) => x.level === 'error');
    process.stdout.write(bad
      ? `  ${c.red('✗')} ${plugin.name || plugin.dir}\n`
      : `  ${c.green('✓')} ${plugin.name} ${c.dim(plugin.id)}\n`);
    for (const problem of plugin.problems) {
      const pn = persistCount(problem.text.length > 120 ? problem.text.slice(0, 117) + '…' : problem.text, fullHistory);
      const persistTag = pn >= 2 ? c.red(` ⚠ 持续 ${pn} 次`) : '';
      process.stdout.write(problem.level === 'error'
        ? c.red(`      ✗ ${problem.text}${persistTag}\n`)
        : c.yellow(`      ! ${problem.text}${persistTag}\n`));
      if (problem.hint) {
        for (const line of problem.hint.split('\n')) process.stdout.write(c.dim(`        ${line}\n`));
      }
    }
  }
  if (report.plugins.length === 0) {
    process.stdout.write(c.dim('  （还没装插件，可执行 zkit plugin bundled）\n'));
  }
  const errors = report.summary.errors;
  process.stdout.write(errors === 0
    ? `\n${c.green('一切正常。')}\n`
    : `\n${c.yellow(`有 ${errors} 处需要处理。`)}\n`);
  return errors === 0 ? 0 : 1;
}

/** 第四十五轮⑤：zkit last——重跑最近一条（--show 只看不跑）。 */
async function cmdLast(args: string[]): Promise<number> {
  const cliX = await import('./core/cliX.ts');
  const list = cliX.readHistory().filter((e) => e.exitCode === 0);
  const last = list.at(-1);
  if (!last) {
    process.stderr.write('还没有成功执行过的命令。先跑一个：zkit run <插件> <动作>\n');
    return 1;
  }
  const argv = cliX.historyToArgv(last);
  if (args.includes('--show')) {
    process.stdout.write(`zkit ${argv.join(' ')}${c.dim(`  （${last.ts}）`)}\n`);
    return 0;
  }
  process.stdout.write(c.dim(`重跑：zkit ${argv.join(' ')}\n`));
  return cmdRun(argv.slice(1));
}

/** 第四十五轮⑥：zkit history [N]——最近 N 条；--rerun N 重跑第 N 条。 */
async function cmdHistory(args: string[]): Promise<number> {
  const cliX = await import('./core/cliX.ts');
  // 第七十一轮④：--failed 只看失败记录，附诊断建议（复用 suggest.ts 的规则表）
  if (args.includes('--failed')) {
    const failed = cliX.readHistory().filter((e) => e.exitCode !== 0).slice(-30).reverse();
    if (failed.length === 0) {
      process.stdout.write(c.green('最近没有失败记录。\n'));
      return 0;
    }
    const { diagnose } = await import('./core/suggest.ts');
    // 第八十三轮④：每条失败附同动作最近 10 次成功率——偶发还是必现一眼可辨
    const allHistory = cliX.readHistory();
    const successRate = (plugin: string, action: string): string | null => {
      const recent = allHistory.filter((h) => h.plugin === plugin && h.action === action).slice(-10);
      if (recent.length < 2) return null;
      const ok = recent.filter((h) => h.exitCode === 0).length;
      const pct = Math.round((ok / recent.length) * 100);
      return `最近 ${recent.length} 次：${pct}% 成功${pct === 0 ? '（必现）' : pct < 50 ? '（多半失败）' : '（偶发）'}`;
    };
    process.stdout.write(c.bold(`最近 ${failed.length} 条失败（zkit history --rerun N 可重跑）：\n`));
    for (let i = 0; i < failed.length; i++) {
      const e = failed[i];
      if (!e) continue;
      process.stdout.write(`  ${String(i + 1).padStart(3)}  ${c.dim(e.ts.slice(5, 19))}  ${c.red('✗')} zkit run ${e.plugin} ${e.action} ${e.argv.join(' ')}\n`);
      const rate = successRate(e.plugin, e.action);
      if (rate) process.stdout.write(c.dim(`      ${rate}\n`));
      const d = diagnose(`exit ${e.exitCode} plugin=${e.plugin} action=${e.action} ${e.argv.join(' ')}`);
      if (d) process.stdout.write(c.yellow(`      ⟐ 看起来是：${d.headline}\n`) + c.dim(`        下一步：${d.nextSteps[0] ?? ''}\n`));
    }
    return 0;
  }
  const list = cliX.readHistory().filter((e) => e.exitCode === 0).slice(-30).reverse();
  const rerunIdx = args.indexOf('--rerun');
  if (rerunIdx >= 0 && args[rerunIdx + 1]) {
    const n = Number(args[rerunIdx + 1]);
    const e = list.find((_, i) => i + 1 === n);
    if (!e) {
      process.stderr.write(`没有第 ${n} 条（共 ${list.length} 条）。\n`);
      return 1;
    }
    const argv = cliX.historyToArgv(e);
    process.stdout.write(c.dim(`重跑：zkit ${argv.join(' ')}\n`));
    return cmdRun(argv.slice(1));
  }
  if (list.length === 0) {
    process.stdout.write('历史为空。先跑一个：zkit run <插件> <动作>\n');
    return 0;
  }
  // 第六十八轮⑤：--tail N 与位置参数同义但更顺手（且允许 --tail 与默认 10 并存）
  const tailIdx = args.indexOf('--tail');
  const tailN = tailIdx >= 0 && args[tailIdx + 1] ? Number(args[tailIdx + 1]) : undefined;
  const n = Math.min(tailN || Number(args[0]) || 10, list.length);
  process.stdout.write(c.bold(`最近 ${n} 条（zkit history --rerun N 可重跑）：\n`));
  for (let i = 0; i < n; i++) {
    const e = list[i];
    if (!e) continue;
    process.stdout.write(`  ${String(i + 1).padStart(3)}  ${c.dim(e.ts.slice(5, 19))}  zkit run ${e.plugin} ${e.action} ${e.argv.join(' ')}\n`);
  }
  return 0;
}

/** 第四十五轮①：交互模式——方向键选插件→选动作→（--interactive 则逐参提问）执行。 */
async function cmdInteractive(args: string[]): Promise<number> {
  if (!process.stdin.isTTY) {
    process.stderr.write('交互模式需要终端（TTY）。非交互环境用 zkit run <插件> <动作>。\n');
    return 2;
  }
  const entries = listPlugins().filter((e) => e.plugin);
  if (entries.length === 0) {
    process.stdout.write('还没有装插件。zkit plugin bundled 先装示例。\n');
    return 0;
  }
  const stepInteractive = args.includes('--interactive') || args.includes('-i');
  const pick = async (title: string, lines: string[]): Promise<number> => {
    const cliX = await import('./core/cliX.ts');
    return new Promise((resolve) => {
      let sel = 0; let filter = ''; let filtering = false;
      const redraw = (): void => {
        process.stdout.write('\x1b[2J\x1b[H');
        process.stdout.write(c.bold(title) + c.dim('（↑↓ 选 / 回车定 / q 退 / / 过滤）\n'));
        process.stdout.write(cliX.renderMenu(lines, sel, filter, filtering) + '\n');
      };
      const onKey = (buf: Buffer): void => {
        const key = buf.toString('utf8');
        if (!filtering && (key === '\x1b' || key === 'q' || key === '\x03')) {
          process.stdin.removeListener('data', onKey);
          process.stdin.setRawMode(false);
          resolve(-1);
          return;
        }
        const vis = lines.map((_, i) => i).filter((i) => !filtering || !filter || lines[i]!.toLowerCase().includes(filter.toLowerCase()));
        if (filtering) {
          if (key === '\r') { filtering = false; if (vis.length > 0) { sel = vis[0]!; done(); return; } }
          else if (key === '\x7f') filter = filter.slice(0, -1);
          else if (key >= ' ' && key <= '~') filter += key;
          redraw();
          return;
        }
        if (key === '/') { filtering = true; filter = ''; redraw(); return; }
        if (key === '\x1b[A') { const at = vis.indexOf(sel); sel = vis[Math.max(0, at - 1)] ?? vis[0] ?? 0; redraw(); return; }
        if (key === '\x1b[B') { const at = vis.indexOf(sel); sel = vis[Math.min(vis.length - 1, at + 1)] ?? sel; redraw(); return; }
        if (key === '\r' || key === '\n') { if (vis.includes(sel)) { done(); return; } }
      };
      const done = (): void => {
        process.stdin.removeListener('data', onKey);
        process.stdin.setRawMode(false);
        resolve(sel);
      };
      process.stdin.setRawMode(true);
      process.stdin.on('data', onKey);
      redraw();
    });
  };
  const pluginLines = entries.map((e) => `${e.plugin!.name}（${e.plugin!.id}，${e.plugin!.actions.length} 个动作）`);
  const pi = await pick('选插件', pluginLines);
  if (pi < 0) { process.stdout.write('已退出。\n'); return 0; }
  const plugin = entries[pi]!.plugin!;
  const actionLines = plugin.actions.map((a) => `${a.id} · ${a.title} · ${RISK_LABEL[a.risk] ?? a.risk}`);
  const ai = await pick(`选动作 — ${plugin.name}`, actionLines);
  if (ai < 0) { process.stdout.write('已退出。\n'); return 0; }
  const action = plugin.actions[ai]!;
  // 第四十五轮②：--interactive 逐参提示（必填校验/secret 掩码/默认回车）
  const runArgs = ['run', plugin.id, action.id];
  if (stepInteractive && action.params.length > 0) {
    const cliX = await import('./core/cliX.ts');
    const plan = cliX.promptPlan(action.params.map((p) => ({
      name: p.name, title: (p.description ?? p.name).split(/[。；（]/)[0]!.slice(0, 14), required: p.required, secret: p.secret, default: p.default,
    })));
    process.stdout.write(`\n${c.bold(`${plugin.id} ${action.id}`)} 的参数（回车用默认，留空跳过可选项）：\n`);
    for (const q of plan) {
      if (q.isSecret) {
        process.stdout.write(`  ${q.label}: `);
        process.stdin.setRawMode(true);
        const secret = await new Promise<string>((resolve) => {
          let buf = '';
          const onData = (d: Buffer): void => {
            const k = d.toString('utf8');
            if (k === '\r' || k === '\n') { process.stdin.removeListener('data', onData); process.stdin.setRawMode(false); process.stdout.write('\n'); resolve(buf); return; }
            if (k === '\x7f') { buf = buf.slice(0, -1); process.stdout.write('\b \b'); return; }
            if (k === '\x03') { process.stdin.removeListener('data', onData); process.stdin.setRawMode(false); resolve('\x03'); return; }
            if (k >= ' ' && k <= '~') { buf += k; process.stdout.write('*'); }
          };
          process.stdin.on('data', onData);
        });
        if (secret === '\x03') { process.stdout.write('已取消。\n'); return 1; }
        if (secret) runArgs.push(`--${q.name}`, secret);
      } else {
        process.stdout.write(`  ${q.label}: `);
        const line = await new Promise<string>((resolve) => {
          process.stdin.once('data', (d) => resolve(String(d).trim()));
        });
        if (line) runArgs.push(`--${q.name}`, line);
        else if (q.fallback) runArgs.push(`--${q.name}`, q.fallback);
      }
    }
  }
  process.stdout.write(c.dim(`\n执行：zkit ${runArgs.join(' ')}\n\n`));
  return cmdRun(runArgs.slice(1));
}

function cmdPath(): number {
  process.stdout.write(HOME + '\n');
  return 0;
}

function cmdLogs(args: string[]): number {
  const tailIdx = args.indexOf('--tail');
  const tail = tailIdx >= 0 ? Number(args[tailIdx + 1] ?? 30) : 30;
  const follow = args.includes('--follow') || args.includes('-f');
  const file = path.join(LOG_DIR, args[0] === 'denied' ? 'denied.log' : 'audit.log');
  if (!fs.existsSync(file)) {
    process.stdout.write(c.dim(`还没有日志：${file}\n`));
    return 0;
  }
  const printLine = (line: string) => {
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
  };
  const lines = fs.readFileSync(file, 'utf8').trimEnd().split('\n');
  for (const line of lines.slice(-tail)) printLine(line);
  // ③--follow：从文件尾开始盯新增行（轮询 500ms——audit 是低频流，inotify 不值得引）
  if (follow) {
    process.stdout.write(c.dim('-- 跟读中（Ctrl+C 退出）--\n'));
    let offset = fs.statSync(file).size;
    const timer = setInterval(() => {
      try {
        const size = fs.statSync(file).size;
        if (size > offset) {
          const fd = fs.openSync(file, 'r');
          const buf = Buffer.alloc(size - offset);
          fs.readSync(fd, buf, 0, buf.length, offset);
          fs.closeSync(fd);
          for (const line of buf.toString('utf8').split('\n')) if (line.trim()) printLine(line);
          offset = size;
        } else if (size < offset) {
          offset = 0; // 被截断（gc/轮转）——从头重读
        }
      } catch { /* 文件被删：等它重建 */ }
    }, 500);
    // Ctrl+C 时正常退出（清 timer 防止句柄挂着）
    process.on('SIGINT', () => { clearInterval(timer); process.exit(0); });
    return new Promise<number>(() => 0) as unknown as number; // eslint 不在——直接挂住
  }
  return 0;
}

/** ①②zkit stats：动作级耗时统计（来自审计日志，不另设记录器）。 */
function cmdStats(args: string[]): number {
    let all = readAudit();
  // 第四十六轮⑧：--since 7d/1h 时间窗过滤（与 audit 同一套 parseSince）
  const sinceIdx = args.indexOf('--since');
  if (sinceIdx >= 0) {
    const span = auditNs.parseSince(String(args[sinceIdx + 1] ?? ''));
    if (span === null) {
      process.stderr.write(c.red(`✗ --since 格式：1h / 30m / 3d / 2w（收到 "${args[sinceIdx + 1]}"）\n`));
      return 2;
    }
    const cutoff = Date.now() - span;
    all = all.filter((r) => Date.parse(r.ts ?? '') >= cutoff);
  }
  const stats = actionStats(all);
  if (stats.length === 0) {
    process.stdout.write(c.dim('还没有执行记录（跑几个动作再来看）。\n'));
    return 0;
  }
  if (args.includes('--json')) {
    process.stdout.write(JSON.stringify({ actions: stats }, null, 2) + '\n');
    return 0;
  }
  process.stdout.write(`动作耗时统计（${stats.length} 个动作，来自审计日志）：\n`);
  process.stdout.write(`${pad('动作', 34)}${pad('次数', 6)}${pad('失败', 6)}${pad('P50', 10)}${pad('P95', 10)}${pad('最慢', 10)}最近\n`);
  for (const s of stats) {
    const fmt = (v: number | undefined) => (v == null ? '—' : v >= 1000 ? (v / 1000).toFixed(1) + 's' : Math.round(v) + 'ms');
    const warn = (s.p95Ms ?? 0) >= SLOW_MS ? c.yellow('⚠') : ' ';
    process.stdout.write(
      `${warn}${pad(s.key, 33)}${pad(String(s.count), 6)}${pad(s.failCount ? c.red(String(s.failCount)) : '0', s.failCount ? 12 : 6)}`
      + `${pad(fmt(s.p50Ms), 10)}${pad(fmt(s.p95Ms), 10)}${pad(fmt(s.maxMs), 10)}${c.dim(s.lastTs?.slice(5, 16) ?? '')}\n`,
    );
  }
  return 0;
}

/** ④zkit health：一条命令给出「服务活着吗/插件健康吗/最近有错吗」。退出码给脚本用。 */
function cmdHealth(): number {
    const plugins = listPlugins();
  const { records } = readAuditDetailed();
  const errs = recentErrors(records, 5);
  let problems = 0;
  process.stdout.write(`zerokit 健康概况：\n`);
  // server 探测：ui.port 是启动器落盘的端口记录（没有=没起过）
  let portLine = c.dim('未运行（zkit ui 启动）');
  try {
    const port = Number(fs.readFileSync(path.join(HOME, 'ui.port'), 'utf8').trim());
    if (Number.isFinite(port) && port > 0) portLine = `曾在端口 ${port} 运行（/api/health 探活）`;
  } catch { /* 没有 ui.port：未运行 */ }
  const broken = plugins.filter((p) => p.plugin === undefined && p.errors && p.errors.length > 0);
  process.stdout.write(`  插件：${plugins.length} 个装在案${broken.length ? c.red(`，${broken.length} 个加载失败`) : c.green('，全部可加载')}\n`);
  if (broken.length) problems += broken.length;
  process.stdout.write(`  审计记录：${records.length} 条，最近错误 ${errs.length} 条${errs.length ? '' : c.green('（干净）')}\n`);
  for (const e of errs.slice(0, 3)) {
    process.stdout.write(c.red(`    ✗ ${e.ts?.slice(5, 16)} ${e.plugin}.${e.action} ${e.error ?? e.reason ?? ''}\n`));
  }
  process.stdout.write(`  ${portLine}\n`);
  return problems > 0 ? 1 : 0;
}

/** ⑤zkit audit --last N：最近 N 条审计记录表格式输出。 */
async function cmdAudit(args: string[]): Promise<number> {
  // ③拒绝记录视图
  if (args.includes('--denied')) {
    const { records: denied, badLines } = auditNs.readDenied();
    if (denied.length === 0 && badLines === 0) {
      process.stdout.write(c.dim('还没有被拒记录（干干净净）。\n'));
      return 0;
    }
    if (args.includes('--json')) {
      process.stdout.write(JSON.stringify({ records: denied, badLines }, null, 2) + '\n');
      return 0;
    }
    process.stdout.write(`被拒记录（最近 ${Math.min(denied.length, 50)} 条）：
`);
    for (const d of denied.slice(-50)) {
      process.stdout.write(`${c.red('✗')} ${c.dim(d.ts.slice(0, 19))} ${pad(d.key, 36)}${c.yellow(d.reason.slice(0, 60))}
`);
    }
    return 0;
  }
  // ⑥时间过滤（--since 1h/3d/1w）
  let all = readAudit();
  const sinceIdx = args.indexOf('--since');
  if (sinceIdx >= 0) {
    const span = auditNs.parseSince(String(args[sinceIdx + 1] ?? ''));
    if (span === null) {
      process.stderr.write(c.red(`✗ --since 格式：1h / 30m / 3d / 2w / 45s（收到 "${args[sinceIdx + 1]}"）
`));
      return 2;
    }
    const cutoff = Date.now() - span;
    all = all.filter((r) => Date.parse(r.ts ?? '') >= cutoff);
  }
  const lastIdx = args.indexOf('--last');
  const n = lastIdx >= 0 ? Number(args[lastIdx + 1] ?? 20) : 20;
  const records = all.slice(-n);
  if (records.length === 0) {
    process.stdout.write(c.dim('还没有审计记录。\n'));
    return 0;
  }
  if (args.includes('--json')) {
    process.stdout.write(JSON.stringify({ records }, null, 2) + '\n');
    return 0;
  }
  process.stdout.write(`最近 ${records.length} 条审计记录：\n`);
  for (const r of records) {
    const mark = r.decision === 'allow' ? c.green('✓') : c.red('✗');
    const slow = (r as { slow?: boolean }).slow ? c.yellow(' ⏱slow') : '';
    const ms = typeof r.ms === 'number' ? ` ${r.ms}ms` : '';
    process.stdout.write(
      `${mark} ${c.dim(r.ts?.slice(0, 19) ?? '')} ${pad(r.caller ?? '', 8)}${pad(`${r.plugin}.${r.action}`, 36)}`
      + `${ms}${slow}${r.error ? ' ' + c.red(String(r.error).slice(0, 60)) : ''}\n`,
    );
  }
  // 第四十六轮⑦：--follow 跟读——新审计行实时打印，Ctrl-C 退出。
  // 实现取巧：不做 inotify/fs.watch，固定 2s 轮询文件尾行数增长（审计是纯追加 JSONL，
  // 轮询对这种低频日志完全够用，还天然跨平台）。
  if (args.includes('--follow')) {
    const file = path.join(HOME, 'logs', 'audit.log');
    let seen = readAudit().length;
    process.stderr.write(c.dim('（跟读中，Ctrl-C 退出）\n'));
    for (;;) {
      await new Promise((r) => setTimeout(r, 2000));
      const now = readAudit();
      if (now.length > seen) {
        for (const r of now.slice(seen)) {
          const mark = r.decision === 'allow' ? '✓' : '✗';
          process.stdout.write(`${mark} ${r.ts?.slice(11, 19) ?? ''} ${r.caller ?? ''} ${r.plugin}.${r.action}${r.error ? ' ' + String(r.error).slice(0, 60) : ''}\n`);
        }
        seen = now.length;
      }
    }
  }
  return 0;
}

/** 第四十一轮②④⑧：CLI 高危动作显式授权（与 approvals.json 的「确认过就记住」分层：
 * approvals 是交互确认的记忆；allow 是主动授予的权限，带 TTL，可撤回。 */
function cmdAllow(args: string[]): number {
  const sub = args[0];
  const entries = auditNs.loadAllow();
  const pruned = auditNs.pruneAllow(entries);
  if (pruned.expired.length > 0) {
    process.stdout.write(c.yellow(`有 ${pruned.expired.length} 条授权已过期并自动移除：${pruned.expired.map((e) => e.key).join('、')}\n`));
    auditNs.saveAllow(pruned.alive);
  }
  const list = pruned.alive;
  if (sub === 'list' || sub === undefined) {
    if (list.length === 0) {
      process.stdout.write(c.dim('还没有任何显式授权。加：zkit allow add <插件.动作> [ttl天数]\n'));
      return 0;
    }
    for (const e of list) {
      const ttl = e.ttlDays === -1 ? '永久' : `${e.ttlDays} 天`;
      const until = e.ttlDays === -1 ? '' : `（至 ${new Date(Date.parse(e.at) + e.ttlDays * 86400000).toISOString().slice(0, 10)}）`;
      process.stdout.write(`✓ ${pad(e.key, 36)}${ttl}${until} ${c.dim('授于 ' + e.at.slice(0, 10))}\n`);
    }
    return 0;
  }
  if (sub === 'add') {
    const key = args[1];
    if (!key || !key.includes('.')) {
      process.stderr.write(c.red('用法：zkit allow add <插件.动作> [ttl天数（默认 30，-1 永久）]\n'));
      return 2;
    }
    const ttl = args[2] !== undefined ? Number(args[2]) : auditNs.DEFAULT_TTL_DAYS;
    if (!Number.isFinite(ttl) || ttl < -1) {
      process.stderr.write(c.red(`✗ ttl 必须是不小于 -1 的数字（收到 "${args[2]}"）\n`));
      return 2;
    }
    auditNs.saveAllow(auditNs.upsertAllow(list, key, ttl));
    process.stdout.write(c.green(`✓ 已授权 ${key}（${ttl === -1 ? '永久' : ttl + ' 天'}）\n`));
    return 0;
  }
  if (sub === 'remove') {
    const key = args[1];
    if (!key) { process.stderr.write(c.red('用法：zkit allow remove <插件.动作 | 插件id>\n')); return 2; }
    // ⑧插件级撤回：连带提示受影响动作数
    const affected = auditNs.affectedByRemove(list, key);
    if (affected.length === 0) {
      process.stderr.write(c.red(`✗ 没有匹配 "${key}" 的授权\n`));
      return 1;
    }
    auditNs.saveAllow(list.filter((e) => !affected.includes(e)));
    process.stdout.write(c.green(`✓ 已撤回 ${affected.length} 条：${affected.map((e) => e.key).join('、')}\n`));
    return 0;
  }
  process.stderr.write('用法：zkit allow <list|add|remove>\n');
  return 2;
}

/** ⑧zkit gc：清 30 天前的审计数据（默认 dry-run，--apply 执行）。 */
function cmdGc(args: string[]): number {
    const daysIdx = args.indexOf('--days');
  const days = daysIdx >= 0 ? Number(args[daysIdx + 1] ?? 30) : 30;
  const apply = args.includes('--apply');
  const { removed, kept } = gcAudit(days, !apply);
  if (apply) {
    process.stdout.write(`已清理 ${removed} 条早于 ${days} 天的记录，保留 ${kept} 条。\n`);
  } else {
    process.stdout.write(`预览：将清理 ${removed} 条早于 ${days} 天的记录，保留 ${kept} 条。加 --apply 执行。\n`);
  }
  return 0;
}


/**
 * 从集市安装。
 *
 * 关键在「先审查再落地」：第三方插件的清单是不可信输入，描述里可以藏指令
 * （tool poisoning），装完还能偷改（rug pull）。所以这里把要装的东西
 * 完整摊开——每个动作的真实命令、风险等级、依赖、警告——再让人决定。
 */
async function cmdPluginInstall(args: string[]): Promise<number> {
  const id = args.find((a) => !a.startsWith('-'));
  if (!id) {
    process.stderr.write('用法：zkit plugin install <插件id> [--market <集市名>] [--yes] [--with-deps]\n');
    process.stderr.write(c.dim('  先看看有什么：zkit market search\n'));
    return 2;
  }
  const marketIdx = args.indexOf('--market');
  const marketName = marketIdx >= 0 ? args[marketIdx + 1] : undefined;
  const skipConfirm = args.includes('--yes') || args.includes('-y');
  const withDeps = args.includes('--with-deps');

  // 第八十七轮⑧：安装前环检测——若新插件的依赖会被已装插件反向依赖（罕见但致命），先说清
  {
    const users = dependents(id);
    if (users.length > 0) {
      for (const u of users) {
        const up = findPlugin(u)?.plugin;
        if (up?.pluginDeps.includes(id)) {
          process.stdout.write(c.yellow(`! 注意：${u} 已声明依赖 ${id}，装完它们会互相/交叉依赖——用 zkit doctor 检查是否成环\n`));
        }
      }
    }
  }

  const preview = previewInstall(id, marketName);
  if (!preview) {
    // 集市里没有不代表没有：仓库自带的示例插件同样可以按 id 装（依赖补齐也走这条路）
    const bundled = installBundledPlugin(id);
    if (bundled.ok) {
      process.stdout.write(c.green(`✓ ${bundled.message}\n`));
      return id ? finishDeps(id, withDeps) : 0;
    }
    process.stderr.write(c.red(`✗ 集市和自带示例里都没有插件 "${id}"\n`));
    process.stderr.write(c.dim('  用 zkit market search 看看有什么，或 zkit market add 添加集市\n'));
    return 1;
  }
  if (!preview.load.plugin || !preview.dir) {
    process.stderr.write(c.red('✗ 这个插件的清单没通过校验：\n'));
    for (const e of preview.load.errors) process.stderr.write(c.red(`    ${e}\n`));
    return 1;
  }

  const p = preview.load.plugin;
  process.stdout.write(`\n${c.bold('将要安装')} ${c.bold(p.name)}  ${c.dim(p.id)} v${p.version}\n`);
  process.stdout.write(c.dim(`来自集市「${preview.market}」\n`));
  if (p.summary) process.stdout.write(`${p.summary}\n`);
  if (p.author) process.stdout.write(c.dim(`作者 ${p.author}\n`));

  process.stdout.write(`\n${c.bold('它会获得这些能力')}（共 ${p.actions.length} 个动作）\n`);
  for (const a of p.actions) {
    const risk = RISK_LABEL[a.risk] ?? a.risk;
    process.stdout.write(`  ${c.cyan(a.id.padEnd(16))} ${pad(a.title, 20)} ${risk}\n`);
    const detail = a.type === 'http'
      ? `${a.method} ${a.url}`
      : a.run.join(' ');
    process.stdout.write(c.dim(`      ${detail}\n`));
  }

  const deps = depStates(p);
  if (deps.length > 0) {
    process.stdout.write('\n插件依赖：');
    process.stdout.write(deps.map((d) => (d.installed
      ? c.green(`${d.id} ✓`)
      : c.red(`${d.id} ✗`))).join('  ') + '\n');
    if (!withDeps && deps.some((d) => !d.installed)) {
      process.stdout.write(c.dim('  缺的会一并安装吗？这次不会（加 --with-deps，或在界面里勾选）\n'));
    }
  }

  const reqs = checkRequires(p.requires);
  if (reqs.length > 0) {
    process.stdout.write('\n依赖：');
    process.stdout.write(reqs.map((r) => (r.ok ? c.green(`${r.name} ✓`) : c.red(`${r.name} ✗`))).join('  ') + '\n');
    for (const r of reqs.filter((x) => !x.ok)) {
      process.stdout.write(c.yellow(`  ${r.hint}\n`));
    }
  }
  for (const w of preview.load.warnings) process.stdout.write(c.yellow(`! ${w}\n`));

  if (!skipConfirm) {
    if (!process.stdin.isTTY) {
      process.stderr.write(c.red('\n✗ 安装插件有风险，当前不是交互环境，无法确认。\n'));
      process.stderr.write(c.dim('  确认要装就加 --yes\n'));
      return 1;
    }
    process.stderr.write(`\n${c.yellow('确认安装上面这个插件？动作会在你的机器上执行真实命令。')} (y/N) `);
    const answer = await readLine();
    if (!/^y(es)?$/i.test(answer.trim())) {
      process.stdout.write('已取消。\n');
      return 1;
    }
  }

  const result = installFromMarket(id, marketName);
  process.stdout.write(result.ok
    ? c.green(`✓ ${result.message}\n`)
    : c.red(`✗ ${result.message}\n`));
  if (!result.ok) return 1;
  const depCode = result.id ? finishDeps(result.id, withDeps) : 0;
  if (result.id) process.stdout.write(c.dim(`  看看它有什么：zkit show ${result.id}\n`));
  return depCode;
}

function cmdMarket(args: string[]): number {
  const sub = (args[0] ?? 'list').toLowerCase();

  if (sub === 'list' || sub === 'ls') {
    const markets = loadMarkets();
    if (markets.length === 0) {
      process.stdout.write('还没有添加任何集市。\n');
      process.stdout.write(c.dim('  zkit market add <git地址|owner/repo|本地目录>\n'));
      process.stdout.write(c.dim('  zkit market add D:\\software\\zerokit      ← 把本仓库当集市\n'));
      return 0;
    }
    for (const m of markets) {
      const index = readIndex(m.name);
      // 第八十一轮⑤：来源类型标签——一眼看出这个集市是本地目录还是远端仓库
      const kindTag = m.kind === 'path' ? c.cyan('[本地]') : m.kind === 'git' ? c.bold('[git]') : c.dim('[?]');
      process.stdout.write(`${kindTag} ${c.bold(m.name)}  ${c.dim(`${index?.plugins.length ?? '?'} 个插件`)}\n`);
      if (index?.description) process.stdout.write(`  ${index.description}\n`);
      process.stdout.write(c.dim(`  ${m.url}\n`));
    }
    return 0;
  }

  if (sub === 'add') {
    const source = args[1];
    if (!source) {
      process.stderr.write('用法：zkit market add <git地址|owner/repo|本地目录>\n');
      return 2;
    }
    const r = addMarket(source);
    process.stdout.write(r.ok ? c.green(`✓ ${r.message}\n`) : c.red(`✗ ${r.message}\n`));
    if (r.ok) process.stdout.write(c.dim('  用 zkit market search 看看有什么\n'));
    return r.ok ? 0 : 1;
  }

  if (sub === 'remove' || sub === 'rm') {
    const name = args[1];
    if (!name) {
      process.stderr.write('用法：zkit market remove <集市名>\n');
      return 2;
    }
    const ok = removeMarket(name);
    process.stdout.write(ok ? c.green(`✓ 已移除集市 ${name}\n`) : c.red(`✗ 没有这个集市：${name}\n`));
    return ok ? 0 : 1;
  }

  if (sub === 'refresh') {
    const target = args[1];
    const names = target ? [target] : loadMarkets().map((m) => m.name);
    if (names.length === 0) {
      process.stdout.write('还没有添加任何集市。\n');
      return 0;
    }
    let bad = 0;
    for (const name of names) {
      const r = refreshMarket(name);
      process.stdout.write(r.ok ? c.green(`✓ ${r.message}\n`) : c.red(`✗ ${r.message}\n`));
      if (!r.ok) bad++;
    }
    return bad ? 1 : 0;
  }

  if (sub === 'search' || sub === 'find') {
    const q = args.slice(1).join(' ');
    const hits = searchMarkets(q);
    if (hits.length === 0) {
      process.stdout.write(loadMarkets().length === 0
        ? '还没有添加任何集市。zkit market add <地址>\n'
        : `没有匹配 "${q}" 的插件。\n`);
      return 0;
    }
    for (const hit of hits) {
      const e = hit.entry;
      process.stdout.write(`${c.bold(e.name ?? e.id)} ${c.dim(e.id)}`
        + (e.version ? c.dim(` v${e.version}`) : '') + '\n');
      if (e.summary) process.stdout.write(`  ${e.summary}\n`);
      const tags = (e.tags ?? []).join(' ');
      process.stdout.write(c.dim(`  集市 ${hit.market}${tags ? ' · ' + tags : ''}\n`));
    }
    process.stdout.write(c.dim('\n安装：zkit plugin install <插件id>\n'));
    return 0;
  }

  if (sub === 'index') {
    const dir = args[1] ?? process.cwd();
    const index = buildIndex(dir, args[2], args[3]);
    const outPath = path.join(path.resolve(dir), 'market.json');
    fs.writeFileSync(outPath, JSON.stringify(index, null, 2) + '\n');
    process.stdout.write(c.green(`✓ 已生成 ${outPath}，收录 ${index.plugins.length} 个插件\n`));
    process.stdout.write(c.dim('  把这个文件提交到仓库根目录，别人就能 zkit market add 你的仓库了\n'));
    return 0;
  }

  // ⑤zkit market lint：校验一份 market.json（默认仓库根目录的；--file 指定）
  if (sub === 'lint') {
    const fIdx = args.indexOf('--file');
    const file = (fIdx >= 0 ? args[fIdx + 1] : undefined) ?? path.join(PKG_ROOT_CWD, 'market.json');
    if (!fs.existsSync(file)) {
      process.stderr.write(c.red(`✗ 找不到 ${file}（--file 指定别的路径）\n`));
      return 1;
    }
    const { lintMarketIndex } = marketDistro();
    const f2: string = file;
    const r = lintMarketIndex(fs.readFileSync(f2, 'utf8'), { baseDir: path.dirname(path.resolve(f2)) });
    process.stdout.write(`${file}：${r.pluginCount} 个插件\n`);
    for (const e of r.errors) process.stdout.write(c.red(`  ✗ ${e}\n`));
    for (const w of r.warnings) process.stdout.write(c.yellow(`  ! ${w}\n`));
    if (r.ok && r.warnings.length === 0) process.stdout.write(c.green('  ✓ 登记表干净\n'));
    else if (r.ok) process.stdout.write(c.yellow(`  ✓ 可用（${r.warnings.length} 条建议）\n`));
    return r.ok ? 0 : 1;
  }
  process.stderr.write('用法：zkit market <list|add|remove|refresh|search|index|lint>\n');
  return 2;
}

const PKG_ROOT_CWD = process.cwd();
function marketDistro() {
  return distroNs;
}

function humanDuration(ms: number): string {
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s} 秒`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m} 分 ${s % 60} 秒`;
  const h = Math.floor(m / 60);
  return `${h} 小时 ${m % 60} 分`;
}

/**
 * 「运行中」：把两类东西一起列出来
 *   1. 内核托管的进程（background 动作拉起的）
 *   2. 插件声明的常驻服务（按端口/PID 检测，可能是别的程序甚至手动起的）
 * 这是启动器和「一堆快捷方式」的分界线。
 */

/** 第六十三轮②③④⑤：zkit timers list|pause|resume|remove|run。 */
/** 第七十九轮⑦⑧：zkit data export --watch / data import —— 监控历史随备份走。
 * 格式与第二十轮 collectBackup 信封兼容（app/version/exportedAt/keys），
 * watch 配置作为单独分区塞进 meta——导入时可选 --no-watch 跳过。 */
async function cmdData(args: string[]): Promise<number> {
  const sub = args[0];
  const rest = args.slice(1);
  const watchPath = path.join(HOME_PATH(), 'watch.json');
  if (sub === 'export') {
    const watches = fs.existsSync(watchPath) ? JSON.parse(fs.readFileSync(watchPath, 'utf8')) : { watches: [], stops: [] };
    const out = {
      app: 'zerokit', version: '0.84.0', exportedAt: new Date().toISOString(),
      keys: {},
      meta: { keyCount: 0, bytes: 0, watch: { watches: watches.watches ?? [], stops: watches.stops ?? [] } },
    };
    const text = JSON.stringify(out, null, 2);
    const outFile = rest.find((a) => !a.startsWith('-'));
    if (outFile) {
      fs.writeFileSync(outFile, text);
      process.stdout.write(c.green(`✓ 已导出 ${(watches.watches ?? []).length} 个监控配置与 ${(watches.stops ?? []).length} 条停止记录 → ${outFile}（${text.length} 字节）\n`));
    } else {
      process.stdout.write(text + '\n');
    }
    return 0;
  }
  if (sub === 'import') {
    const file = rest.find((a) => !a.startsWith('-'));
    if (!file || !fs.existsSync(file)) {
      process.stderr.write('用法：zkit data import <备份文件> [--no-watch 跳过监控配置]\n');
      return 2;
    }
    let parsed: { meta?: { watch?: { watches?: unknown[]; stops?: unknown[] } } };
    try {
      parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
    } catch {
      process.stderr.write(c.red('✗ 不是合法 JSON\n'));
      return 1;
    }
    const w = parsed.meta?.watch;
    if (!w || !Array.isArray(w.watches)) {
      process.stdout.write('（备份里没有监控配置）\n');
      return 0;
    }
    if (rest.includes('--no-watch')) {
      process.stdout.write(`已跳过 ${w.watches.length} 个监控配置（--no-watch）\n`);
      return 0;
    }
    fs.mkdirSync(HOME_PATH(), { recursive: true });
    fs.writeFileSync(watchPath, JSON.stringify({ version: 1, watches: w.watches, stops: w.stops ?? [] }, null, 2));
    process.stdout.write(c.green(`✓ 已恢复 ${w.watches.length} 个监控配置（页面下次打开时生效）\n`));
    return 0;
  }
  // ---- 第八十二轮：配置迁移（snapshot/restore/list/diff/path）----
  if (sub === 'path') {
    process.stdout.write(HOME_PATH() + '\n');
    return 0;
  }
  if (sub === 'snapshot') {
    // ①打包：默认脱敏（secret 换占位符）；--with-secrets 显式携带
    const withSecrets = rest.includes('--with-secrets');
    const outDir = rest.find((a) => !a.startsWith('-')) ?? process.cwd();
    if (!fs.existsSync(outDir)) { process.stderr.write(c.red(`✗ 目录不存在：${outDir}\n`)); return 2; }
    const r = makeSnapshot(outDir, { withSecrets });
    if (!r.ok || !r.file || !r.meta) { process.stderr.write(c.red(`✗ ${r.error ?? '打包失败'}\n`)); return 1; }
    process.stdout.write(c.green(`✓ 快照已生成 → ${r.file}\n`));
    process.stdout.write(`  来自本机（${r.meta.host}）；${r.meta.secretsRemoved > 0 ? c.yellow(`${r.meta.secretsRemoved} 个 secret 已脱敏，恢复后要重填（--with-secrets 可携带明文）`) : '无 secret 需要脱敏'}\n`);
    return 0;
  }
  if (sub === 'list') {
    // ③预览：不落盘
    const file = rest.find((a) => !a.startsWith('-'));
    if (!file || !fs.existsSync(file)) { process.stderr.write('用法：zkit data list <快照文件>\n'); return 2; }
    const pr = parseSnapshot(fs.readFileSync(file));
    if (!pr.ok) { process.stderr.write(c.red(`✗ ${pr.error}\n`)); return 1; }
    const { meta, files } = pr.snap;
    const settings = files.filter((f) => f.rel.startsWith('settings/'));
    process.stdout.write(c.bold(`快照预览（来自 ${meta.host}，${meta.createdAt.slice(0, 19).replace('T', ' ')}）\n`));
    process.stdout.write(`  设置文件 ${settings.length} 个 · 定时器 ${files.some((f) => f.rel === 'timers.json') ? '有' : '无'} · 监控 ${files.some((f) => f.rel === 'watch.json') ? '有' : '无'} · 授权表 ${files.some((f) => f.rel === 'allow.json') ? '有' : '无'}\n`);
    for (const f of settings) process.stdout.write(`  · ${f.rel.replace('settings/', '')}\n`);
    if (meta.secretsRemoved > 0) process.stdout.write(c.yellow(`  ⚠ ${meta.secretsRemoved} 个 secret 以占位符导出，恢复后需重填\n`));
    return 0;
  }
  if (sub === 'restore') {
    // ②恢复：默认跳过已存在，--overwrite 覆盖
    const file = rest.find((a) => !a.startsWith('-'));
    if (!file || !fs.existsSync(file)) { process.stderr.write('用法：zkit data restore <快照文件> [--overwrite]\n'); return 2; }
    const pr = parseSnapshot(fs.readFileSync(file));
    if (!pr.ok) { process.stderr.write(c.red(`✗ ${pr.error}\n`)); return 1; }
    process.stdout.write(`来自 ${pr.snap.meta.host} 的快照（${pr.snap.files.length} 个文件）\n`);
    const rr = restoreSnapshot(pr.snap, { overwrite: rest.includes('--overwrite') });
    for (const rel of rr.applied) process.stdout.write(c.green(`  ✓ ${rel}\n`));
    for (const rel of rr.skipped) process.stdout.write(c.yellow(`  跳过 ${rel}（已存在，--overwrite 覆盖）\n`));
    if (rr.secretsToRefill > 0) process.stdout.write(c.yellow(`⚠ ${rr.secretsToRefill} 个 secret 是占位符——恢复后用 zkit config 重填\n`));
    process.stdout.write(c.green(`✓ 应用 ${rr.applied.length} 个 · 跳过 ${rr.skipped.length} 个\n`));
    return 0;
  }
  if (sub === 'diff') {
    // ⑥对比
    const file = rest.find((a) => !a.startsWith('-'));
    if (!file || !fs.existsSync(file)) { process.stderr.write('用法：zkit data diff <快照文件>\n'); return 2; }
    const pr = parseSnapshot(fs.readFileSync(file));
    if (!pr.ok) { process.stderr.write(c.red(`✗ ${pr.error}\n`)); return 1; }
    const entries = diffSnapshot(pr.snap);
    if (entries.length === 0) { process.stdout.write(c.green('快照与当前数据一致\n')); return 0; }
    for (const e of entries) {
      const tag = e.kind === 'only-in-snapshot' ? c.yellow('快照有·本机无') : e.kind === 'only-in-here' ? c.cyan('本机有·快照无') : c.red('内容不同');
      process.stdout.write(`  ${tag}  ${e.rel}\n`);
    }
    process.stdout.write(c.dim(`共 ${entries.length} 处差异\n`));
    return 0;
  }
  process.stderr.write('用法：zkit data <snapshot [目录] [--with-secrets] | restore <file> [--overwrite] | list <file> | diff <file> | path | export | import>\n');
  return 2;
}

function HOME_PATH(): string {
  return process.env.ZEROKIT_HOME ?? path.join(process.env.HOME ?? '.', '.zerokit');
}

async function cmdTimers(args: string[]): Promise<number> {
  const sub = args[0] ?? 'list';
  const rest = args.slice(1);
  if (sub === 'list') {
    const { timers } = loadTimers();
    // 第七十八轮⑥：--json 机读（AI 客户端/脚本消费；含 nextFire 与 missed）
    if (rest.includes('--json')) {
      const out = timers.map((t) => {
        const next = nextFireTime(t);
        return {
          key: t.key, title: t.title, interval: t.interval, win: t.win ?? '',
          paused: t.paused === true, days: t.days ?? 'daily',
          nextFireAt: next, nextFireHuman: next === null ? null : humanNextFire(next),
          missed: missedRun(t),
          lastRanAt: t.lastRanAt ?? null, lastOk: t.lastOk ?? null,
        };
      });
      process.stdout.write(JSON.stringify(out, null, 2) + '\n');
      return 0;
    }
    if (!timers.length) { process.stdout.write('（没有定时任务——启动器里 ⏲ 或详情页可创建）\n'); return 0; }
    process.stdout.write(`${timers.length} 个定时任务：\n`);
    for (const t of timers) {
      const next = nextFireTime(t);
      // 第七十八轮⑧：下次触发说人话（今天 09:00 / 明天 09:00 / 周三 09:00）
      const nextStr = next === null ? '已暂停' : `下次 ${humanNextFire(next)}`;
      const daysStr = !t.days ? '' : t.days === 'workdays' ? ' · 工作日' : ` · 每周${(t.days as number[]).map((d) => '日一二三四五六'[d]).join('/')}`;
      process.stdout.write(`  ${t.paused ? '⏸' : '⏱'} ${t.key}\n`);
      process.stdout.write(c.dim(`      ${t.title} · 每 ${t.interval}s${t.win ? ` · 窗口 ${t.win}` : ''}${daysStr} · ${nextStr}\n`));
      const missed = missedRun(t);
      if (missed) process.stdout.write(c.yellow(`      ⚠ 错过：${missed}。补跑：zkit timers catchup ${t.key}\n`));
    }
    return 0;
  }
  // 第七十八轮②：一次性补跑（幂等——补完记当天，同一天再调不重复执行）
  if (sub === 'catchup') {
    const k = rest.find((a) => !a.startsWith('-'));
    if (!k) { process.stderr.write('用法：zkit timers catchup <插件id.动作id>\n'); return 2; }
    const file = loadTimers();
    const t = file.timers.find((x) => x.key === k);
    if (!t) { process.stderr.write(c.red(`✗ 没有任务 ${k}\n`)); return 1; }
    const missed = missedRun(t);
    if (!missed) { process.stdout.write(`${k} 没有需要补跑的（策略 skip / 已暂停 / 今天已补过 / 没错过）\n`); return 0; }
    process.stdout.write(c.yellow(`补跑 ${k}：${missed}\n`));
    const [plugId, ...actRest] = k.split('.');
    const values = t.values ?? {};
    const code = await cmdRun([plugId ?? '', actRest.join('.') || '', ...Object.entries(values).flatMap(([kk, v]) => ['--' + kk, String(v)])]);
    markCatchupDone(t);
    t.lastRanAt = Date.now();
    saveTimers(file);
    return code;
  }
  const key = rest.find((a) => !a.startsWith('-'));
  if (!key) {
    process.stderr.write('用法：zkit timers <list|pause|resume|remove|run|catchup> <插件id.动作id>\n');
    return 2;
  }
  if (sub === 'pause' || sub === 'resume') {
    const st = setTimerPaused(key, sub === 'pause');
    if (st === null) { process.stderr.write(c.red(`✗ 没有任务 ${key}\n`)); return 1; }
    process.stdout.write(c.green(`✓ ${key} ${st ? '已暂停' : '已恢复'}\n`));
    return 0;
  }
  if (sub === 'remove') {
    if (!removeTimer(key)) { process.stderr.write(c.red(`✗ 没有任务 ${key}\n`)); return 1; }
    process.stdout.write(c.green(`✓ 已删除 ${key}\n`));
    return 0;
  }
  if (sub === 'run') {
    // 立即执行一次：走 runner（产出进审计日志），不动持久化节奏
    const { timers } = loadTimers();
    const t = timers.find((x) => x.key === key);
    if (!t) { process.stderr.write(c.red(`✗ 没有任务 ${key}\n`)); return 1; }
    const [plugId, ...actRest] = key.split('.');
    const actionId = actRest.join('.') || '';
    const values = (t as { values?: Record<string, string> }).values ?? {};
    void upsertTimer; // run 不改配置
    return await cmdRun([plugId ?? '', actionId, ...Object.entries(values).flatMap(([k, v]) => ['--' + k, String(v)])]);
  }
  process.stderr.write(`不认识的子命令 "${sub}"（list / pause / resume / remove / run / catchup）\n`);
  return 2;
}

function cmdPs(): number {
  const procs = listProcesses();
  const services = listServices();
  const runningServices = services.filter((s) => s.running);
  const total = procs.length + runningServices.length;

  if (total === 0) {
    process.stdout.write('当前没有运行中的东西。\n');
    if (services.length > 0) {
      process.stdout.write(c.dim(`（有 ${services.length} 个声明过的服务，现在都是停着的）\n`));
    }
    return 0;
  }

  process.stdout.write(`${c.bold(`运行中（${total}）`)}\n`);

  if (procs.length > 0) {
    process.stdout.write(`\n${c.bold('托管的进程')}\n`);
    for (const p of procs) {
      const mark = p.running ? c.green('●') : c.dim('○');
      // 别的会话登记、又在那边退出的进程，这里拿不到退出码（没人会通知我们），
      // 所以只在真知道的时候才显示码——不编一个 0 出来把崩溃显示成正常退出。
      const state = p.running
        ? c.dim(`跑了 ${humanDuration(Date.now() - p.startedAt)}`)
        : c.red(p.exitCode === undefined ? '已退出' : `已退出（码 ${p.exitCode}）`);
      process.stdout.write(`  ${mark} ${c.cyan(p.id.padEnd(5))} ${pad(p.title, 26)} ${c.dim(`PID ${p.pid}`)}  ${state}\n`);
      process.stdout.write(c.dim(`      ${p.command}\n`));
      if (!p.running && p.tail.length > 0) {
        for (const line of p.tail) process.stdout.write(c.dim(`      | ${line.slice(0, 120)}\n`));
      }
    }
  }

  if (runningServices.length > 0) {
    process.stdout.write(`\n${c.bold('插件声明的服务')}\n`);
    for (const s of runningServices) {
      const where = s.port ? `端口 ${s.port}` : 'pid 文件';
      process.stdout.write(
        `  ${c.green('●')} ${c.cyan(`${s.pluginId}.${s.id}`.padEnd(22))} ${pad(s.title, 20)}`
        + ` ${c.dim(`${where}`)} ${c.dim(`PID ${s.pid ?? '?'}`)}\n`,
      );
    }
  }

  process.stdout.write(c.dim('\n结束：zkit kill <上面那个 id 或 插件.服务>\n'));
  process.stdout.write(c.dim('全部结束：zkit kill all\n'));
  return 0;
}

async function cmdKill(args: string[]): Promise<number> {
  const target = args[0];
  if (!target) {
    process.stderr.write('用法：zkit kill <进程id|插件.服务|all>\n');
    process.stderr.write(c.dim('  先看看有什么：zkit ps\n'));
    return 2;
  }

  if (target === 'all') {
    let ok = 0;
    for (const s of listServices().filter((x) => x.running)) {
      const r = await stopService(s.pluginId, s.id);
      process.stdout.write(r.ok ? c.green(`✓ ${r.message}\n`) : c.red(`✗ ${s.pluginId}.${s.id}：${r.message}\n`));
      if (r.ok) ok++;
    }
    const { killed, failed } = killAllProcesses();
    if (killed > 0) process.stdout.write(c.green(`✓ 已结束 ${killed} 个托管进程\n`));
    if (failed > 0) process.stderr.write(c.red(`✗ ${failed} 个没能结束\n`));
    if (ok === 0 && killed === 0 && failed === 0) process.stdout.write('本来就没有在运行的东西。\n');
    return 0;
  }

  // 形如 插件.服务 → 走服务停止（插件自己知道怎么优雅退出）
  if (target.includes('.')) {
    const idx = target.lastIndexOf('.');
    const r = await stopService(target.slice(0, idx), target.slice(idx + 1));
    process.stdout.write(r.ok ? c.green(`✓ ${r.message}\n`) : c.red(`✗ ${r.message}\n`));
    return r.ok ? 0 : 1;
  }

  const r = killProcess(target);
  process.stdout.write(r.ok ? c.green(`✓ ${r.message}\n`) : c.red(`✗ ${r.message}\n`));
  return r.ok ? 0 : 1;
}

/** zkit web <插件id>：起启动器并直达插件自带的富交互页面 */
async function cmdWeb(args: string[]): Promise<number> {
  const id = args.find((a) => !a.startsWith('--'));
  if (!id) {
    process.stderr.write('用法：zkit web <插件id> [--port N]\n');
    process.stderr.write(c.dim('  打开插件自带的 web 面。看看谁有：zkit list\n'));
    return 2;
  }
  const plugin = listPlugins().find((e) => e.plugin?.id === id)?.plugin;
  if (!plugin) {
    // 第四十六轮⑥：用法错误统一退出码 2（执行失败才是 1）——脚本好分流
    process.stderr.write(c.red(`✗ 没有插件 ${id}`) + '\n');
    process.stderr.write(c.dim('  先看看装了什么：zkit list\n'));
    return 1;
  }
  const webAction = plugin.actions.find((a) => a.render === 'web');
  const hasPage = fs.existsSync(path.join(plugin.dir, 'web', 'index.html'));
  if (!webAction && !hasPage) {
    process.stderr.write(c.red(`✗ 插件 ${id} 没有 web 面：目录下没有 web/index.html，也没有 render = "web" 的动作\n`));
    return 1;
  }
  if (webAction) {
    // 深链直达动作详情页：执行后结果交给插件页面渲染，桥可用
    process.stdout.write(`打开 ${c.bold(`${id}.${webAction.id}`)} 的富交互页面\n`);
  } else {
    process.stdout.write(c.yellow(
      `提示：${id} 有 web/index.html 但没有声明 render = "web" 的动作，裸开页面拿不到执行结果（桥只在启动器里生效）\n`));
  }
  const server = await import('./server.ts');
  return server.cli(['--open', ...args.filter((a) => a !== id)], {
    openPath: webAction ? `#/${id}/${webAction.id}` : `/p/${id}/`,
  });
}

const KNOWN_COMMANDS = ['allow', 'bench', 'audit', 'data', 'completion', 'config', 'desktop', 'doctor', 'welcome', 'gc', 'health', 'history', 'help', 'kill', 'last', 'list', 'logs', 'ls', 'man', 'market', 'mcp', 'path', 'plugin', 'ps', 'timers', 'run', 'show', 'stats', 'ui', 'web'];

// 第四十六轮②：man——不引依赖的终端命令参考（stdout 全量文本，man zkit 可外部包一层）
const MAN_PAGE = `zkit(1) -- zerokit 命令行参考

概述
  zkit <命令> [参数]     一份 plugin.toml 派生 CLI/启动器/MCP/AI 四个面

日常
  zkit / zkit im          交互菜单（插件 → 动作，↑↓ 选择、/ 过滤）
  zkit run <插件> <动作> [--k v...] [--out table|json|yaml|csv] [--quiet] [--copy]
                           [--watch N] [--interactive] [--yes]
  zkit last [--show]      重放最近一次执行（--show 只看不跑）
  zkit history [N]        历史倒序（--rerun N 重跑第 N 条）
  zkit list [--json|--brief|--health]   插件清单 / 健康一屏
  zkit show <插件> [动作] 动作参数与风险说明
  zkit stats [--since 7d] 使用统计
  zkit logs [N]           服务日志（zkit logs denied 拒绝记录）

插件
  zkit plugin new|dev|validate|install|add|update|remove|bundled|export|import|
              pack|unpack|info|recommend|lint|doc|publish-ready
  zkit market list|add|remove   插件集市

安全与运维
  zkit doctor [--json|--fix|--fix --yes]  环境自检（--fix 顺手修；--fix --yes 脚本化跳过说明输出）
  zkit health / audit [N] [--follow] / allow / gc [--apply]
  zkit ps / kill            托管进程

面
  zkit ui [--open|--port N]  启动器
  zkit web <插件id>          插件富交互页面
  zkit mcp                   MCP 服务（AI 客户端接入）
  zkit desktop               Tauri 原生壳

其他
  zkit completion bash|zsh|fish   shell 补全脚本
  zkit path                   数据目录位置
  zkit --version / -V         版本

退出码
  0 成功 · 1 执行失败 · 2 用法错误
`;

/** ①zkit completion bash|zsh|fish：三 shell 补全脚本。 */
function cmdCompletion(args: string[]): number {
  const shell = args[0];
  const subs = KNOWN_COMMANDS.join(' ');
  const notFound = (): number => {
    process.stderr.write('用法：zkit completion bash|zsh|fish\n');
    return 2;
  };
  if (shell === 'bash') {
    process.stdout.write(`# zkit bash 补全：eval "$(zkit completion bash)"
_zkit() {
  local cur prev
  cur="\${COMP_WORDS[COMP_CWORD]}"
  prev="\${COMP_WORDS[COMP_CWORD-1]}"
  case "\$prev" in
    run) COMPREPLY=( \$(compgen -W "$(subsRunPlugins)" -- "\$cur") ); return;;
  esac
  if [[ "\$cur" == -* ]]; then COMPREPLY=( \$(compgen -W "--json --brief --health --yes --quiet --copy --interactive --help --version" -- "\$cur") ); return; fi
  COMPREPLY=( \$(compgen -W "${subs}" -- "\$cur") )
}
complete -F _zkit zkit
`);
    return 0;
  }
  if (shell === 'zsh') {
    process.stdout.write(`#compdef zkit
# zkit zsh 补全：zkit completion zsh > ~/.zfunc/_zkit
_zkit() {
  local -a cmds
  cmds=(${subs.split(' ').join(' ')})
  _arguments '1: :($cmds)' '*::arg:->args'
  case $words[1] in
    run) _values '插件' $(zkit list --brief 2>/dev/null | python3 -c 'import json,sys;[print(p["id"]) for p in json.load(sys.stdin)]' 2>/dev/null) ;;
  esac
}
_zkit "$@"
`);
    return 0;
  }
  if (shell === 'fish') {
    process.stdout.write(`# zkit fish 补全：zkit completion fish > ~/.config/fish/completions/zkit.fish
complete -c zkit -n '__fish_use_subcommand' -a "${subs}"
complete -c zkit -n '__fish_seen_subcommand_from run' -a '(zkit list --brief 2>/dev/null | python3 -c "import json,sys;[print(p[\\"id\\"]) for p in json.load(sys.stdin)]" 2>/dev/null)' -d '插件'
complete -c zkit -s h -l help -d '帮助'
complete -c zkit -s V -l version -d '版本'
`);
    return 0;
  }
  return notFound();
}

/** run 子命令的插件名补全词表（装了什么补什么）。 */
function subsRunPlugins(): string {
  try {
    return listPlugins().map((e) => e.plugin?.id ?? '').filter(Boolean).join(' ');
  } catch { return ''; }
}

async function main(): Promise<number> {
  const [, , cmd, ...rest] = process.argv;
  switch (cmd) {
    case '--version':
    case '-V':
      // 第四十六轮③：--version 短旗标（读 package.json 单一事实源）
      process.stdout.write(JSON.parse(fs.readFileSync(path.join(import.meta.dirname, '..', 'package.json'), 'utf8')).version + '\n');
      return 0;
    case 'completion':
      return cmdCompletion(rest);
    case 'man':
      process.stdout.write(MAN_PAGE);
      return 0;
    case 'interactive':
    case 'im':
      return cmdInteractive(rest);
    case undefined:
      // 第四十五轮①：裸 zkit 在 TTY 下进交互模式；管道/CI 仍是帮助
      if (process.stdin.isTTY && !process.argv.includes('--help')) return cmdInteractive(rest);
      process.stdout.write(HELP);
      return 0;
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
    case 'config':
      return cmdConfig(rest);
    case 'plugin':
      return cmdPlugin(rest);
    case 'data':
      return await cmdData(rest);
    case 'timers':
      return await cmdTimers(rest);
    case 'market':
      return cmdMarket(rest);
    case 'ps':
      return cmdPs();
    case 'kill':
      return cmdKill(rest);
    case 'welcome':
      return cmdWelcome();
    case 'doctor':
      return cmdDoctor();
    case 'desktop':
      return cmdDesktop(rest);
    case 'stats':
      return cmdStats(rest);
    case 'health':
      return cmdHealth();
    case 'audit':
      return await cmdAudit(rest);
    case 'allow':
      return cmdAllow(rest);
    case 'gc':
      return cmdGc(rest);
    case 'path':
      return cmdPath();
    case 'last':
      return cmdLast(rest);
    case 'history':
      return cmdHistory(rest);
    case 'logs':
      return cmdLogs(rest);
    // 第七十一轮⑦：bench 子命令暴露 scripts/bench.mjs（--quick=BENCH_N:3 只测冷启动）
    case 'bench': {
      const quick = rest.includes('--quick');
      const args2 = [];
      if (quick) args2.push('quick');
      const { spawn } = await import('node:child_process');
      const pathmod = await import('node:path');
      const benchFile = pathmod.join(import.meta.dirname, '..', 'scripts', 'bench.mjs');
      if (!fs.existsSync(benchFile)) {
        process.stderr.write('✗ scripts/bench.mjs 不存在（开发环境专用命令）\n');
        return 1;
      }
      const env2 = { ...process.env, ...(quick ? { BENCH_N: '3', BENCH_QUICK: '1' } : {}) };
      const child = spawn(process.execPath, [benchFile, ...args2], { stdio: 'inherit', env: env2 });
      const code = await new Promise<number>((resolve) => child.on('close', resolve));
      return code;
    }
    case 'mcp': {
      const mcp = await import('./mcp.ts');
      return mcp.cli(rest);
    }
    case 'ui': {
      const server = await import('./server.ts');
      return server.cli(rest);
    }
    case 'web':
      return cmdWeb(rest);
    default: {
      // 第三十五轮①：打错命令给最接近的建议，而不是只甩一份全量帮助
      process.stderr.write(c.red(`未知命令：${cmd}`) + '\n');
      const hint = suggestLineMulti(String(cmd), KNOWN_COMMANDS);
      if (hint) process.stderr.write(c.yellow(`  ${hint}`) + '\n');
      process.stdout.write(HELP);
      return 2;
    }
  }
}

main().then((code) => process.exit(code)).catch((err) => {
  process.stderr.write(c.red(`✗ ${err?.stack ?? err}`) + '\n');
  process.exit(1);
});
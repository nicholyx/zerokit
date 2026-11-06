/**
 * 插件清单体检（lint）与参考文档生成（doc）。
 *
 * 与 manifest.loadPlugin 的分工：loadPlugin 只报「加载不过」的错误；
 * lint 在它之上再叠一层「能过但欠佳」的检查，让插件作者在发布前
 * 就看到问题，而不是用户装上之后才从报错里猜。
 * doc 则是反方向：把清单字段摊成给人看的 Markdown 参考文档。
 */
import type { Plugin, Action, ActionParam, PluginSetting } from './manifest.ts';
import { RISK_LEVELS } from './manifest.ts';

/** 体检结果的严重级别。error 会让 lint 退出码非零（CI 可用）。 */
export type LintSeverity = 'error' | 'warn' | 'info';

export interface LintFinding {
  /** 规则编号（L01…），与 docs/plugin-spec.md「体检规则」一节对照 */
  rule: string;
  severity: LintSeverity;
  /** 涉及对象：插件本身或某个动作/设置项 */
  target: string;
  message: string;
  /** 第一百四十四轮④：一句「怎么改」——lint 不只说错了，还给出手 */
  fixHint?: string;
}

const RISK_HINTS: ReadonlyArray<{ re: RegExp; min: RiskLevelOf }> = [
  { re: /删除|清空|卸载|remove|delete|drop|wipe|rm\s/i, min: 'destructive' },
  { re: /写入|覆盖到|上传到|install|overwrite|upload|mkdir|touch/i, min: 'mutate' },
  { re: /重启|杀掉|终止|restart|kill\b|terminate/i, min: 'mutate' },
];
type RiskLevelOf = (typeof RISK_LEVELS)[number];

function riskRank(r: RiskLevelOf): number {
  return RISK_LEVELS.indexOf(r);
}

/** 主体体检：输入已加载的插件，输出体检发现（不含加载失败——那由调用方报）。 */
/**
 * 每条规则的修复指引（第一百四十四轮④）：lint 不只说错了，还告诉作者怎么改。
 * keyed by rule id（L01…），渲染层取不到就省略。
 */
export const FIX_HINTS: Record<string, string> = {
  L01: '在 [plugin] 段写长 description（三引号字符串），它是插件主页正文',
  L02: '[plugin] 段加 keywords 数组，拼音与模糊搜索都吃它',
  L03: '把动作 description 写到 8 字以上，说清什么时候用这个动作',
  L04: '动作下加 [action.match] 表（type/fills/label），试一试与文档示例靠它预填',
  L05: 'match.fills 只能引用同一动作里声明过的参数名',
  L06: '要么把 risk 提到匹配档位，要么把标题/描述改得不像危险操作',
  L07: 'run 里的 {xxx} 占位符必须在 [[action.param]] 声明同名参数',
  L08: '给动作写 exampleShape（示例 JSON 字符串），启动器能预览输出形状',
  L09: '补全后再跑一次 zkit plugin lint',
  L10: '[plugin] 段写 license = "MIT" 等标识，集市与打包都认它',
  L11: '声明了 ui 就要至少有一个 render = "web" 的动作',
  L12: '涉密参数改走 [[setting]]（secret = true），不要明文进命令行',
  L13: 'enum 参数补 options 数组；参数 description 写到 4 字以上',
  L14: '组合步骤 use 写 self.<动作id>，被引用动作声明 output = "json"',
  L15: '模板 {别名.data.字段} 的别名要与 steps 里的 as（或动作 id 推导名）一致',
  L16: '脚本输出非 UTF-8（如 GBK）时在动作里声明 encoding = "gbk"',
  L17: 'timeout 控制在 1–600 秒；长期进程用 background = true',
  L18: '补 [[setting]] 声明，或修正 {setting.x} 的引用名',
  L19: '[[service]] 声明 port 或 pidFile 至少一项，内核才能检测运行状态',
  L20: '每个动作 id 唯一——重复 id 后面的会覆盖前面的',
};

export function lintPlugin(p: Plugin): LintFinding[] {
  const out: LintFinding[] = [];
  const actionIds = new Set(p.actions.map((a) => a.id));

  // L01 插件级：描述太薄（summary 是搜索与模型路由的一句话；description 是长说明，可选）
  if (!p.summary || p.summary.length < 8) {
    out.push({ rule: 'L01', severity: 'warn', target: p.id, message: '插件 summary 太短（少于 8 字）——它出现在搜索结果与 AI 路由里，值得写清楚它解决什么问题', fixHint: '把 [plugin] 段的 summary 写到 8 字以上：解决什么问题、给谁用' });
  } else if (!p.description || p.description.length < 20) {
    out.push({ rule: 'L01', severity: 'info', target: p.id, message: '没写长 description（插件主页的正文）——写了会让插件主页更完整', fixHint: '在 [plugin] 段写长 description（三引号字符串），它是插件主页正文' });
  }
  // L02 插件级：没有 keywords
  if (!p.keywords || p.keywords.length === 0) {
    out.push({ rule: 'L02', severity: 'warn', target: p.id, message: '没有 keywords——拼音与模糊搜索都吃它，至少给两三个' });
  }

  for (const a of p.actions) {
    // L03 动作 description 缺失或太薄
    if (!a.description || a.description.length < 10) {
      out.push({ rule: 'L03', severity: 'warn', target: `${p.id}.${a.id}`, message: 'description 太短——它同时是 AI 工具描述，写清「什么时候用这个动作」' });
    }
    // L04 有参数却没有 example
    if (a.params && a.params.length > 0 && !a.match) {
      out.push({ rule: 'L04', severity: 'info', target: `${p.id}.${a.id}`, message: '有参数但没写 [action.match]——启动器「试一试」与文档示例靠它预填' });
    }
    // L05 match.fills 引用了不存在的参数名（fills 可以是逗号分隔的多个参数）
    if (a.match) {
      for (const raw of a.match.fills.split(',').map((x) => x.trim()).filter(Boolean)) {
        if (!a.params.some((pm) => pm.name === raw)) {
          out.push({ rule: 'L05', severity: 'error', target: `${p.id}.${a.id}`, message: `match.fills 引用了参数 "${raw}"，但参数表里没有它` });
        }
      }
    }
    // L06 动作名/描述像有副作用，risk 却是 read
    const text = `${a.title ?? ''} ${a.description ?? ''}`;
    for (const h of RISK_HINTS) {
      if (h.re.test(text) && riskRank(a.risk) < riskRank(h.min)) {
        out.push({ rule: 'L06', severity: 'warn', target: `${p.id}.${a.id}`, message: `标题/描述像是「${h.min}」级操作，但 risk 声明是 ${a.risk}——确认一下，别让授权提示骗人` });
        break;
      }
    }
    // L07 chain 步骤引用不存在的动作
    if (a.type === 'chain' && a.steps) {
      for (const st of a.steps) {
        const ref = st.use.startsWith('self.') ? st.use.slice(5) : st.use;
        if (st.use.startsWith('self.') && !actionIds.has(ref)) {
          out.push({ rule: 'L07', severity: 'error', target: `${p.id}.${a.id}`, message: `组合步骤引用了本插件不存在的动作 "${ref}"` });
        }
      }
    }
    // L08 secret 参数没给 default（装机向导会卡在无默认值上）
    for (const pm of a.params ?? []) {
      if (pm.secret && pm.default === undefined && pm.required) {
        out.push({ rule: 'L08', severity: 'info', target: `${p.id}.${a.id}`, message: `secret 参数 "${pm.name}" 没有默认值也不是可选——装机时用户得现场提供，确认这是故意的` });
      }
    }
  }

  // L09 设置项缺 description
  for (const s of (p.settings ?? []) as PluginSetting[]) {
    if (!s.description || s.description.length < 6) {
      out.push({ rule: 'L09', severity: 'info', target: `${p.id}#${s.name}`, message: '设置项 description 太短——它就是配置界面的说明文字' });
    }
  }
  // L10 一个动作都没有
  if (p.actions.length === 0) {
    out.push({ rule: 'L10', severity: 'error', target: p.id, message: '插件没有任何动作——加载了也无处可点' });
  }
  // L11（第六十一轮③）：ui 声明与 render=web 动作的匹配度。
  // 声明了 ui 但没有任何 web 动作 → warn（用户期待落空）；
  // 有 web 动作但全部没显式声明 ui → info（解析器已默认置 true，提醒作者显式写明更稳）。
  const webActions = p.actions.filter((a) => a.render === 'web');
  const declaredUi = p.actions.filter((a) => a.ui === true);
  if (declaredUi.length > 0 && webActions.length === 0) {
    out.push({ rule: 'L11', severity: 'warn', target: p.id, message: `声明了 ui = true 但没有任何 render = "web" 的动作——用户会期待界面却看不到` });
  } else if (webActions.length > 0 && declaredUi.length < webActions.length) {
    out.push({ rule: 'L11', severity: 'info', target: p.id, message: `${webActions.length - declaredUi.length} 个 web 动作未显式声明 ui（解析时已默认 true），建议在清单里写明` });
  }
  // L12（第七十六轮⑦）：声明了 sandbox 却往 env 里塞敏感字面量——白名单模式本意是
  // 收紧环境，再通过 action.env 传明文口令等于左手锁门右手开窗。口令应走 [[setting]]。
  const sandboxed = p.actions.filter((a) => a.sandbox === true);
  for (const a of sandboxed) {
    const suspicious = Object.keys(a.env ?? {}).filter((k) => /token|secret|password|passwd|api_?key/i.test(k));
    if (suspicious.length > 0) {
      out.push({ rule: 'L12', severity: 'warn', target: `${p.id}.${a.id}`, message: `动作声明了 sandbox，但 env 里出现疑似敏感键 ${suspicious.join('、')}——口令应走 [[setting]] 声明（掩码存储），不该在清单里写明文` });
    }
  }

  // ---- 第一百五十二轮：L13–L20，把最近二十轮踩过的清单坑变成安装前防线 ----

  const idCount = new Map<string, number>();
  for (const a of p.actions) idCount.set(a.id, (idCount.get(a.id) ?? 0) + 1);
  const settingNames = new Set((p.settings ?? []).map((s) => s.name));

  for (const a of p.actions) {
    // L13 参数形态：enum 必须带非空 options（加载层已拦 type 合法性；
    // options 空时启动器下拉框是空的）；参数 description 太薄也点破。
    for (const pm of a.params) {
      if (pm.type === 'enum' && (!pm.enum || pm.enum.length === 0)) {
        out.push({ rule: 'L13', severity: 'error', target: `${p.id}.${a.id}`, message: `参数 "${pm.name}" 类型是 enum 但没有 options——启动器下拉框会是空的`, fixHint: 'params = [{ name = "x", type = "enum", options = ["a","b"] }]' });
      }
      if (!pm.description) {
        out.push({ rule: 'L13', severity: 'warn', target: `${p.id}.${a.id}`, message: `参数 "${pm.name}" 缺 description——它是参数输入框的说明文字与 AI 的参数提示` });
      }
    }
    // L14 chain 步骤 use 语法 + 被引用动作必须存在且声明 output="json"
    if (a.type === 'chain' && a.steps) {
      for (const st of a.steps) {
        const m = /^(self|[\w.-]+)\.([\w-]+)$/.exec(st.use);
        if (!m) {
          out.push({ rule: 'L14', severity: 'error', target: `${p.id}.${a.id}`, message: `组合步骤 use = "${st.use}" 语法不对——必须是 self.<动作id> 或 <插件id>.<动作id>` });
          continue;
        }
        const scope = m[1] as string;
        const actId = m[2] as string;
        if (scope === 'self') {
          const target = p.actions.find((x) => x.id === actId);
          if (!target) {
            out.push({ rule: 'L14', severity: 'error', target: `${p.id}.${a.id}`, message: `组合步骤引用了本插件不存在的动作 "${actId}"` });
          } else if (target.output !== 'json') {
            out.push({ rule: 'L14', severity: 'error', target: `${p.id}.${a.id}`, message: `组合步骤引用的动作 "${actId}" 未声明 output = "json"——后续步骤取不到 {别名.data.字段}` });
          }
        }
        // 跨插件引用（scope !== 'self'）在本插件 lint 里查不到目标，交给安装时依赖检查
      }
      // L15 模板占位符引用的步骤别名必须在 steps 里（as 或动作 id 推导名）
      if (a.template) {
        const aliases = new Set(a.steps.map((st) => st.as || st.use.replace(/^self\./, '').replace(/^[\w.-]+\./, '').replace(/-/g, '_')));
        for (const m2 of a.template.matchAll(/\{([\w.-]+)\.data\./g)) {
          if (!aliases.has(m2[1] as string)) {
            out.push({ rule: 'L15', severity: 'error', target: `${p.id}.${a.id}`, message: `模板占位符引用的步骤别名 "${m2[1]}" 在 steps 里不存在` });
          }
        }
      }
    }
    // L16 python 动作未声明 encoding（默认 utf8；老工具输出 GBK 要显式声明）
    const isPython = a.run.length > 0 && /python/.test(a.run[0] ?? '');
    if (isPython && a.encoding === 'utf8') {
      out.push({ rule: 'L16', severity: 'info', target: `${p.id}.${a.id}`, message: 'python 动作未显式声明 encoding（默认 utf-8）——若脚本输出 GBK 请写 encoding = "gbk"' });
    }
    // L17 timeout 范围（>600s 大概率是把「后台动作」写成了前台等待）
    if (a.timeout < 1 || a.timeout > 600) {
      out.push({ rule: 'L17', severity: 'warn', target: `${p.id}.${a.id}`, message: `timeout = ${a.timeout} 秒——合理区间 1–600；长期运行的进程应声明 background = true 而不是拉长超时` });
    }
  }

  // L18 {setting.x} 引用了未声明的设置项（加载层已拦；lint 报告里同步点破）
  for (const a of p.actions) {
    const refs = new Set<string>();
    for (const seg of [...a.run, ...Object.values(a.env ?? {})]) {
      for (const m3 of seg.matchAll(/\{setting\.([\w-]+)\}/g)) refs.add(m3[1] as string);
    }
    for (const r of refs) {
      if (!settingNames.has(r)) {
        out.push({ rule: 'L18', severity: 'error', target: `${p.id}.${a.id}`, message: `{setting.${r}} 引用了未声明的设置项——在清单里补 [[setting]] name = "${r}"` });
      }
    }
  }

  // L19 声明了 [[service]] 的插件：无 port 且无 pidFile 的服务检测不了
  for (const s of p.services) {
    if (s.port === undefined && !s.pidFile) {
      out.push({ rule: 'L19', severity: 'warn', target: `${p.id}#${s.id}`, message: '服务既没声明 port 也没声明 pidFile——内核无法检测它是否在运行' });
    }
  }

  // L20 同插件内 action id 重复（加载时静默覆盖后面盖前面；lint 点破）
  for (const [dup, n] of idCount) {
    if (n > 1) {
      out.push({ rule: 'L20', severity: 'error', target: p.id, message: `动作 id "${dup}" 出现了 ${n} 次——加载时后面的会覆盖前面的` });
    }
  }

  return out.map((f) => ({ ...f, fixHint: f.fixHint ?? FIX_HINTS[f.rule] })).sort((x, y) => RISK_ORDER.indexOf(x.severity) - RISK_ORDER.indexOf(y.severity));
}

const RISK_ORDER: readonly LintSeverity[] = ['error', 'warn', 'info'];

/** 从清单生成动作参考文档（Markdown）。插件作者可以直接拿去当 README 的核心段。 */
export function docPlugin(p: Plugin, opts?: { toc?: boolean }): string {
  const lines: string[] = [];
  lines.push(`# ${p.name}（${p.id}）`);
  // 第一百五十三轮⑤：文档头部带质量徽标（作者一眼看到体检结果）
  const findings = lintPlugin(p);
  const sc = lintScore(findings);
  lines.push('', `质量：${sc.grade}（${sc.score}/100${findings.length > 0 ? `，${findings.length} 项待改进——zkit plugin lint ${p.id} 看` : '，零发现'}）`);
  if (p.summary) lines.push('', p.summary);
  if (p.version) lines.push('', `版本：${p.version}`);
  if (p.keywords?.length) lines.push('', `关键词：${p.keywords.join('、')}`);
  lines.push('', '## 动作', '');
  // 第一百五十三轮④：--toc 动作多时给目录（锚点=动作 id，GitHub 风格 slug）
  if (opts?.toc !== false && p.actions.length > 6) {
    const slug = (t: string): string => t.toLowerCase().replace(/[^\w\u4e00-\u9fa5]+/g, '-').replace(/^-+|-+$/g, '');
    lines.push('目录：' + p.actions.map((a) => `[${a.title ?? a.id}](#${slug(`${a.title ?? a.id}（${p.id}.${a.id}）`)})`).join(' · '), '');
  }
  for (const a of p.actions) {
    lines.push(`### ${a.title ?? a.id}（\`${p.id}.${a.id}\`）`, '');
    if (a.description) lines.push(a.description, '');
    lines.push(`- 风险：\`${a.risk}\`${a.risk !== 'read' ? '（有副作用，需授权）' : '（只读）'}`);
    // 第六十一轮⑤：带 UI 的动作在文档里给出「界面说明」段
    if (a.ui === true) {
      lines.push(`- 界面：🖥 带交互界面${a.ui_summary ? `——${a.ui_summary}` : ''}`
        + (a.ui_height ? `（初始高度 ${a.ui_height}px）` : ''));
    }
    if (a.params.length) {
      lines.push('', '| 参数 | 类型 | 必填 | 默认 |', '| --- | --- | --- | --- |');
      for (const pm of a.params) {
        const d = pm.secret ? '（secret，掩码显示）' : pm.default !== undefined ? `\`${String(pm.default)}\`` : '—';
        lines.push(`| \`${pm.name}\` | ${pm.type}${pm.secret ? '·secret' : ''} | ${pm.required ? '是' : '否'} | ${d} |`);
      }
    }
    lines.push('');
  }
  if (p.settings?.length) {
    lines.push('## 设置项', '', '| 名称 | 说明 | 默认 |', '| --- | --- | --- |');
    for (const s of p.settings) {
      lines.push(`| \`${s.name ?? ''}\` | ${s.description ?? ''} | ${s.default !== undefined ? `\`${String(s.default)}\`` : '—'} |`);
    }
    lines.push('');
  }
  lines.push('---', '', '> 本文档由 `zkit plugin doc ' + p.id + '` 从 plugin.toml 生成。');
  return lines.join('\n');
}

/**
 * 第一百五十三轮①②：质量分。error 每条 -15、warn -6、info -2，下限 0；
 * 等级 A(≥90)/B(≥75)/C(≥60)/D；改进建议 topN 按扣分排序（error 优先）。
 */
export interface LintScore { score: number; grade: string; bySeverity: Record<string, number>; suggestions: { rule: string; message: string; fixHint?: string; severity: string }[]; }

export function lintScore(findings: LintFinding[], topN = 3): LintScore {
  const bySeverity: Record<string, number> = { error: 0, warn: 0, info: 0 };
  for (const f of findings) bySeverity[f.severity] = (bySeverity[f.severity] ?? 0) + 1;
  const w: Record<string, number> = { error: 15, warn: 6, info: 2 };
  const raw = findings.reduce((sum, f) => sum + (w[f.severity] ?? 2), 0);
  const score = Math.max(0, 100 - raw);
  const grade = score >= 90 ? 'A' : score >= 75 ? 'B' : score >= 60 ? 'C' : 'D';
  const rank: Record<string, number> = { error: 0, warn: 1, info: 2 };
  const suggestions = [...findings]
    .sort((x, y) => (rank[x.severity] ?? 9) - (rank[y.severity] ?? 9))
    .slice(0, topN)
    .map((f) => ({ rule: f.rule, message: f.message, fixHint: f.fixHint, severity: f.severity }));
  return { score, grade, bySeverity, suggestions };
}

/** doc 的机读版：给启动器/AI 面用的扁平结构。 */
export function docPluginJson(p: Plugin): Record<string, unknown> {
  return {
    id: p.id,
    name: p.name,
    summary: p.summary,
    version: p.version,
    keywords: p.keywords ?? [],
    actions: p.actions.map((a: Action) => ({
      id: a.id,
      title: a.title,
      description: a.description,
      risk: a.risk,
      params: (a.params as ActionParam[]).map((pm: ActionParam) => ({ name: pm.name, type: pm.type, required: pm.required, secret: pm.secret, default: pm.default })),
    })),
    settings: p.settings.map((s) => ({ name: s.name, description: s.description, default: s.default })),
  };
}

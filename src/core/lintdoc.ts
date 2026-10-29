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
export function lintPlugin(p: Plugin): LintFinding[] {
  const out: LintFinding[] = [];
  const actionIds = new Set(p.actions.map((a) => a.id));

  // L01 插件级：描述太薄（summary 是搜索与模型路由的一句话；description 是长说明，可选）
  if (!p.summary || p.summary.length < 8) {
    out.push({ rule: 'L01', severity: 'warn', target: p.id, message: '插件 summary 太短（少于 8 字）——它出现在搜索结果与 AI 路由里，值得写清楚它解决什么问题' });
  } else if (!p.description || p.description.length < 20) {
    out.push({ rule: 'L01', severity: 'info', target: p.id, message: '没写长 description（插件主页的正文）——写了会让插件主页更完整' });
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
  return out.sort((x, y) => RISK_ORDER.indexOf(x.severity) - RISK_ORDER.indexOf(y.severity));
}

const RISK_ORDER: readonly LintSeverity[] = ['error', 'warn', 'info'];

/** 从清单生成动作参考文档（Markdown）。插件作者可以直接拿去当 README 的核心段。 */
export function docPlugin(p: Plugin): string {
  const lines: string[] = [];
  lines.push(`# ${p.name}（${p.id}）`);
  if (p.summary) lines.push('', p.summary);
  if (p.version) lines.push('', `版本：${p.version}`);
  if (p.keywords?.length) lines.push('', `关键词：${p.keywords.join('、')}`);
  lines.push('', '## 动作', '');
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

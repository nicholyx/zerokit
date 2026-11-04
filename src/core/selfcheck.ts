/**
 * 第一百三十七轮：集市装机自检。
 *
 * 装完插件不等于能用——运行环境缺依赖、清单里写的命令在本机不存在，
 * 都要到第一次真正执行时才暴露。装机自检在安装完成后立刻挑一个
 * 「只读且零必填参数」的动作真跑一次，把「装上了」和「装上且能跑」
 * 区分开。
 *
 * 挑选规则（宁可不跑也不乱跑）：
 * 1. risk 必须是 read——自检绝不产生副作用；
 * 2. 所有参数要么非必填、要么有默认值（可以零输入构造合法调用）；
 * 3. 优先挑 params 为空的动作（最干净的探针）；
 * 4. 找不到就返回 { kind: 'skip' }——「无可自检动作」是合法结论，
 *    不是错误。
 */

import type { Action, Plugin } from './manifest.ts';
import { applyDefaults } from './schema.ts';
import { runAction } from './runner.ts';

export interface SelfcheckProbe {
  kind: 'run' | 'skip';
  /** kind=run 时：挑中的动作 id */
  actionId?: string;
  /** kind=skip 时：人话原因（「没有只读且零必填参数的动作」） */
  reason?: string;
}

/** 挑自检动作：纯函数，可单测。 */
export function pickSelfcheckAction(actions: Action[]): SelfcheckProbe {
  const list = actions ?? [];
  const readable = list.filter((a) => a.risk === 'read');
  if (readable.length === 0) return { kind: 'skip', reason: '没有只读动作' };
  // 探针优先级：零参数 > 全默认 > 无必填（仍要靠 default 补）
  const zero = readable.filter((a) => (a.params ?? []).length === 0);
  if (zero.length > 0) return { kind: 'run', actionId: zero[0]?.id };
  const allDefault = readable.filter((a) => (a.params ?? []).every((p) => !p.required || p.default !== undefined));
  if (allDefault.length > 0) return { kind: 'run', actionId: allDefault[0]?.id };
  return { kind: 'skip', reason: '没有只读且零必填参数的动作' };
}

export interface SelfcheckResult {
  pluginId: string;
  probe: SelfcheckProbe;
  /** kind=skip 时 null；run 时真跑结论 */
  ok: boolean | null;
  ms?: number;
  error?: string;
  stderr?: string;
  at: string;
}

/** 装机自检主入口：挑动作 → 真跑 → 结论。 */
export async function selfcheckPlugin(plugin: Plugin): Promise<SelfcheckResult> {
  const probe = pickSelfcheckAction(plugin.actions);
  const at = new Date().toISOString();
  if (probe.kind === 'skip') return { pluginId: plugin.id, probe, ok: null, at };
  const action = plugin.actions.find((a) => a.id === probe.actionId);
  if (!action) return { pluginId: plugin.id, probe: { kind: 'skip', reason: '挑中的动作不在清单里' }, ok: null, at };
  const prepared = applyDefaults(action, {});
  if (prepared.errors.length > 0) {
    return { pluginId: plugin.id, probe, ok: false, error: prepared.errors.join('；'), at };
  }
  const r = await runAction(plugin, action, { caller: 'ui', values: prepared.values });
  return {
    pluginId: plugin.id,
    probe,
    ok: r.ok,
    ms: r.ms,
    error: r.error ?? undefined,
    stderr: r.stderr ? r.stderr.slice(0, 300) : undefined,
    at,
  };
}

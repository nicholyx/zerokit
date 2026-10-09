import fs from 'node:fs';
import path from 'node:path';
import { HOME, ensureDirs } from './paths.ts';
import type { RiskLevel } from './manifest.ts';
import type { ConfirmPolicy } from './runner.ts';

/**
 * 「确认过就记住」的存储。CLI 和 Web/启动器共用同一份，
 * 所以在终端里确认过的动作，界面里不会再问第二遍，反之亦然。
 * 高风险（destructive）动作不参与记忆，每次都问。
 */

function storePath(): string {
  return path.join(HOME, 'approvals.json');
}

export function loadApprovals(): Set<string> {
  try {
    const raw = JSON.parse(fs.readFileSync(storePath(), 'utf8'));
    return new Set(Array.isArray(raw) ? raw.filter((x) => typeof x === 'string') : []);
  } catch {
    return new Set();
  }
}

export function hasApproval(pluginId: string, actionId: string): boolean {
  return loadApprovals().has(`${pluginId}.${actionId}`);
}

export function rememberApproval(pluginId: string, actionId: string): void {
  const set = loadApprovals();
  set.add(`${pluginId}.${actionId}`);
  ensureDirs();
  fs.writeFileSync(storePath(), JSON.stringify([...set].sort(), null, 2));
}

export function forgetApproval(pluginId: string, actionId: string): boolean {
  const set = loadApprovals();
  const removed = set.delete(`${pluginId}.${actionId}`);
  if (removed) {
    ensureDirs();
    fs.writeFileSync(storePath(), JSON.stringify([...set].sort(), null, 2));
  }
  return removed;
}

/**
 * 判定某个动作这次要不要向用户确认。
 * destructive 永远要问；mutate 首次问、记住后不再问；read 不问。
 */
export function needsConfirm(
  risk: RiskLevel,
  policy: ConfirmPolicy,
  pluginId: string,
  actionId: string,
): boolean {
  if (policy === 'never') return false;
  if (policy === 'always') return true;
  return !hasApproval(pluginId, actionId);
}
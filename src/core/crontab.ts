// crontab.ts —— 第一百六十三轮⑦：轻量定时表（记录 + 补打，不驻留进程）
//
// 设计：zkit 不做守护进程（本地工具的后台常驻是信任负担），定时交给系统 cron /
// launchd / 任务计划程序——zkit 只负责「记什么该跑 + 到点怎么跑」：
//   cron add <名字> -- <zkit 参数...>   登记（存表）
//   cron list [--json]                 看表 + 各平台的系统接线建议
//   cron rm <名字>                     删
//   cron run [名字]                    立即补打（cron 行里就一条 `zkit cron run`）
// 表存 ~/.zerokit/crontab.json（0600 原子写）。
import fs from 'node:fs';
import path from 'node:path';

export interface CronEntry { name: string; argv: string[]; createdAt: string; note?: string }

export function crontabPath(home: string): string { return path.join(home, 'crontab.json'); }

export function loadCrontab(home: string): CronEntry[] {
  const p = crontabPath(home);
  if (!fs.existsSync(p)) return [];
  try {
    const raw = JSON.parse(fs.readFileSync(p, 'utf8'));
    return Array.isArray(raw) ? raw.filter((e) => e && typeof e.name === 'string' && Array.isArray(e.argv)) : [];
  } catch { return []; } // 坏表当空表：cron 不该因为一张坏表整个罢工
}

export function saveCrontab(home: string, entries: CronEntry[]): void {
  const p = crontabPath(home);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  const tmp = p + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(entries, null, 2) + '\n', { mode: 0o600 });
  fs.renameSync(tmp, p);
}

export function validCronName(name: string): true | string {
  if (!name.trim()) return '名字不能为空';
  if (name.length > 40) return '名字最长 40 字符';
  if (!/^[\w\u4e00-\u9fa5.-]+$/.test(name)) return '名字只支持字母/数字/中文/点/横线/下划线（要能进 cron 行）';
  return true;
}

// 纯查重（不读盘的形态，调用方持 entries）
export function cronNameTaken(entries: CronEntry[], name: string): boolean {
  return entries.some((e) => e.name === name);
}

/** 生成各平台系统接线行（cron run 那一行怎么进系统调度器） */
export function cronWiringHint(zkitBin: string): string[] {
  return [
    `  macOS/Linux（crontab -e）：*/10 * * * * ${zkitBin} cron run >> ~/.zerokit/logs/cron.log 2>&1`,
    `  Windows（任务计划程序，每 10 分钟）：schtasks /create /tn zerokit-cron /sc minute /mo 10 /tr "${zkitBin} cron run"`,
    `  手动补打：${zkitBin} cron run`,
  ];
}

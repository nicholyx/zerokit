// 第三十五轮：错误预防与自愈——建议、诊断、自修复的纯函数层。
// 设计立场：错误消息不是认罪书，是导航。每一类常见错误都要能回答
// 「刚才发生了什么 + 下一步敲什么」。
import fs from 'node:fs';
import path from 'node:path';

/** 编辑距离（Levenshtein，两行滚动数组）。命令/动作建议的底盘。 */
export function editDistance(a: string, b: string): number {
  const m = a.length, n = b.length;
  if (m === 0) return n;
  if (n === 0) return m;
  let prev: number[] = Array.from({ length: n + 1 }, (_, i) => i);
  let cur: number[] = new Array<number>(n + 1).fill(0);
  for (let i = 1; i <= m; i++) {
    cur[0] = i;
    for (let j = 1; j <= n; j++) {
      const cost = a.charCodeAt(i - 1) === b.charCodeAt(j - 1) ? 0 : 1;
      cur[j] = Math.min((prev[j] ?? 0) + 1, (cur[j - 1] ?? 0) + 1, (prev[j - 1] ?? 0) + cost);
    }
    [prev, cur] = [cur, prev];
  }
  return prev[n] ?? 0;
}

export interface Suggestion { candidate: string; score: number }

/**
 * 模糊建议：编辑距离 + 前缀/子串加权。
 * 空候选给空数组；全都差太远（距离 > max(2, len/3)）也给空——
 * 宁可不给建议，不给「plugn → plugin install」这种瞎猜。
 */
export function suggest(input: string, candidates: readonly string[], limit = 3): Suggestion[] {
  if (!input) return [];
  const low = input.toLowerCase();
  const scored = candidates
    .filter((c) => c.toLowerCase() !== low)
    .map((c) => {
      const d = editDistance(low, c.toLowerCase());
      // 前缀命中权重极高（pl → plugin 是手滑少打了，不是拼错）。
      // 折算后与子串类同分时，长候选优先：pl 的本意更可能是 plugin 而不是 ps。
      let score = d;
      if (c.toLowerCase().startsWith(low)) score = d * 0.4 - c.length * 0.15;
      else if (c.toLowerCase().includes(low) && low.length >= 2) score = d * 0.7 - c.length * 0.15;
      return { candidate: c, score };
    })
    .filter((s) => s.score <= Math.max(2, Math.floor(input.length / 3)))
    .sort((a, b) => a.score - b.score || a.candidate.localeCompare(b.candidate));
  return scored.slice(0, limit);
}

/** 建议渲染成一句人话；无建议返回 null。 */
export function suggestLine(input: string, candidates: readonly string[]): string | null {
  const s = suggest(input, candidates, 1);
  if (s.length === 0) return null;
  return `是不是想敲「${s[0]!.candidate}」？（${input} → ${s[0]!.candidate}）`;
}

// ---------------- 失败输出自诊断 ----------------

export interface DiagnosedError {
  kind: string;          // 机器可读类别
  headline: string;      // 一行人话
  nextSteps: string[];   // 下一步（可执行的命令或动作）
}

const DIAG_RULES: Array<{ kind: string; test: RegExp; headline: string; steps: string[] }> = [
  {
    kind: 'permission',
    test: /permission denied|EACCES|epERM/i,
    headline: '没有权限',
    steps: [
      '看文件归属：ls -l <路径>（Windows：icacls <路径>）',
      '常用修法：chmod +x <脚本>，或把数据目录 (~/.zerokit) 还给当前用户',
    ],
  },
  {
    kind: 'not-found',
    test: /ENOENT|no such file|找不到文件/i,
    headline: '文件或目录不存在',
    steps: [
      '确认路径拼写与工作目录（zkit 里插件的工作目录是它自己的安装目录）',
      '插件要的辅助文件应写进清单 cwd/参数，别依赖调用时的相对路径',
    ],
  },
  {
    kind: 'not-executable',
    test: /ENOEXEC|not executable|不是可执行文件/i,
    headline: '文件在但跑不起来',
    steps: [
      '脚本缺执行位：chmod +x <文件>',
      'Windows 里 .sh 不能直接跑；插件跨平台用 run = ["{python}", ...] 或自带 .bat',
    ],
  },
  {
    kind: 'timeout',
    test: /timed? ?out|ETIMEDOUT|超时/i,
    headline: '执行超时',
    steps: [
      '该动作可能卡在等输入或网络；插件清单里可用 timeout 声明更长超时',
      '网络类动作先确认代理环境变量（http_proxy/https_proxy）是否该设',
    ],
  },
  {
    kind: 'command-not-found',
    test: /command not found|无法将.+识别为|is not recognized as/i,
    headline: '依赖的程序没装',
    steps: [
      'zkit doctor 会列出各插件缺的运行时',
      '装完重跑 zkit doctor 确认；插件文档在插件主页（zkit ui → 插件页）',
    ],
  },
];

/** 从 stderr 文本里识别常见故障并给下一步。认不出来返回 null（保留原始输出）。 */
export function diagnose(stderr: string): DiagnosedError | null {
  for (const r of DIAG_RULES) {
    if (r.test.test(stderr)) {
      return { kind: r.kind, headline: r.headline, nextSteps: r.steps };
    }
  }
  return null;
}

// ---------------- 路径平台检测 ----------------

const WIN_PATH = /(?:^|[\s"'])((?:[A-Za-z]:)?[\\/](?:[\w.-]+[\\/])*)[\w.-]*/;

/** 检测字符串参数里混入的异平台路径（mac 上给 C:\...、Windows 上给 /usr/...）。 */
export function foreignPath(args: readonly string[], platform: NodeJS.Platform = process.platform): string | null {
  const isWin = platform === 'win32';
  for (const a of args) {
    if (isWin) {
      // Windows 上：/usr/... /home/... 这类 Unix 绝对路径
      if (/^\/(?:usr|home|opt|etc|var|tmp)\//.test(a)) return a;
    } else {
      // Unix 上：盘符路径 C:\... D:/...
      if (/^[A-Za-z]:[\\/]/.test(a)) return a;
    }
  }
  return null;
}

// ---------------- 半安装插件检测 ----------------

export interface OrphanPlugin { id: string; dir: string; hasToml: boolean; hasFiles: string[] }

/**
 * 扫插件目录：存在但缺 plugin.toml 的目录是「装了一半」（unpack 中断、
 * 手工拷贝残留）。返回孤儿列表——清不清由调用方决定，这里只报事实。
 */
export function findOrphanPlugins(pluginsDir: string): OrphanPlugin[] {
  if (!fs.existsSync(pluginsDir)) return [];
  const out: OrphanPlugin[] = [];
  for (const name of fs.readdirSync(pluginsDir)) {
    if (name.endsWith('.bak')) continue; // unpack --replace 的备份，有意为之
    if (name.startsWith('_')) continue; // 共享代码层（_vendor），有意存在
    const dir = path.join(pluginsDir, name);
    if (!fs.statSync(dir).isDirectory()) continue;
    const files = fs.readdirSync(dir);
    if (!files.includes('plugin.toml')) {
      out.push({ id: name, dir, hasToml: false, hasFiles: files.slice(0, 8) });
    }
  }
  return out;
}

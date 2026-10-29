// 速度基准：把「启动」和「打开动作」拆成可测量的几段。
// 先说数字再谈优化——否则很容易优化到不痛的地方。
import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const PKG_ROOT = path.resolve(import.meta.dirname, '..');
const CLI = path.join(PKG_ROOT, 'src', 'cli.ts');
const PORT = 28931;
const now = () => performance.now();
const fmt = (ms) => `${ms.toFixed(0)} ms`;

const rows = [];
const row = (name, ms, note = '') => {
  rows.push([name, ms, note]);
  console.log(`  ${name.padEnd(34)} ${fmt(ms).padStart(8)}  ${note}`);
};

// ---------- 0. CLI 冷启动（第五十八轮补：不依赖服务器的三条最薄路径）----------
{
  const N = Number(process.env['BENCH_N'] ?? 10);
  const med = (a) => { const s = [...a].sort((x, y) => x - y); return s[Math.floor(s.length / 2)]; };
  const benchCmd = (args) => {
    const times = [];
    for (let i = 0; i < N; i++) {
      const t0 = now();
      spawnSync(process.execPath, [CLI, ...args], { encoding: 'utf8' });
      times.push(now() - t0);
    }
    return { med: med(times), min: Math.min(...times), max: Math.max(...times) };
  };
  // 纯 Node 基线
  {
    const times = [];
    for (let i = 0; i < N; i++) { const t0 = now(); spawnSync(process.execPath, ['-e', '0']); times.push(now() - t0); }
    row('node -e（纯 Node 启动）', med(times), `${N} 次中位`);
  }
  for (const [label, args] of [['zkit path（最薄命令）', ['path']], ['zkit --help', ['--help']], ['zkit list', ['list']]]) {
    const r = benchCmd(args);
    row(label, r.med, `${N} 次中位；最快 ${fmt(r.min)} 最慢 ${fmt(r.max)}`);
  }
  // 峰值 RSS（macOS /usr/bin/time -l；Linux 同选项名不同，输出同正则可匹配）
  const rssOf = (argv) => {
    const r = spawnSync('/usr/bin/time', ['-l', process.execPath, ...argv], { encoding: 'utf8' });
    const m = /(\d+)\s+maximum resident set size/.exec(r.stderr || '');
    return m ? Number(m[1]) / 1048576 : null;
  };
  console.log();
  const baseRss = rssOf(['-e', '0']);
  if (baseRss) row('RSS：node -e 基线', baseRss * 1024, `${baseRss.toFixed(1)} MB`);
  for (const [label, args] of [['RSS：zkit path', ['path']], ['RSS：zkit list', ['list']]]) {
    const mb = rssOf([CLI, ...args]);
    if (mb) row(label, mb * 1024, `${mb.toFixed(1)} MB（差值含 amaro TS 转译 + 模块图）`);
  }
  console.log();
}

if (!process.env['BENCH_QUICK']) {
// ---------- 1. 内核冷启动（进程起来 + 开始监听）----------
{
  const t0 = now();
  const child = spawn(process.execPath, [path.join(PKG_ROOT, 'src', 'server.ts'), 'ui', '--port', String(PORT)], {
    cwd: PKG_ROOT, stdio: ['ignore', 'pipe', 'ignore'], windowsHide: true,
  });
  await new Promise((resolve) => {
    child.stdout.on('data', (d) => { if (d.toString().includes('http://')) resolve(); });
  });
  row('内核冷启动（含 node 自身启动）', now() - t0);

  // ---------- 2. 首页 HTML ----------
  {
    const t1 = now();
    const res = await fetch(`http://127.0.0.1:${PORT}/`);
    await res.text();
    row('首个页面响应', now() - t1, `${res.headers.get('content-length') ?? '?'} 字节`);
  }

  // ---------- 3. 插件列表接口 ----------
  {
    const t1 = now();
    await (await fetch(`http://127.0.0.1:${PORT}/api/plugins`)).json();
    row('插件列表接口', now() - t1);
  }

  // ---------- 4. 拼音表传输（前端要加载它）----------
  {
    const t1 = now();
    const res = await fetch(`http://127.0.0.1:${PORT}/pinyin-data.js`);
    const text = await res.text();
    row('拼音表加载', now() - t1, `${(text.length / 1024).toFixed(0)} KB`);
  }

  // ---------- 5. 各类动作的执行耗时（端到端，走 HTTP）----------
  const token = (await (await fetch(`http://127.0.0.1:${PORT}/`)).text())
    .match(/zk-token" content="([^"]+)"/)?.[1];

  const timeAction = async (plugin, action, values = {}, times = 3) => {
    const samples = [];
    for (let i = 0; i < times; i++) {
      const t = now();
      await (await fetch(`http://127.0.0.1:${PORT}/api/run`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-zerokit-token': token },
        body: JSON.stringify({ plugin, action, values, confirm: undefined }),
      })).json();
      samples.push(now() - t);
    }
    return samples;
  };

  for (const [plugin, action, note] of [
    ['sysinfo', 'overview', 'node 脚本'],
  ]) {
    const s = await timeAction(plugin, action);
    row(`动作 ${plugin}.${action}`, s[0], `${note}；3 次：${s.map((x) => x.toFixed(0)).join('/')}`);
  }

  // ---------- 6. 纯解释器启动开销（下限）----------
  {
    const t1 = now();
    await new Promise((resolve) => {
      const c = spawn(process.execPath, ['-e', '0'], { stdio: 'ignore', windowsHide: true });
      c.on('close', resolve);
    });
    row('node 裸启动（下限参照）', now() - t1);
  }

  child.kill('SIGKILL');
}

console.log();
// RSS 行的数值单位是 MB 不是 ms——超时判据只看耗时行
const worst = rows.filter(([n, ms]) => !n.startsWith('RSS') && ms > 300);
if (worst.length) {
  console.log('超过 300ms 的环节：' + worst.map(([n]) => n).join('、'));
}

}

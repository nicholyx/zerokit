// 速度基准：把「启动」和「打开动作」拆成可测量的几段。
// 先说数字再谈优化——否则很容易优化到不痛的地方。
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
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
    ['proxy', 'status', 'python 脚本（跨语言）'],
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

    const py = 'C:\\Users\\RedMi\\AppData\\Local\\Programs\\Python\\Python313\\python.exe';
    if (fs.existsSync(py)) {
      const t2 = now();
      await new Promise((resolve) => {
        const c = spawn(py, ['-c', '0'], { stdio: 'ignore', windowsHide: true });
        c.on('close', resolve);
      });
      row('python 裸启动（下限参照）', now() - t2);
    }
  }

  child.kill('SIGKILL');
}

console.log();
const worst = rows.filter(([, ms]) => ms > 300);
if (worst.length) {
  console.log('超过 300ms 的环节：' + worst.map(([n]) => n).join('、'));
}
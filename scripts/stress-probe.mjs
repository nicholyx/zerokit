// bench 的轻量并发探针（与 stress.mjs 独立，可被动态 import）
import { spawn } from 'node:child_process';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
const CLI = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'src', 'cli.ts');
export async function runFour() {
  const jobs = Array.from({ length: 4 }, () => new Promise((res) => {
    const t0 = Date.now();
    const p = spawn(process.execPath, [CLI, 'run', 'quick', 'ts2date', '--ts', '1760000000'], { stdio: 'ignore' });
    p.on('close', () => res(Date.now() - t0));
  }));
  return Promise.all(jobs);
}

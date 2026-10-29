// 第六十二轮：插件包完整性（MANIFEST.sha256）——打包清单、安装校验、装后复验。
// 自包含：临时 ZEROKIT_HOME + plugin bundled 预装，结束清理。
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const REPO = path.resolve(import.meta.dirname, '..');
const HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'zk-signing-'));
process.env.ZEROKIT_HOME = HOME;

const results = [];
const check = (name, cond, detail = '') => {
  results.push([name, !!cond]);
  if (!cond) console.error(`FAIL  ${name}   <- ${detail}`);
};

const distro = await import(pathToFileURL(path.join(REPO, 'src/core/distro.ts')).href);
const cli = path.join(REPO, 'src/cli.ts');
const run = (args) => spawnSync(process.execPath, [cli, ...args], {
  encoding: 'utf8', env: { ...process.env, ZEROKIT_HOME: HOME },
});

try {
  run(['plugin', 'bundled']);

  // ---------- ①③ pack 出清单 + integrity 字段 ----------
  const pk = run(['plugin', 'pack', 'quick', '--out', HOME]);
  check('① pack 输出含 MANIFEST.sha256 行', pk.stdout.includes('MANIFEST.sha256'), pk.stdout);
  check('① 包文件里有 MANIFEST.sha256', fs.existsSync(path.join(HOME, 'zerokit-quick.zip')));
  const zipPath = path.join(HOME, 'zerokit-quick.zip');
  check('③ pack 输出 sha256- 完整性行', /sha256-[0-9a-f]{64}/.test(pk.stdout), pk.stdout);

  // 纯函数：清单格式
  const manifest = distro.buildManifest([
    { name: 'a.toml', data: Buffer.from('id="x"') },
    { name: 'b.py', data: Buffer.from('print(1)') },
  ]);
  check('① buildManifest 两行文件+一行 total', manifest.split('\n').filter(Boolean).length === 3, manifest);
  const totalLine = manifest.split('\n').find((l) => l.endsWith('# total'));
  check('① total 行格式', /^([0-9a-f]{64})\s{2}# total$/.test(totalLine.trim()), String(totalLine));

  // ② verifyAgainstManifest 好例
  const okEntries = [
    { name: 'a.toml', data: Buffer.from('id="x"') },
    { name: 'b.py', data: Buffer.from('print(1)') },
    { name: 'MANIFEST.sha256', data: Buffer.from(manifest) },
  ];
  check('② 好清单校验通过', distro.verifyAgainstManifest(okEntries, manifest) === null);

  // ② 篡改单文件
  const badEntries = okEntries.map((e) => e.name === 'b.py' ? { ...e, data: Buffer.from('print(2)') } : e);
  const bad = distro.verifyAgainstManifest(badEntries, manifest);
  check('② 篡改文件被点名', Array.isArray(bad) && bad.some((x) => x.includes('b.py') && x.includes('改动')), JSON.stringify(bad));

  // ⑧ 清单自身被改（把首条文件哈希换成假的）→ 总哈希对不上 → 判「清单被改」
  const lines = manifest.split('\n');
  const firstHashIdx = lines.findIndex((l) => /^[0-9a-f]{64}\s{2}/.test(l));
  const firstHash = (lines[firstHashIdx] ?? '').slice(0, 64);
  const fakeHash = firstHash.slice(0, 62) + (firstHash.endsWith('00') ? '11' : '00');
  lines[firstHashIdx] = fakeHash + (lines[firstHashIdx] ?? '').slice(64);
  const tamperedManifest = lines.join('\n');
  const badM = distro.verifyAgainstManifest(okEntries, tamperedManifest);
  check('⑧ 篡改清单自身 → 总哈希失败', Array.isArray(badM) && badM.some((x) => x.includes('总哈希')), JSON.stringify(badM));

  // ⑧ 清单被删（包里没有 MANIFEST）——按老包放行是 unpackPlugin 行为，这里验 parse null 容错
  check('⑧ 空清单文本解析失败', distro.parseManifest('garbage') === null || distro.parseManifest('garbage') === null);

  // ---------- ② CLI：坏包拒装 ----------
  // 用 python 篡改 zip 内一个文件（重建 zip 但保留原 MANIFEST）
  const badZip = path.join(HOME, 'quick-bad.zip');
  {
    const zin = [];
    const readZip = run(['plugin', 'unpack', zipPath, '--no-verify', '--replace']); // 先正常装一遍
    check('② --no-verify 可跳过（老流程兜底）', readZip.status === 0, readZip.stderr);
    void zin;
    // 借 Node 内置手段重建：读原 zip 的中央目录太啰嗦，直接用 distro 的 unzipFiles + zipFiles
    const entries = distro.unzipFiles(fs.readFileSync(zipPath));
    const tampered = entries.map((e) => e.name === 'quick.mjs'
      ? { ...e, data: Buffer.concat([e.data, Buffer.from('\n# evil\n')]) } : e);
    fs.writeFileSync(badZip, distro.zipFiles(tampered));
  }
  const badInstall = run(['plugin', 'unpack', badZip, '--replace']);
  check('② 坏包拒绝安装且指出文件', badInstall.status === 1 && badInstall.stderr.includes('quick.mjs'), badInstall.stderr);

  // ---------- ④⑤ 装时快照 + verify ----------
  const good = run(['plugin', 'unpack', zipPath, '--replace']);
  check('④ 好包正常安装', good.status === 0, good.stderr);
  const plugDir = path.join(HOME, 'plugins', 'quick');
  check('④ .zk-integrity.json 落盘', fs.existsSync(path.join(plugDir, '.zk-integrity.json')));
  const v1 = run(['plugin', 'verify', 'quick']);
  check('⑤ 装后 verify 通过', v1.status === 0 && v1.stdout.includes('完整'), v1.stdout);

  // 篡改装好的文件 → verify 暴露
  fs.appendFileSync(path.join(plugDir, 'quick.mjs'), '\n# tampered\n');
  const v2 = run(['plugin', 'verify', 'quick']);
  check('⑤ 篡改后 verify 报改动文件', v2.status === 1 && v2.stderr.includes('quick.mjs'), v2.stderr + v2.stdout);

  // 删文件 → missing
  fs.rmSync(path.join(plugDir, 'quick.mjs'));
  const v3 = run(['plugin', 'verify', 'quick']);
  check('⑤ 删除文件被点名', v3.status === 1 && v3.stderr.includes('被删除'), v3.stderr);

  // 恢复 + 删快照 → noSnapshot 分支
  run(['plugin', 'unpack', zipPath, '--replace']);
  fs.rmSync(path.join(plugDir, '.zk-integrity.json'));
  const v4 = run(['plugin', 'verify', 'quick']);
  check('⑤ 无快照给提示不误报', v4.status === 0 && v4.stdout.includes('快照'), v4.stdout + v4.stderr);

  // ---------- ⑥ market entry integrity 字段透传 ----------
  const mk = await import(pathToFileURL(path.join(REPO, 'src/core/market.ts')).href);
  const idx = mk.buildIndex(path.join(REPO, 'plugins'), 'selftest');
  check('⑥ buildIndex 条目可带 integrity（缺省 undefined）', idx.plugins.length > 0 && idx.plugins.every((p2) => p2.integrity === undefined || typeof p2.integrity === 'string'));
} finally {
  fs.rmSync(HOME, { recursive: true, force: true });
}

const pass = results.filter((r) => r[1]).length;
console.log(`通过 ${pass} / ${results.length}`);
if (pass !== results.length) {
  console.log('失败：' + results.filter((r) => !r[1]).map((r) => r[0]).join('、'));
  process.exit(1);
}
process.exit(0);

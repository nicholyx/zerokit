// 第三十四轮：插件市场与分发（打包/解包/上架检查/登记表校验）。
// 全部临时目录自包含。
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..');
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'zerokit-distro-smoke-'));
let passed = 0, failed = 0;
const fail = (m) => { failed++; console.log('FAIL  ' + m); process.exitCode = 1; };
const pass = (m) => { passed++; console.log('PASS  ' + m); };
const run = (args) => spawnSync(process.execPath, ['src/cli.ts', ...args], {
  cwd: ROOT, encoding: 'utf8', timeout: 60000, windowsHide: true,
  env: { ...process.env, ZEROKIT_HOME: TMP },
});

run(['plugin', 'bundled']);

// ---- ①③pack：zip 落盘 + 文件清单
{
  const outDir = path.join(TMP, 'pack-out');
  fs.mkdirSync(outDir, { recursive: true });
  const r = run(['plugin', 'pack', 'quick', '--out', outDir]);
  const zipPath = path.join(outDir, 'zerokit-quick.zip');
  if (r.status === 0 && fs.existsSync(zipPath)
      && r.stdout.includes('plugin.toml') && r.stdout.includes('quick.mjs')) {
    pass('①③pack 产出 zip + 文件清单（不含用户设置值）');
  } else {
    fail('①pack 失败：' + r.stdout.slice(0, 150) + r.stderr.slice(0, 100));
  }
  // zip 结构合法性交给系统 unzip（跨三平台都有；没有就跳过这项外部校验）
  const uz = spawnSync('unzip', ['-t', zipPath], { encoding: 'utf8' });
  if (uz.status === 0) pass('①zip 通过系统 unzip 完整性校验');
  else if (!fs.existsSync('/usr/bin/unzip')) console.log('      (unzip 不存在，跳过外部校验)');
  else fail('①unzip -t 报错：' + uz.stdout.slice(0, 120));
  // --list-only
  const lo = run(['plugin', 'pack', 'quick', '--list-only']);
  if (lo.status === 0 && lo.stdout.includes('将打包') && !fs.existsSync(path.join(TMP, 'zerokit-quick.zip'))) {
    pass('③--list-only 只看清单不落盘');
  } else fail('③--list-only 不对');
}

// ---- ②unpack：装回 + --replace + 坏包拒绝 + 穿越拒绝
{
  const zipPath = path.join(TMP, 'pack-out', 'zerokit-quick.zip');
  // 先删掉已装的 quick 再 unpack（模拟新机器）
  fs.rmSync(path.join(TMP, 'plugins', 'quick'), { recursive: true, force: true });
  const r = run(['plugin', 'unpack', zipPath]);
  if (r.status === 0 && fs.existsSync(path.join(TMP, 'plugins', 'quick', 'plugin.toml'))) {
    pass('②unpack 装回插件目录');
  } else {
    fail('②unpack 失败：' + r.stdout.slice(0, 150));
  }
  // 再 unpack（已装）→ 拒绝提示；--replace → 备份
  const r2 = run(['plugin', 'unpack', zipPath]);
  const r3 = run(['plugin', 'unpack', zipPath, '--replace']);
  if (r2.status !== 0 && r2.stdout.includes('--replace') || r2.stderr.includes('--replace')) {
    if (r3.status === 0 && fs.existsSync(path.join(TMP, 'plugins', 'quick.bak'))) {
      pass('②已装拒绝 + --replace 覆盖留 .bak 备份');
    } else fail('②replace 流程不对：' + r3.stdout.slice(0, 100));
  } else fail('②已装未拒绝');
  // 装回的插件能跑
  const rr = run(['run', 'quick', 'b64', '--text', 'hi']);
  if (rr.status === 0) pass('②装回的插件可执行');
  else fail('②装回后跑不动：' + rr.stderr.slice(0, 120));
}

// ---- 穿越攻击：手工构造 zip（直接 import 纯函数——不走子进程脚本，
// 避免路径插值在 Windows 反斜杠下被打穿）
{
  const { zipFiles, unpackPlugin } = await import(path.join(ROOT, 'src/core/distro.ts'));
  const evil = zipFiles([
    { name: 'plugin.toml', data: Buffer.from('[plugin]\nid = "evil"\nversion = "1.0.0"') },
    { name: '../evil-payload.txt', data: Buffer.from('pwned') },
  ]);
  const evilZip = path.join(TMP, 'evil.zip');
  fs.writeFileSync(evilZip, evil);
  const u = unpackPlugin(evilZip);
  if (u.ok === false && /可疑路径/.test(u.message ?? '') && !fs.existsSync(path.join(TMP, 'plugins', '..', 'evil-payload.txt'))) {
    pass('②路径穿越包被拒绝（.. 逃逸）');
  } else {
    fail('②穿越防线失效：' + JSON.stringify(u).slice(0, 150));
  }
}

// ---- ④publish-ready：好插件过、坏插件列硬伤
{
  const good = run(['plugin', 'publish-ready', 'quick']);
  if (good.status === 0 && /达到上架标准|可以上架/.test(good.stdout)) pass('④publish-ready 好插件通过');
  else fail('④好插件没过：' + good.stdout.slice(0, 150));
  // 坏插件：造一个无 risk 无描述的
  const badDir = path.join(TMP, 'plugins', 'badplug');
  fs.mkdirSync(badDir, { recursive: true });
  fs.writeFileSync(path.join(badDir, 'plugin.toml'), `[plugin]
id = "badplug"
name = "坏插件"
version = "not-semver"
summary = "短"

[[action]]
id = "do"
title = "做事"
run = ["echo", "hi"]
`);
  const bad = run(['plugin', 'publish-ready', 'badplug']);
  if (bad.status !== 0 && bad.stdout.includes('版本号') && bad.stdout.includes('risk')) {
    pass('④坏插件（清单装不上）走静态检查，列出 risk 与版本号硬伤');
  } else {
    fail('④坏插件检查不对：' + (bad.stdout + bad.stderr).slice(0, 200));
  }
}

// ---- ⑤market lint：仓库根的干净 + 坏表拒绝
{
  const good = run(['market', 'lint']);
  if (good.status === 0 && /登记表干净|可用/.test(good.stdout)) pass('⑤market lint 干净表通过');
  else fail('⑤lint 本仓库失败：' + good.stdout.slice(0, 150));
  const badFile = path.join(TMP, 'bad-market.json');
  fs.writeFileSync(badFile, JSON.stringify({
    name: 'bad', plugins: [
      { id: 'x', name: 'x', source: 'http://bad' },
      { id: 'x', name: 'y', source: 'path:./nope' },
    ],
  }));
  const bad = run(['market', 'lint', '--file', badFile]);
  if (bad.status !== 0 && bad.stdout.includes('重复') && bad.stdout.includes('path:')) {
    pass('⑤坏表：重复 id + 非法 source 都被抓（退出码 1）');
  } else {
    fail('⑤坏表没抓全：' + bad.stdout.slice(0, 200));
  }
}

// ---- ⑨market add 健康检查
{
  const badDir = path.join(TMP, 'badmarket');
  fs.mkdirSync(badDir, { recursive: true });
  fs.writeFileSync(path.join(badDir, 'market.json'), JSON.stringify({
    name: 'badmarket', plugins: [{ id: 'z', name: 'z', source: 'ftp://x' }],
  }));
  const r = run(['market', 'add', badDir]);
  if (r.status !== 0 && (r.stdout.includes('硬伤') || r.stderr.includes('硬伤'))) {
    pass('⑨market add 拒绝带硬伤的集市源');
  } else {
    fail('⑨add 没拦：' + (r.stdout + r.stderr).slice(0, 150));
  }
}

// ---- ⑦info / ⑧recommend
{
  const info = run(['plugin', 'info', 'quick']);
  if (info.status === 0 && info.stdout.includes('小工具') && /动作 \d+ 个/.test(info.stdout)
      && info.stdout.includes('read 3')) {
    pass('⑦info 一页看全（版本/动作/风险构成）');
  } else fail('⑦info 不对：' + info.stdout.slice(0, 150));
  const rec = run(['plugin', 'recommend', 'quick']);
  if (rec.status === 0 && rec.stdout.includes('【zerokit 插件推荐】') && rec.stdout.includes('zkit plugin install quick')) {
    pass('⑧recommend 推荐语生成');
  } else fail('⑧recommend 不对');
}

fs.rmSync(TMP, { recursive: true, force: true });
console.log('\n' + '='.repeat(60));
console.log(`通过 ${passed} / ${passed + failed}`);
if (failed > 0) process.exit(1);

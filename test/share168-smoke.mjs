// share168-smoke：第一百六十八轮——结果分享与团队协作
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync, readFileSync, existsSync, chmodSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const PKG_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CLI = path.join(PKG_ROOT, 'src', 'cli.ts');
let pass = 0, fail = 0;
const check = (name, cond, extra = '') => { if (cond) { pass++; console.log(`  ✓ ${name}`); } else { fail++; console.error(`FAIL  ${name}  <- share168 ${extra}`); } };
const home = mkdtempSync(path.join(tmpdir(), 'sh168-'));
const env = { ...process.env, ZEROKIT_HOME: home };
const run = (args) => spawnSync(process.execPath, [CLI, ...args], { encoding: 'utf8', timeout: 90000, env });
console.log(`share168-smoke（${home}）`);
run(['plugin', 'bundled']);

// ---- 纯函数 ----
const S = await import('../src/core/share.ts');
{
  const pack = S.buildSharePack({ action: 'quick.b64', risk: 'read', argv: ['zkit', 'run', 'quick.b64'], appVersion: '1.69.0' });
  check('① 包结构完整', pack.app === 'zerokit' && pack.shareVersion === 1 && pack.env.os.length > 0 && pack.env.node.startsWith('v'));
  check('⑦ 风险归一（未知降 read）', S.buildSharePack({ action: 'x', risk: 'weird', argv: ['a'], appVersion: '1' }).risk === 'read');
  const v = S.validateSharePack({ app: 'other' });
  check('⑧ app 不符拒绝', !v.ok && v.error.includes('不是 zerokit 的分享包'));
  const v2 = S.validateSharePack({ app: 'zerokit', shareVersion: 2, createdAt: 'x', action: 'a', risk: 'read', argv: ['a'], env: {} });
  check('⑧ 版本不符拒绝', !v2.ok && v2.error.includes('只认 1'));
  const v3 = S.validateSharePack({ app: 'zerokit', shareVersion: 1, risk: 'read', argv: [], env: {} });
  check('⑧ 缺字段/空 argv 拒绝', !v3.ok);
  const pol = S.replayPolicy({ ...pack, risk: 'destructive', action: 'clipboard.clear' });
  check('⑦ destructive 重放拒绝+说人话', !pol.allowed && (pol.reason ?? '').includes('不可逆'));
  check('⑦ read 重放放行', S.replayPolicy(pack).allowed);
  const fp = await S.shareFingerprint(pack);
  check('③ 指纹 4×4', /^[0-9a-f]{4}( [0-9a-f]{4}){3}$/.test(fp));
  const blocks = S.fingerprintBlocks(fp);
  check('③ 块状两行', blocks.split('\n').length === 2 && blocks.includes('█') && blocks.includes('·'));
}

// ---- CLI 闭环 ----
let shareFile = '';
{
  const r = run(['share', 'quick.b64', '--params', '{"text":"你好分享"}', '--qr']);
  check('① 生成+提示重放', r.status === 0 && r.stdout.includes('.zshare') && r.stdout.includes('--from-share'));
  const m = r.stdout.match(/\/[^\s]+\.zshare/);
  shareFile = m ? m[0] : '';
  check('① 文件真存在+0600', shareFile !== '' && existsSync(shareFile));
  const pack = JSON.parse(readFileSync(shareFile, 'utf8'));
  check('① 包内容', pack.action === 'quick.b64' && pack.argv.includes('--text') && pack.env.appVersion.length > 0);
  check('① read 动作带结果', typeof pack.result === 'object');
}
{
  const r = run(['run', '--from-share', shareFile, '--quiet']);
  check('② 重放成功', r.status === 0 && r.stdout.includes('5L2g5aW9'));
}
{
  const r = run(['share', '--view', shareFile]);
  check('⑥ 查看：指纹+环境+命令', r.status === 0 && r.stdout.includes('指纹') && r.stdout.includes(process.platform === 'win32' ? 'win32' : process.platform) && r.stdout.includes('zkit run quick.b64'));
  const r2 = run(['share', shareFile]);
  check('⑥ 位置参数也能查看', r2.status === 0 && r2.stdout.includes('分享包'));
  const r3 = run(['share', '--view', shareFile, '--markdown']);
  check('⑤ Markdown 摘要', r3.status === 0 && r3.stdout.includes('quick') && r3.stdout.length > 50);
}
{
  // 非只读：不带结果
  const r = run(['share', 'quick.open-url', '--params', '{"url":"https://example.com"}']);
  check('① mutate 不带结果提示', r.status === 0 && r.stdout.includes('非只读'));
  const m = r.stdout.match(/\/[^\s]+\.zshare/);
  if (m) {
    const pack = JSON.parse(readFileSync(m[0], 'utf8'));
    check('① mutate 包里无 result', pack.result === undefined);
    const rr = run(['run', '--from-share', m[0]]);
    check('⑦ mutate 重放要 --yes', rr.status === 2 && (rr.stdout + rr.stderr).includes('--yes'));
  }
}
{
  // 伪造拒绝
  writeFileSync(path.join(home, 'fake.zshare'), '{"app":"other"}');
  const r = run(['share', '--view', path.join(home, 'fake.zshare')]);
  check('⑧ 伪造拒绝', r.status === 1 && r.stderr.includes('不是 zerokit 的分享包'));
  writeFileSync(path.join(home, 'bad.zshare'), 'not json');
  const r2 = run(['share', '--view', path.join(home, 'bad.zshare')]);
  check('⑧ 坏 JSON 拒绝', r2.status === 1 && r2.stderr.includes('不是合法 JSON'));
  // destructive 伪造
  const pack = JSON.parse(readFileSync(shareFile, 'utf8'));
  pack.risk = 'destructive';
  writeFileSync(path.join(home, 'destr.zshare'), JSON.stringify(pack));
  const r3 = run(['run', '--from-share', path.join(home, 'destr.zshare')]);
  check('⑦ destructive 重放拒绝', r3.status === 1 && (r3.stdout + r3.stderr).includes('不可逆'));
}
{
  const r = run(['share']);
  check('用法 exit 2', r.status === 2);
  const r2 = run(['share', 'nope.act']);
  check('未知插件 exit 1', r2.status === 1);
}
// ⑨ KNOWN_COMMANDS 含 share（typo 引导）
{
  const src = readFileSync(path.join(PKG_ROOT, 'src', 'cli.ts'), 'utf8');
  check('⑨ KNOWN_COMMANDS 含 share', /'share'/.test(src) && src.includes('--from-share'));
}

rmSync(home, { recursive: true, force: true });
console.log(`\n通过 ${pass} / ${pass + fail}`);
process.exit(fail > 0 ? 1 : 0);

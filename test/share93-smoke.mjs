// share93-smoke：第九十三轮——分享与深链闭环
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const PKG_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
let pass = 0, fail = 0;
const check = (name, cond) => { if (cond) { pass++; console.log(`  ✓ ${name}`); } else { fail++; console.error(`FAIL  ${name}  <- share93`); } };

const { encodeDeepLink, deepLinkParams, buildZkresult, parseZkresult, commandWithNote, favNote } = await import('../web/extras.js');
console.log('share93-smoke');

// ①② 深链生成：非 secret 带上、secret 剔除、空值不带、与解析互逆
{
  const fields = [{ name: 'ts', type: 'number' }, { name: 'token', secret: true }, { name: 'note' }];
  const link = encodeDeepLink('quick', 'ts2date', { ts: '1760000000', token: 'SECRET', note: '', extra: true }, fields);
  check('② secret 不进链接', !link.includes('SECRET'));
  check('② 空值不带', !link.includes('note='));
  check('① 形如 #/插件/动作?k=v', /^#\/quick\/ts2date\?ts=1760000000$/.test(link));
  check('① 与 deepLinkParams 互逆', deepLinkParams(link).ts === '1760000000');
}
{
  // 无 fields（拿不到定义时）也绝不该带 token 这种明显 secret 名
  const link2 = encodeDeepLink('p', 'a', { token: 'x', q: 'hi' }, []);
  check('② 无定义时 secret 猜名剔除', !link2.includes('token=') && link2.includes('q=hi'));
}

// ③ 快照信封
{
  const snap = buildZkresult({ ok: true, data: { ip: '1.2.3.4' } }, { plugin: 'ip', action: 'public', title: '公网 IP' }, '0.97.0');
  check('③ 信封字段齐全', snap.app === 'zerokit' && snap.kind === 'zkresult' && snap.version === '0.97.0' && !!snap.savedAt);
  check('③ 动作元数据', snap.action.plugin === 'ip' && snap.action.title === '公网 IP');
  check('③ 结果原样', snap.result.data.ip === '1.2.3.4');
}

// ④⑧ 解析校验四负例一正例
{
  const good = JSON.stringify(buildZkresult({ data: 1 }, {}, '1.0.0'));
  check('④ 合法快照 ok', parseZkresult(good).ok === true);
  check('⑧ 坏 JSON 拒', parseZkresult('{oops').ok === false);
  check('⑧ 非 zerokit 快照拒', parseZkresult(JSON.stringify({ app: 'other', kind: 'zkresult', result: 1, savedAt: new Date().toISOString() })).error.includes('app/kind'));
  check('⑧ 缺 result 拒', parseZkresult(JSON.stringify({ app: 'zerokit', kind: 'zkresult', savedAt: new Date().toISOString() })).ok === false);
  check('⑧ 坏时间戳拒', parseZkresult(JSON.stringify({ app: 'zerokit', kind: 'zkresult', result: 1, savedAt: 'nope' })).ok === false);
}

// ⑦ 命令注释头
{
  check('⑦ 注释头两段', commandWithNote('zkit run quick b64', '快捷工具', 'Base64') === '# 快捷工具 · Base64\nzkit run quick b64');
  check('⑦ 空名不加头', commandWithNote('zkit run x', '', '') === 'zkit run x');
}

// ⑥ 收藏备注
{
  check('⑥ 截 60 字', favNote('x'.repeat(80)).length === 60);
  check('⑥ 空白=无备注', favNote('   ') === '');
}

// ⑨ 静态接线
{
  const app = readFileSync(path.join(PKG_ROOT, 'web', 'app.js'), 'utf8');
  const html = readFileSync(path.join(PKG_ROOT, 'web', 'index.html'), 'utf8');
  const srv = readFileSync(path.join(PKG_ROOT, 'src', 'server.ts'), 'utf8');
  check('⑨ shareBtn 走 encodeDeepLink', app.includes('encodeDeepLink(plugin.id, action.id, vals'));
  check('⑨ 快照导出按钮', app.includes("id=\"snapRes\"") && app.includes('buildZkresult'));
  check('⑨ 导入入口+校验', app.includes('dlImportSnap') && app.includes('parseZkresult') && app.includes('导入失败'));
  check('⑨ 外来快照提示', app.includes('外来快照') && app.includes('重跑将在本机执行'));
  check('⑨ 版本注入链', html.includes('__VERSION__') && srv.includes("replace('__VERSION__', SERVER_VERSION)") && app.includes('__zkVersion'));
  check('⑨ 复制带注释', app.includes('commandWithNote(text'));
}

console.log(`\n通过 ${pass} / ${pass + fail}`);
process.exit(fail > 0 ? 1 : 0);

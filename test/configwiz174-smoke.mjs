// configwiz174-smoke：第一百七十四轮——插件配置向导与校验前移
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { readFileSync } from 'node:fs';

const PKG_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CLI = path.join(PKG_ROOT, 'src', 'cli.ts');
let pass = 0, fail = 0;
const check = (name, cond, extra = '') => { if (cond) { pass++; console.log(`  ✓ ${name}`); } else { fail++; console.error(`FAIL  ${name}  <- configwiz174 ${extra}`); } };
console.log('configwiz174-smoke');

const E = await import('../web/extras.js');
const app = readFileSync(path.join(PKG_ROOT, 'web', 'app.js'), 'utf8');
const html = readFileSync(path.join(PKG_ROOT, 'web', 'index.html'), 'utf8');
const cli = readFileSync(path.join(PKG_ROOT, 'src', 'cli.ts'), 'utf8');
const doctor = readFileSync(path.join(PKG_ROOT, 'src', 'core', 'doctor.ts'), 'utf8');

// ① configProgress
{
  const pr = E.configProgress([
    { name: 'a', title: '甲', required: true, missing: true, set: false },
    { name: 'b', title: '乙', required: false, set: true, missing: false },
    { name: 'c', title: '丙', required: true, missing: false, set: true },
  ]);
  check('① 完成度 N/M', pr.label === '2 / 3 已设置');
  check('① 缺必填名', JSON.stringify(pr.missingRequired) === '["甲"]');
  check('① done=false 有缺口', pr.done === false);
  check('① 全配齐 done=true', E.configProgress([{ name: 'x', title: 'X', required: true, missing: false, set: true }]).done === true);
  check('① 空表 done=false（无配置项不算配齐）', E.configProgress([]).done === false && E.configProgress([]).label === '无配置项');
}
// ⑧ validateSettingInput（与 CLI coerce 同规则）
{
  check('⑧ 必填空串报错', E.validateSettingInput({ name: 'n', title: 'N', required: true }, '').ok === false);
  check('⑧ 非必填空串过', E.validateSettingInput({ name: 'n', title: 'N', required: false }, '').ok === true);
  check('⑧ enum 越界', E.validateSettingInput({ name: 'r', title: '区', enum: ['cn', 'us'] }, 'jp').error.includes('只能是'));
  check('⑧ enum 命中', E.validateSettingInput({ name: 'r', title: '区', enum: ['cn', 'us'] }, 'cn').ok === true);
  check('⑧ 非数字', E.validateSettingInput({ name: 'p', title: '数', type: 'number' }, 'abc').error.includes('数字'));
  check('⑧ min/max', E.validateSettingInput({ name: 'p', title: '数', type: 'integer', min: 1, max: 10 }, '0').error.includes('不能小于')
    && E.validateSettingInput({ name: 'p', title: '数', type: 'integer', min: 1, max: 10 }, '99').error.includes('不能大于'));
  check('⑧ integer 拒小数', E.validateSettingInput({ name: 'p', title: '数', type: 'integer' }, '1.5').ok === false);
  check('⑧ 合法数字过', E.validateSettingInput({ name: 'p', title: '数', type: 'integer', min: 1, max: 10 }, '7').ok === true);
}
// ③ formCanSave
{
  const sts = [
    { name: 'tok', title: '令牌', required: true, secret: true },
    { name: 'reg', title: '区', required: false, enum: ['cn', 'us'] },
  ];
  check('③ 缺必填不可存', E.formCanSave(sts, { tok: '', reg: 'cn' }).canSave === false);
  check('③ enum 错不可存', E.formCanSave(sts, { tok: 'x', reg: 'jp' }).canSave === false);
  check('③ 全过可存', E.formCanSave(sts, { tok: 'x', reg: 'cn' }).canSave === true);
}
// ⑥ 深链
{
  check('⑥ parseConfigHash 命中', E.parseConfigHash('#/config/demosettings') === 'demosettings');
  check('⑥ 拒非法 id', E.parseConfigHash('#/config/../evil') === null);
  check('⑥ 非 config hash 返 null', E.parseConfigHash('#/plugins/sysinfo') === null && E.parseConfigHash('') === null);
}
// 接线
check('applyHash 路由', app.includes('showConfigWiz(ch174)') && app.includes('parseConfigHash(location.hash)'));
check('hashchange 分支', app.includes("parseConfigHash(location.hash)") && app.includes("(location.hash || '') === '#/config'"));
check('① 抽屉入口', html.includes('dlConfig') && app.includes("dlConfig"));
check('④ 走既有端点', app.includes('/api/plugin/config') && !app.includes('/api/config/'));
check('⑤ CLI 深链提示', cli.includes('在启动器里打开表单：#/config/'));
check('⑦ doctor 深链', doctor.includes('#/config/'));

// CLI 实跑：demosettings 的 list 带提示
const home = mkdtempSync(path.join(tmpdir(), 'cw174-'));
const run = (args) => spawnSync(process.execPath, [CLI, ...args], { encoding: 'utf8', timeout: 60000, env: { ...process.env, ZEROKIT_HOME: home } });
run(['plugin', 'bundled']);
{
  const r = run(['config', 'demosettings', 'list']);
  check('⑤ CLI 实跑含深链', (r.stdout || '').includes('#/config/demosettings'), (r.stdout || r.stderr).slice(0, 120));
}
// doctor 含深链（demosettings 缺必填时）
{
  const r = run(['doctor']);
  check('⑦ doctor 实跑含深链', (r.stdout + r.stderr).includes('#/config/demosettings') || !(r.stdout + r.stderr).includes('缺少必填设置项') || (r.stdout).includes('#/config/'), '');
}

rmSync(home, { recursive: true, force: true });
console.log(`\n通过 ${pass} / ${pass + fail}`);
process.exit(fail > 0 ? 1 : 0);

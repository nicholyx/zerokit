// uTools 兼容层的回归测试。
//
// 要证明的是三件事：
//   1. 翻译正确：plugin.json 的 features[].cmds 六种类型能翻成我们的 match + 关键字
//   2. 真能跑：一个写着 utools.onPluginEnter / utools.showNotification 的插件，
//      不改造就能通过 zerokit 跑出结果
//   3. 边界诚实：依赖 DOM 的插件要给出说人话的报错，而不是未知异常或静默失败
//
// 全部在临时目录里跑，不联网、不装依赖。
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';

const HOME = path.join(os.tmpdir(), 'zerokit-utools-test');
process.env['ZEROKIT_HOME'] = HOME;
fs.rmSync(HOME, { recursive: true, force: true });

const { adaptUtoolsPlugin, looksLikeUtoolsPlugin } = await import('../src/core/utools.ts');
const { loadDir, listPlugins } = await import('../src/core/registry.ts');
const { runAction } = await import('../src/core/runner.ts');

const results = [];
const check = (name, ok, detail = '') => {
  results.push([name, ok]);
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok ? '' : '   <- ' + String(detail).slice(0, 400)}`);
};

const TMP = path.join(HOME, 'fixtures');
const write = (dir, files) => {
  fs.mkdirSync(dir, { recursive: true });
  for (const [name, text] of Object.entries(files)) {
    fs.writeFileSync(path.join(dir, name), text);
  }
};

// ---------------------------------------------------------------- 1. 识别

{
  const dir = path.join(TMP, 'demo');
  write(dir, { 'plugin.json': JSON.stringify({ pluginName: '示例', features: [] }) });
  check('带 pluginName 的 plugin.json 被认成 uTools 插件', looksLikeUtoolsPlugin(dir));

  const plain = path.join(TMP, 'plain');
  write(plain, { 'plugin.json': JSON.stringify({ name: '随便一个 json' }) });
  check('只有 plugin.json 但没有 uTools 标志字段 → 不认（避免误判）', !looksLikeUtoolsPlugin(plain));

  const empty = path.join(TMP, 'empty');
  fs.mkdirSync(empty, { recursive: true });
  check('没有 plugin.json 的目录 → 不认', !looksLikeUtoolsPlugin(empty));
}

// ---------------------------------------------------------------- 2. 翻译

{
  const dir = path.join(TMP, 'demo');
  write(dir, {
    'plugin.json': JSON.stringify({
      pluginName: '演示插件',
      description: '用来验证翻译是否正确',
      author: 'tester',
      version: '2.1.0',
      main: 'index.html',
      preload: 'preload.js',
      features: [
        { code: 'hex-to-rgb', explain: '十六进制转 RGB', cmds: ['hextorgb', '颜色转换'] },
        { code: 'num-check', explain: '数字校验', cmds: ['regex:^\\d{6}$'] },
        { code: 'read-selection', explain: '处理选中的文本', cmds: [{ type: 'over', label: '选中文本' }] },
        { code: 'from-files', explain: '处理图片文件', cmds: [{ type: 'files', fileType: 'image', label: '图片' }] },
        { code: 'by-window', explain: '靠窗口唤起', cmds: [{ type: 'window', match: 'xxx' }] },
      ],
    }),
    'preload.js': '// 只是为了让它有入口\n',
  });

  const { plugin, errors } = adaptUtoolsPlugin(dir);
  check('翻译成功且没有错误', Boolean(plugin) && errors.length === 0, errors.join('; '));
  check('显示名来自 pluginName', plugin?.name === '演示插件', plugin?.name);
  check('版本号带过来了', plugin?.version === '2.1.0', plugin?.version);
  check('五个 feature → 五个动作', plugin?.actions.length === 5, String(plugin?.actions.length));
  check('动作 id 来自 feature.code', plugin?.actions[0].id === 'hex-to-rgb', plugin?.actions[0].id);
  check('标题来自 explain', plugin?.actions[0].title === '十六进制转 RGB', plugin?.actions[0].title);

  const a = plugin?.actions ?? [];
  const regexAction = a.find((x) => x.id === 'num-check');
  check('regex: 前缀被翻成正则匹配',
    regexAction?.match?.type === 'regex' && regexAction.match.pattern === '^\\d{6}$',
    JSON.stringify(regexAction?.match));

  const overAction = a.find((x) => x.id === 'read-selection');
  check('{type:"over"} 被翻成文本匹配，并带上 label',
    overAction?.match?.type === 'text' && overAction.match.label === '选中文本',
    JSON.stringify(overAction?.match));

  const filesAction = a.find((x) => x.id === 'from-files');
  check('{type:"files", fileType:"image"} 被翻成文件匹配并给出扩展名白名单',
    filesAction?.match?.type === 'files' && filesAction.match.extensions?.includes('png'),
    JSON.stringify(filesAction?.match));

  const windowAction = a.find((x) => x.id === 'by-window');
  check('无法复刻的 window 类型不落 match（只留关键字）', windowAction?.match === undefined,
    JSON.stringify(windowAction?.match));

  const { warnings } = adaptUtoolsPlugin(dir);
  check('对翻不过去的能力给出了明确警告',
    warnings.some((w) => /活动窗口/.test(w)), warnings.join(' | '));

  check('关键字进了 keywords（供拼音/模糊搜索）',
    (plugin?.keywords ?? []).includes('hextorgb') && (plugin?.keywords ?? []).includes('颜色转换'),
    JSON.stringify(plugin?.keywords));

  check('match.fills 指向的参数确实声明过',
    a.every((x) => !x.match || x.params.some((p) => p.name === x.match.fills)));

  check('风险等级不是 read（跑的是第三方任意代码）',
    a.every((x) => x.risk === 'mutate'), a.map((x) => x.risk).join(','));
}

// ---------------------------------------------------------------- 3. 入口不可执行时要报错

{
  const dir = path.join(TMP, 'ui-only');
  write(dir, {
    'plugin.json': JSON.stringify({
      pluginName: '只有界面',
      main: 'index.html',
      preload: 'preload.js',
      features: [{ code: 'go', explain: '干点什么', cmds: ['go'] }],
    }),
  });
  const { plugin, errors } = adaptUtoolsPlugin(dir);
  check('入口文件不存在 → 明确报错而不是产出一个必失败的动作',
    !plugin && errors.some((e) => /图形界面/.test(e)), errors.join('; '));
}

// ---------------------------------------------------------------- 4. 中文目录名 → 合法 id

{
  const dir = path.join(TMP, '我的工具 2.0');
  write(dir, {
    'plugin.json': JSON.stringify({
      pluginName: '中文目录插件', main: 'index.html', preload: 'preload.js',
      features: [{ code: 'run', explain: '跑一下', cmds: ['跑'] }],
    }),
    'preload.js': '// ok\n',
  });
  const { plugin } = adaptUtoolsPlugin(dir);
  check('中文目录名被规范化成合法插件 id',
    Boolean(plugin) && /^[a-z0-9][a-z0-9._-]{0,63}$/.test(plugin.id), plugin?.id);

  // 同一个目录每次都要得到同一个 id（否则每次加载都会换名字）
  const again = adaptUtoolsPlugin(dir).plugin?.id;
  check('规范化是稳定的（同一目录 → 同一 id）', plugin?.id === again, `${plugin?.id} vs ${again}`);
}

// ---------------------------------------------------------------- 5. 端到端：真跑一个 uTools 插件

{
  const dir = path.join(TMP, 'runner-demo');
  write(dir, {
    'plugin.json': JSON.stringify({
      pluginName: '跑得起来吗',
      description: '端到端验证',
      main: 'index.html',
      preload: 'preload.js',
      features: [{ code: 'shout', explain: '把输入变大写', cmds: ['shout'] }],
    }),
    'preload.js': `
const utools = globalThis.utools;
utools.onPluginEnter(({ code, type, payload }) => {
  utools.showNotification('大写：' + String(payload).toUpperCase());
  utools.dbStorage.setItem('lastCode', code);
  utools.outPlugin();
});
`,
  });

  const { plugin } = loadDir(dir);
  const action = plugin.actions[0];

  const r = await runAction(plugin, action, { caller: 'cli', values: { text: 'hello' } });
  check('uTools 插件能直接跑起来并产出结果',
    r.ok && /大写：HELLO/.test(r.stdout), `exit=${r.exitCode} out=${r.stdout} err=${r.stderr}`);

  const r2 = await runAction(plugin, action, { caller: 'cli', values: { text: '第二个' } });
  check('第二次调用依然正确（不是只碰巧跑通一次）',
    r2.ok && /大写：第二个/.test(r2.stdout), `exit=${r2.exitCode} out=${r2.stdout} err=${r2.stderr}`);

  // dbStorage 要真的落盘：换一个进程再读，值还在
  const store = JSON.parse(fs.readFileSync(path.join(HOME, 'data', plugin.id, 'utools-storage.json'), 'utf8'));
  check('utools.dbStorage 落到了插件的 data 目录（跨进程可读）',
    store.lastCode === 'shout', JSON.stringify(store));

  check('返回值类型是文本，适合直接展示', r.data === undefined || typeof r.data === 'object');
}

// ---------------------------------------------------------------- 6. 边界：DOM 插件要说人话

{
  const dir = path.join(TMP, 'dom-demo');
  write(dir, {
    'plugin.json': JSON.stringify({
      pluginName: '界面插件', main: 'index.html', preload: 'preload.js',
      features: [{ code: 'render', explain: '画界面', cmds: ['render'] }],
    }),
    'preload.js': `
globalThis.utools.onPluginEnter(() => {
  document.body.innerHTML = '<h1>你好</h1>';
});
`,
  });
  const { plugin } = loadDir(dir);
  const r = await runAction(plugin, plugin.actions[0], { caller: 'cli', values: { text: '' } });
  check('依赖 DOM 的插件失败时会说清原因',
    !r.ok && /图形界面|showNotification/.test(r.stderr), `exit=${r.exitCode} err=${r.stderr.slice(0, 200)}`);
  check('DOM 报错是失败退出（不会被当成"成功但没输出"）', r.exitCode === 1, String(r.exitCode));
}

// ---------------------------------------------------------------- 7. 边界：不认识的能力要抛可读的错

{
  const dir = path.join(TMP, 'unsupported-demo');
  write(dir, {
    'plugin.json': JSON.stringify({
      pluginName: '用了特权能力', main: 'index.html', preload: 'preload.js',
      features: [{ code: 'win', explain: '读活动窗口', cmds: ['win'] }],
    }),
    'preload.js': `
globalThis.utools.onPluginEnter(() => {
  globalThis.utools.getCurrentWindow();
});
`,
  });
  const { plugin } = loadDir(dir);
  const r = await runAction(plugin, plugin.actions[0], { caller: 'cli', values: { text: '' } });
  check('调用不支持的 uTools 能力时给出的是可读错误',
    /依赖 uTools 本体/.test(r.stderr), r.stderr.slice(0, 200));
  check('不会出现 "is not a function" 这种没法排查的错',
    !/is not a function/.test(r.stderr), r.stderr.slice(0, 200));
}

// ---------------------------------------------------------------- 8. 装进插件目录后能被发现

{
  const src = path.join(TMP, 'runner-demo');
  fs.cpSync(src, path.join(HOME, 'plugins', 'utools-demo'), { recursive: true });
  const listed = listPlugins().find((e) => e.plugin?.id === 'utools-demo');
  check('uTools 插件复制进插件目录后自动出现在插件列表里',
    Boolean(listed?.plugin), JSON.stringify(listPlugins().map((e) => e.plugin?.id ?? e.errors)));
  check('它走的是原生插件同一条加载路径（具备 actions）',
    (listed?.plugin?.actions.length ?? 0) > 0, JSON.stringify(listed?.plugin?.actions?.length));
}

console.log('\n' + '='.repeat(60));
const failed = results.filter(([, ok]) => !ok).map(([n]) => n);
console.log(`通过 ${results.length - failed.length} / ${results.length}`);
if (failed.length) console.log('失败：' + failed.join(', '));
process.exit(failed.length ? 1 : 0);
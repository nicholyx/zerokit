#!/usr/bin/env node
/** demoweb：桥能力演示板的数据源。纯计算零依赖。 */
import { ok, err } from '../_vendor/zkutil.mjs';

const [,, cmd] = process.argv;

try {
  if (cmd === 'board') {
    ok({
      title: 'zkit 桥能力演示',
      generatedAt: new Date().toISOString(),
      items: [
        { id: 'context', label: '执行上下文', hint: 'zkit.ready((ctx) => ...) 拿到动作与结果' },
        { id: 'appearance', label: '外观跟随', hint: 'var(--zk-accent) / [data-zk-dark] 自动跟上宿主' },
        { id: 'run', label: '深链执行', hint: 'zkit.run("now") 调本插件其它动作' },
        { id: 'nav', label: '受控跳转', hint: 'zkit.openLink(url) 宿主确认后开系统浏览器' },
        { id: 'resize', label: '自适应高度', hint: 'zkit.setHeight(px) 报告内容高度' },
        { id: 'error', label: '错误上报', hint: 'zkit.reportError(e) 白屏也看得见原因' },
      ],
    });
  } else if (cmd === 'now') {
    ok({ now: new Date().toISOString() });
  } else if (cmd === 'ping') {
    ok({ pong: true, at: new Date().toISOString() });
  } else {
    err(`未知子命令：${cmd}`); process.exitCode = 1;
  }
} catch (e) {
  err(e?.message ?? e); process.exitCode = 1;
}

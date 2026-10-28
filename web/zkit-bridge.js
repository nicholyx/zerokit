// zerokit 插件页面桥：把 window.zkit 注入到 render = "web" 的插件页面里。
// 由内核在托管 /p/<插件id>/ 时自动注入（<head> 里第一个 script），插件作者不用引任何东西。
//
// 通信只有 postMessage 一条路——这是刻意的安全边界：
//   页面跑在 sandbox iframe（无 allow-same-origin）里，是 opaque origin，
//   拿不到会话令牌、fetch 不了宿主 API。要执行动作只能请宿主转发，
//   宿主那边照常走确认弹窗，插件页面绕不过去。
//
// 消息协议（双向都带 __zkit: true，防和页面上别的 postMessage 混线）：
//   页面 → 宿主：hello（页面就绪，请求上下文）/ run（执行动作）/ resize（报告高度）
//   宿主 → 页面：context（动作 + 参数 + 执行结果）/ run:result（run 的应答，按 callId 配对）

(function () {
  'use strict';

  var pending = {};      // callId -> { resolve, reject }
  var context = null;    // 最近一次收到的执行上下文
  var readyCallbacks = [];
  var navCallbacks = {}; // url -> resolve（受控跳转的放行回执）
  var hosted = false;
  var callSeq = 0;

  function send(msg) {
    // targetOrigin 用 '*'：sandbox 页面是 opaque origin（序列化为 "null"），
    // 没有具体源可写。消息里不含任何敏感内容——令牌永远不会进桥。
    window.parent.postMessage(Object.assign({ __zkit: true }, msg), '*');
  }

  function onMessage(ev) {
    var msg = ev.data;
    if (!msg || msg.__zkit !== true) return;
    if (msg.type === 'context') {
      context = msg.payload || null;
      if (context && context.appearance) applyAppearance(context.appearance);
      var cbs = readyCallbacks;
      readyCallbacks = [];
      cbs.forEach(function (cb) { try { cb(context); } catch (e) { /* 页面自己的回调挂了不关桥的事 */ } });
    } else if (msg.type === 'run:result') {
      var p = pending[msg.callId];
      if (!p) return;
      delete pending[msg.callId];
      var payload = msg.payload || {};
      if (payload.ok) p.resolve(payload);
      else p.reject(new Error(payload.error || '执行失败'));
    } else if (msg.type === 'nav:allowed') {
      var cb = navCallbacks[msg.url];
      if (cb) { delete navCallbacks[msg.url]; cb(); }
    }
  }

  // ---------------- 外观跟随（第四十四轮）----------------
  // 宿主在 context 里带 appearance（dark/accent/fontScale/lang）。
  // 页面不用任何配置就能跟上宿主皮肤：桥把 CSS 变量写到根元素上，
  // 页面样式里用 var(--zk-accent) / [data-zk-dark] 即可；不感兴趣也完全无感。

  function applyAppearance(ap) {
    try {
      var root = document.documentElement;
      root.style.setProperty('--zk-accent', String(ap.accent || '#2271f0'));
      root.setAttribute('data-zk-dark', ap.dark ? '1' : '0');
      root.setAttribute('data-zk-font', String(ap.fontScale || 'm'));
      root.setAttribute('data-zk-lang', String(ap.lang || 'system'));
      // 字号：宿主是小/中/大三档，映射成根 font-size 比例
      var scale = { s: '90%', m: '100%', l: '115%' }[ap.fontScale] || '100%';
      root.style.fontSize = scale;
    } catch (e) { /* 页面环境异常时静默降级——外观是锦上添花，不能砸了页面 */ }
  }

  window.addEventListener('message', onMessage);

  hosted = window.parent !== window;
  if (hosted) {
    // 主动握手：宿主收到 hello 才发 context（宿主在 iframe onload 时也会补发一次，双保险）
    send({ type: 'hello' });
  }

  /** 宿主给的执行上下文：{ plugin, action, params, result } */
  function getContext() { return context; }

  /** 不在启动器里裸开页面时（比如直接浏览器打开 /p/<id>/），能力降级要说清楚 */
  function notHosted() {
    return Promise.reject(new Error(
      '这个页面不在 zerokit 启动器里运行。请从启动器执行对应动作，或用 zkit web <插件id> 打开。'));
  }

  var api = {
    /** 是否运行在 zerokit 启动器（宿主 iframe）里 */
    get hosted() { return hosted; },
    /** 最近一次的执行上下文；宿主还没发来时是 null */
    get context() { return getContext(); },
    /** 上下文就绪后回调（已就绪则立即回调）。返回 this 以便链式调用风格 */
    ready: function (cb) {
      if (typeof cb !== 'function') return api;
      if (context) { cb(context); return api; }
      readyCallbacks.push(cb);
      return api;
    },
    /**
     * 调用**本插件**的另一个动作（桥绑死了插件，不能跨插件）。
     * 有副作用的动作照常走宿主的确认弹窗——页面代替不了用户点头。
     */
    run: function (action, values) {
      if (!hosted) return notHosted();
      var callId = 'c' + (++callSeq) + '_' + Date.now().toString(36);
      return new Promise(function (resolve, reject) {
        pending[callId] = { resolve: resolve, reject: reject };
        send({ type: 'run', callId: callId, action: action, values: values || {} });
        // 宿主 5 分钟不应答（确认弹窗一直没人理）就放弃，别让页面悬死
        setTimeout(function () {
          if (pending[callId]) {
            delete pending[callId];
            reject(new Error('等待宿主执行超时（确认弹窗一直没人理？）'));
          }
        }, 5 * 60 * 1000);
      });
    },
    /** 告诉宿主实际内容高度，宿主据此调整 iframe（上限由宿主决定） */
    setHeight: function (px) {
      if (!hosted) return;
      var n = Math.max(0, Math.round(Number(px) || 0));
      send({ type: 'resize', height: n });
    },
    /**
     * 受控跳转（第四十四轮）：sandbox iframe 里 target=_blank 本来就开不了，
     * 走这里宿主确认后替页面开系统浏览器。宿主只放行 http(s)，
     * 并弹确认（防钓鱼：用户看得见要开哪）。确认后回调触发。
     */
    openLink: function (url) {
      if (!hosted) return notHosted();
      return new Promise(function (resolve, reject) {
        var u = String(url);
        if (!/^https?:\/\//i.test(u)) { reject(new Error('openLink 只接受 http(s) 链接')); return; }
        navCallbacks[u] = resolve;
        send({ type: 'nav', url: u });
        setTimeout(function () {
          if (navCallbacks[u]) { delete navCallbacks[u]; reject(new Error('宿主没有放行这次跳转')); }
        }, 60 * 1000);
      });
    },
    /**
     * 宿主外观（dark/accent/fontScale/lang）。context 到达前是 null；
     * 变化时如果宿主重发 context 会自动更新。
     */
    get appearance() { return (context && context.appearance) || null; },
    /**
     * 页面把致命错误报给宿主（第四十四轮）：宿主在状态行显示，
     * 用户至少知道页面为什么白屏，而不是静默挂掉。
     */
    reportError: function (e) {
      if (!hosted) return;
      send({ type: 'error', error: String((e && e.message) || e).slice(0, 200) });
    },
  };

  window.zkit = api;

  // CommonJS 导出：给 node 侧测试用（浏览器里没有 module，跳过）
  if (typeof module === 'object' && module.exports) module.exports = api;
})();

// web/watchtimers.js —— 监控/定时域（第 245 轮 v4 清债第五步：从 app.js 注入式迁出）
// 14 个函数（7 主 + 7 支撑）整域迁出——内聚后注入面最小。
import { intervalLabel, watchCsv, watchStopCondition, fmtElapsed, exportFilename, exportMime, classifyError, pickLang, nextRunLabel, inWindow, shouldCatchUp, trimHistory, exportTimers, parseTimersPack } from './extras.js';

export function createWatchTimers(ui) {
  const { esc, t, lang, api, TOKEN, el, setCount, hidePanels, panelDescBar, actionKey, paramStore, submit, openDetail, readJson, writeJson, renderResult, modeRef, watchStopLogRef, panelsRef, renderQuietSection } = ui;

/** 第十轮②：定时任务面板——列出所有在跑的 interval，一键停。 */
function timerRegistry() {
  if (!window.__zkTimers) window.__zkTimers = {};
  return window.__zkTimers;
}

/** 监控注册表：key = actionKey，value = { interval, failStreak, matchStr, samples[], title, deadline } */
function watchRegistry() {
  if (!window.__zkWatch) window.__zkWatch = {};
  return window.__zkWatch;
}

/* ===== 第七十九轮①②⑤：监控配置持久化（watch.json，数据目录）=====
 * 谁写：浏览器（只有浏览器知道 samples/changes 的实时状态）；
 * 何时写：每次采样后 + 停止时（增量小写）；server 只做透传存储。
 * 恢复：boot 时 GET /api/watch 读回——只恢复配置与最近 samples，
 * 调度链重建（deadline 按 interval 重算），不回放历史执行。 */
async function persistWatch() {
  try {
    const reg = watchRegistry();
    const stops = readJson('zerokit.watch-stops', []);
    const body = {
      version: 1,
      watches: Object.entries(reg).map(([key, w]) => ({
        key,
        interval: w.interval, failStreak: w.failStreak, matchStr: w.matchStr,
        title: w.title, pluginId: w.pluginId, actionId: w.actionId,
        runs: w.runs, changes: w.changes, notify: w.notify !== false,
        ...(w.chain ? { chain: w.chain } : {}),                                // 295①：触发的 chain
        ...(w.lastChainRun ? { lastChainRun: w.lastChainRun } : {}),            // 295③：最近一次触发结果
        samples: (w.samples ?? []).slice(-10),
      })),
      stops: stops.slice(-20),
    };
    await fetch('/api/watch', {
      method: 'PUT',
      headers: { 'content-type': 'application/json', 'x-zerokit-token': TOKEN },
      body: JSON.stringify(body),
    });
  } catch { /* 持久化失败不影响监控本身 */ }
}

function updateWatchTitle() {
  // ⑦ 标签页标题带上监控数（与运行中进程数合并；fetchPs 也会写 title，两边都调这个）
  const n = Object.keys(watchRegistry()).length;
  const running = Number((document.title.match(/^\((\d+)\)/) ?? [])[1] ?? 0);
  announceTitle(n, running);
}

function stopWatch(key) {
  const reg = watchRegistry();
  const w = reg[key];
  if (!w) return;
  clearTimeout(w.timerId);
  clearInterval(w.timerId);
  delete reg[key];
  updateWatchTitle();
}

/** 间隔调度：用 setTimeout 链而不是 setInterval——执行耗时不会让两次采样叠在一起 */
function scheduleWatch(key, sec) {
  const reg = watchRegistry();
  const w = reg[key];
  if (!w) return;
  w.timerId = setTimeout(async () => {
    const cur = detail && actionKey(detail.plugin.id, detail.action.id) === key;
    const onPanel = mode === 'watch'; // 监控面板盯着它跑：不算「翻页」
    if (!cur && !onPanel) { // 真翻页了（别的动作/列表）：停掉（① 翻页自动停）
      stopWatch(key);
      renderWatchBar();
      return;
    }
    const prev = lastResult;
    await submit(false).catch(() => {});
    const now = lastResult;
    w.runs += 1;
    if (w.runs > 1 && prev && now && JSON.stringify(prev.data) !== JSON.stringify(now.data)) {
      w.changes += 1;
      notifyWatchChange(w, prev, now);
    }
    w.samples.push({ ts: Date.now(), ok: now?.ok === true, data: now?.data, err: now?.ok === true ? undefined : String(now?.error ?? '') });
    if (w.samples.length > 30) w.samples.shift();
    // 295②③：watch 触发 chain 管道——数据变化且声明了 chain 时自动执行（无人值守数据流）
    const changed = w.runs > 1 && prev && now && JSON.stringify(prev.data) !== JSON.stringify(now.data);
    if (w.chain && changed) {
      // 295②：静默执行声明的 chain（/api/run 同款信封；key = "插件.动作"）
      const dot = w.chain.lastIndexOf('.');
      const cp = dot > 0 ? w.chain.slice(0, dot) : '';
      const ca = dot > 0 ? w.chain.slice(dot + 1) : '';
      try {
        const r = await runChainQuiet(cp, ca);
        w.lastChainRun = { ok: r?.ok === true, ts: Date.now(), key: w.chain };
      } catch (e) {
        w.lastChainRun = { ok: false, ts: Date.now(), key: w.chain, err: String(e?.message ?? e).slice(0, 80) };
      }
      void persistWatch();
    }
    void persistWatch(); // ① 增量持久化：浏览器写、server 透传
    // ⑤ 停止条件
    const stop = watchStopCondition(
      w.samples.map((s) => ({ ok: s.ok, data: s.data })),
      { failStreak: w.failStreak, matchStr: w.matchStr },
    );
    if (stop) {
      stopWatch(key);
      renderWatchBar();
      // 第四十八轮⑧：自动停带失败原因摘要——最近一次失败给分类，不只「已停」
      const lastBad = [...w.samples].reverse().find((sm) => !sm.ok);
      const why = stop === 'stop-fail'
        ? (lastBad ? `（最近失败：${classifyError(lastBad.err ?? '', I18N[pickLang(lang)]).title}）` : '')
        : `（命中停止串「${w.matchStr}」）`;
      w.stopReason = `${stop === 'stop-fail' ? t('watchAutoFail')(w.failStreak) : t('watchAutoMatch')}${why}`;
      watchStopLogRef().push(w.stopReason);
      // ⑤ 停止记录持久化（原因+时间），导入导出带着走
      const stops = readJson('zerokit.watch-stops', []);
      stops.push({ ts: Date.now(), key, reason: w.stopReason });
      if (stops.length > 20) stops.shift();
      writeJson('zerokit.watch-stops', stops);
      void persistWatch();
      if (watchStopLogRef().length > 5) watchStopLogRef().shift();
      setCount(w.stopReason);
      if (mode === 'watch') showWatchPanel();   // 正看着面板就刷新摘要
      return;
    }
    w.deadline = Date.now() + sec * 1000;
    if (mode === 'watch') liveRefreshWatchPanel(); // 第一百三十三轮①②：面板盯盘时数据行节流自刷新
    renderWatchBar();
    scheduleWatch(key, sec);
  }, sec * 1000);
}

function notifyWatchChange(w, prev, next) {
  try {
    if (w.notify === false) return; // ③ 单监控通知关：连记录都不进（用户明确不要）
    const now = Date.now();
    const kind = ((w.samples ?? []).filter((sm) => !sm.ok).length >= 1 && next && next.ok !== true) ? 'alert' : 'change';
    // ⑤ 节流：同一监控 5 分钟内只弹一次（面板计数照记）
    const th = notifyThrottle(notifyLastAt[w.title] ?? NaN, now, 5 * 60 * 1000);
    const suppressed = !th.allow;
    notifyLastAt[w.title] = th.at;
    // ④ 静默时段：免打扰内不弹系统通知（面板记一笔 kind:'quiet'）
    const q = readJson('zerokit.quiet', { on: false, start: '22:00', end: '07:00' });
    const qStart = parseHm(q.start) ?? 1320, qEnd = parseHm(q.end) ?? 420;
    const d = new Date(now);
    const quietNow = q.on === true && inQuietHours(d.getHours() * 60 + d.getMinutes(), qStart, qEnd);
    // ⑥ 通知记录（无论弹没弹都记：quiet/throttled 状态可追溯）
    notifyLog = pushNotifyLog(notifyLog, {
      ts: now, key: w.title, kind: quietNow ? 'quiet' : kind,
      note: quietNow ? '静默时段，未弹出' : suppressed ? '节流合并，未弹出' : (kind === 'alert' ? '连续失败告警' : '结果有变化'),
      changes: w.changes,
    });
    persistNotifyLog();
    renderWatchBar(); // 记录小节在监控条/面板上——轻量重画
    if (quietNow || suppressed) return;
    if (!('Notification' in window) || Notification.permission !== 'granted') {
      // ① 降级：无权限时面板 toast（el.count 复用——通知中心不可用不该静默）
      setCount(`⇄ ${w.title} ${kind === 'alert' ? '连续失败' : '结果有变化'}（第 ${w.changes} 次）`);
      return;
    }
    // ② 通知点击跳监控面板
    const goWatch = () => { location.hash = '#/watch'; };
    if (kind === 'alert') {
      let failStreakNow = 0;
      for (let i = (w.samples ?? []).length - 1; i >= 0; i--) { if (!w.samples[i].ok) failStreakNow++; else break; }
      const n = new Notification(t('watchAlertTitle'), {
        body: `⚠ ${w.title} 连续失败 ${failStreakNow} 次`,
        tag: `zk-watch-alert-${w.title}`,
      });
      n.onclick = goWatch;
      return;
    }
    const n2 = new Notification(t('watchNotifyTitle'), {
      body: `⇄ ${w.title} 结果有变化（第 ${w.changes} 次）`,
      tag: `zk-watch-${w.title}`,
    });
    n2.onclick = goWatch;
  } catch { /* 通知失败不影响监控 */ }
}

/** 第一百三十三轮①②：面板数据区节流自刷新——只替换 runs/changes/上次变化/点阵/通知记录，
 * 不重建整个面板（用户 hover/滚动/焦点不受打扰——⑧）。 */
function liveRefreshWatchPanel() {
  if (modeRef.get() !== 'watch') return;
  const now = Date.now();
  watchPanelDirty = now;
  if (watchPanelTimer) return;
  watchPanelTimer = setTimeout(() => {
    watchPanelTimer = 0;
    if (modeRef.get() !== 'watch') return; // 离开了就不再画
    if (Date.now() - watchPanelDirty < 1900) { // 距上次标记不足 2s：再等一会
      watchPanelTimer = setTimeout(liveRefreshWatchPanel, 2000 - (Date.now() - watchPanelDirty));
      return;
    }
    // 只更新已有行的动态字段（不重建 DOM——⑧ 不打断交互）
    const reg = watchRegistry();
    document.querySelectorAll('.watch-row').forEach((row) => {
      const k = row.querySelector('[data-wnotify]')?.getAttribute('data-wnotify');
      const w = k ? reg[k] : undefined;
      if (!w) return;
      const sub = row.querySelector('.sub');
      if (sub) sub.textContent = `${w.runs} 次采样 · ${w.changes} 次变更${w.changes > 0 && w.samples.length ? ' · 上次变化 ' + relTime(w.samples.at(-1)?.ts ?? Date.now()) : ''}${w.chain ? ` · ⛓ ${esc(w.chain)} ${w.lastChainRun ? (w.lastChainRun.ok ? '✓' : '✗') : '（待触发）'}` : ''}`;
      // ④ sparkline 点阵（最近 10 次成败）
      let spark = row.querySelector('.watch-spark');
      if (!spark) { spark = document.createElement('span'); spark.className = 'watch-spark'; row.querySelector('.watch-summary')?.after(spark); }
      spark.innerHTML = (w.samples ?? []).slice(-10).map((sm) => `<i class="${sm.ok ? 'ok' : 'bad'}"></i>`).join('');
      spark.title = '最近 10 次采样（红=失败）';
    });
    // ② 通知记录小节即时更新
    const notifyBox = document.querySelector('.watch-notify');
    if (notifyBox) {
      const tmp = document.createElement('div');
      tmp.innerHTML = panelsRef().renderNotifySection();
      notifyBox.replaceWith(tmp.firstElementChild ?? notifyBox);
    }
  }, 2000);
}

function showWatchPanel() {
  hidePanels();
  modeRef.set('watch');
  el.modeLabel.textContent = t('modeWatch');
  el.listView.classList.add('hidden');
  el.detailView.classList.add('hidden');
  if (location.hash !== '#/watch') history.replaceState(null, '', '#/watch');
  const reg = watchRegistry();
  const rows = Object.entries(reg).map(([k, w]) => {
    const lastOk = w.samples.at(-1)?.ok !== false;
    // 第二百二十六轮②⑤：失败原因 + 三态徽标（运行/失败/暂停）
    const lastSample = w.samples.at(-1);
    const failReason = !lastOk && lastSample?.error ? String(lastSample.error).slice(0, 120) : '';
    const stateMark = w.paused ? '⏸ 暂停' : lastOk ? '⏱ 运行中' : '✗ 连续失败';
    const stateCls = w.paused ? '' : lastOk ? 'read' : 'bad';
    const summary = w.samples.length
      ? `最近：${JSON.stringify(lastSample?.data ?? '').slice(0, 80)}`
      : '等待第一次采样…';
    return `
    <div class="run-row watch-row">
      <span class="badge ${stateCls}">${stateMark}</span>
      <span class="run-when">${esc(w.title)}（每 ${esc(intervalLabel(w.interval))}）</span>
      <span class="sub">${w.runs} 次采样 · ${w.changes} 次变更${w.changes > 0 && w.samples.length ? ' · 上次变化 ' + relTime(lastSample?.ts ?? Date.now()) : ''}</span>
      <span class="watch-spark">${(w.samples ?? []).slice(-10).map((sm) => `<i class="${sm.ok ? 'ok' : 'bad'}"${Number.isFinite(sm.ms) ? ` title="${esc(relTime(sm.ts))} · 耗时 ${fmtElapsed(sm.ms)}"` : ''}></i>`).join('')}</span>
      <span class="watch-summary">${esc(summary)}</span>
      ${failReason ? `<span class="bad watch-fail-reason">失败原因：${esc(failReason)}</span>` : ''}
      ${w.stopReason ? `<span class="bad">${esc(w.stopReason)}</span>` : ''}
      <span class="watch-interval-row"><label class="sub">改间隔</label><input class="watch-interval-input" data-winterval="${esc(k)}" type="number" min="5" value="${w.interval}" aria-label="轮询间隔秒">秒<button class="ghost mini" data-winterval-save="${esc(k)}">改</button></span>
      <button class="ghost mini" data-wnotify="${esc(k)}" title="变化时是否弹通知">${w.notify === false ? '通知关' : '通知开'}</button>
      <button class="ghost mini" data-wstop="${esc(k)}">停止</button>
      <button class="ghost mini" data-wcsv="${esc(k)}">导出 CSV</button>
      <button class="ghost mini" data-wmd="${esc(k)}" data-ai="1" title="${esc(t('tlWmd'))}">趋势 MD</button>
    </div>`;
  }).join('');
  const stopLog = watchStopLogRef().slice(-5).reverse();
  el.allowView.innerHTML = `
  ${panelDescBar('watch')}
    <h2 class="ps-title">${esc(t('psWatch'))}</h2>
    <div class="help">界面开着才会跑；翻到别的动作自动停。在只读动作详情页点「监控」添加。</div>
    ${rows || '<div class="ps-empty" role="status">没有在跑的监控——打开任一<b>只读</b>动作详情页点「◎ 监控」选间隔即可开始，跑着的不用守在旁边。</div>'}
    ${stopLog.length ? `<div class="watch-stoplog"><div class="sub">最近自动停止：</div>${stopLog.map((l) => `<div class="watch-stoprow bad">${esc(l)}</div>`).join('')}</div>` : ''}
    ${panelsRef().renderNotifySection()}
    ${renderQuietSection()}`;
  panelsRef().showPanelAnimated(el.allowView);
  // 第一百三十二轮④：静默时段交互
  el.allowView.querySelector('#quietSave')?.addEventListener('click', () => {
    const on = el.allowView.querySelector('#quietOn')?.checked ?? false;
    const st = String(el.allowView.querySelector('#quietStart')?.value ?? '22:00').trim();
    const en = String(el.allowView.querySelector('#quietEnd')?.value ?? '07:00').trim();
    if (parseHm(st) === null || parseHm(en) === null) { setCount('静默时段要 HH:mm 格式（如 22:00）'); return; }
    writeJson('zerokit.quiet', { on, start: st, end: en });
    setCount(on ? `静默时段已开启（${st}–${en}）` : '静默时段已关闭');
  });
  el.allowView.querySelectorAll('[data-wnotify]').forEach((b) => b.addEventListener('click', () => {
    const reg2 = watchRegistry(); const w3 = reg2[b.dataset.wnotify];
    if (!w3) return;
    w3.notify = w3.notify === false; // undefined/true → false；false → true
    setCount(w3.notify === false ? `已关通知：${w3.title}` : `已开通知：${w3.title}`);
    void persistWatch();
    showWatchPanel(); // 重画按钮态
  }));
  el.allowView.querySelectorAll('[data-wstop]').forEach((b) => b.addEventListener('click', () => {
    stopWatch(b.dataset.wstop);
    showWatchPanel();
  }));
  // 第二百二十六轮③④：改间隔——scheduleWatch 重启（下轮生效）+ 落盘（重启保留）
  el.allowView.querySelectorAll('[data-winterval-save]').forEach((b) => b.addEventListener('click', () => {
    const k = b.dataset.wintervalSave;
    const reg2 = watchRegistry(); const w3 = reg2[k];
    if (!w3) return;
    const input = el.allowView.querySelector(`[data-winterval="${k}"]`);
    const sec = Math.max(5, Math.min(3600, Number(input?.value ?? 0) || 0));
    if (!sec) { setCount('间隔需要 5–3600 秒'); return; }
    w3.interval = sec;
    scheduleWatch(k, sec);
    void persistWatch();
    setCount(`已改间隔：每 ${intervalLabel(sec)}（下轮生效）`);
    showWatchPanel();
  }));
  el.allowView.querySelectorAll('[data-wcsv]').forEach((b) => b.addEventListener('click', () => {
    const w = watchRegistry()[b.dataset.wcsv];
    if (!w || !w.samples.length) { setCount('还没有采样，导出啥呀'); return; }
    const csv = watchCsv(w.samples);
    const blob = new Blob([CSV_BOM + csv], { type: exportMime('csv') });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = exportFilename(`watch-${w.pluginId}`, w.actionId, 'csv');
    a.click();
    URL.revokeObjectURL(a.href);
    setCount(t('watchCsvDone')(w.samples.length));
  }));
  // 第三十七轮⑥：采样 → Markdown 趋势表（数值列环比用 cellDiff 文本）
  el.allowView.querySelectorAll('[data-wmd]').forEach((b) => b.addEventListener('click', () => {
    const w = watchRegistry()[b.dataset.wmd];
    if (!w || !w.samples.length) { setCount('还没有采样，导出啥呀'); return; }
    const firstNum = w.samples.map((smp) => smp?.data).find((d) => d && typeof d === 'object' && !Array.isArray(d));
    const key = firstNum ? Object.keys(firstNum).find((k2) => typeof firstNum[k2] === 'number') : undefined;
    const md = watchTrendMarkdown(w.samples, (smp) => (key !== undefined ? smp?.data?.[key] : JSON.stringify(smp?.data)?.slice(0, 40)));
    navigator.clipboard.writeText(md).then(() => { setCount(`已复制 ${w.samples.length} 次采样趋势表（列 ${key ?? '摘要'}）`); }, () => { setCount('复制失败（剪贴板被拒）'); });
  }));
}

/** 定时任务引擎：interval 驱动 + 窗口判定 + 补跑 + 历史裁剪。
 * 与监控（watchRegistry）的分工：定时只管「到点跑」，监控管采样/diff/趋势。 */
function startTimerTick(key) {
  const reg = timerRegistry();
  const t = reg[key];
  if (!t || t.id) return;
  t.id = setInterval(() => fireTimer(key, 'auto'), t.interval * 1000);
  t.nextAt = Date.now() + t.interval * 1000;
}

/* ===================== 第三十八轮：定时与调度 ===================== */



async function fireTimer(key, why) {
  const reg = timerRegistry();
  const t = reg[key];
  if (!t || t.paused) return;
  // ②执行窗口：窗口外跳过并记 skipped（不重置节奏）
  const now = new Date();
  if (!inWindow(now, t.win)) {
    t.history = trimHistory([...(t.history ?? []), { ts: Date.now(), ok: null, why: 'skipped:窗口外' }]);
    t.nextAt = Date.now() + t.interval * 1000;
    return;
  }
  t.lastRanAt = Date.now();
  t.nextAt = Date.now() + t.interval * 1000;
  try {
    // 找到动作并静默执行（不抢焦点）
    const e = entries.find((x) => actionKey(x.plugin.id, x.action.id) === key);
    if (!e) throw new Error('动作不在了（插件被卸载？）');
    const res = await runActionQuiet(e.plugin, e.action, t.values ?? {});
    t.history = trimHistory([...(t.history ?? []), { ts: Date.now(), ok: res.ok === true, why: res.ok === true ? '' : String(res.error ?? '').slice(0, 80) }]);
    // ⑧失败通知带错误摘要（granted 时）
    if (res.ok !== true) {
      try {
        if ('Notification' in window && Notification.permission === 'granted') {
          new Notification('zerokit 定时任务失败', { body: `${t.title}：${String(res.error ?? '').slice(0, 120)}`, tag: 'zerokit-timer' });
        }
      } catch { /* 通知是增强 */ }
    }
  } catch (err) {
    t.history = trimHistory([...(t.history ?? []), { ts: Date.now(), ok: false, why: String(err.message ?? err).slice(0, 80) }]);
  }
}

/** 295②：watch 触发的 chain 静默执行（runActionQuiet 同款信封）。 */
async function runChainQuiet(pluginId, actionId) {
  try {
    const r = await fetch('/api/run', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-zerokit-token': TOKEN },
      body: JSON.stringify({ plugin: pluginId, action: actionId, values: {} }),
    });
    return await r.json();
  } catch (e) {
    return { ok: false, error: String(e.message ?? e) };
  }
}

/** 静默执行：走 fetch /api/run，不碰界面焦点（submit 会写结果区抢走视图）。 */
async function runActionQuiet(plugin, action, values) {
  try {
    const r = await fetch('/api/run', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-zerokit-token': TOKEN },
      body: JSON.stringify({ plugin: plugin.id, action: action.id, values }),
    });
    return await r.json();
  } catch (e) {
    return { ok: false, error: String(e.message ?? e) };
  }
}

function showTimers() {
  hidePanels();
  modeRef.set('timers');
  el.modeLabel.textContent = t('modeTimers');
  el.listView.classList.add('hidden');
  el.detailView.classList.add('hidden');
  if (location.hash !== '#/timers') history.replaceState(null, '', '#/timers');
  const reg = timerRegistry();
  // ③补跑：打开面板时对错过的任务各补一次（shouldCatchUp 保证只一次）
  for (const k of Object.keys(reg)) {
    if (shouldCatchUp(reg[k])) fireTimer(k, 'catchup').then(() => renderTimersRows()).catch(() => {});
  }
  el.allowView.innerHTML = `
    <h2 class="ps-title">定时任务</h2>
    <div class="help">界面开着才会跑（关掉页面即停）。在只读动作详情页点「定时」添加。</div>
    <div class="timers-actions">
      <button class="ghost mini" id="timersExport" data-ai="1">导出 JSON</button>
      <button class="ghost mini" id="timersImport">导入 JSON</button>
      <input type="file" id="timersFile" accept=".json" class="hidden">
    </div>
    <div id="timersRows"></div>`;
  panelsRef().showPanelAnimated(el.allowView);
  renderTimersRows();
  // ⑨导出/导入
  el.allowView.querySelector('#timersExport')?.addEventListener('click', async (ev) => {
    const pack = exportTimers(timerRegistry());
    const name = exportFilename('timers', 'json');
    const blob = new Blob([JSON.stringify(pack, null, 2)], { type: exportMime('json') });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a'); a.href = url; a.download = name; a.click();
    setTimeout(() => URL.revokeObjectURL(url), 4000);
    ev.currentTarget.textContent = t('exportedDone');
    setTimeout(() => { ev.currentTarget.textContent = '导出 JSON'; }, 1200);
  });
  const fileBtn = el.allowView.querySelector('#timersFile');
  el.allowView.querySelector('#timersImport')?.addEventListener('click', () => fileBtn?.click());
  fileBtn?.addEventListener('change', async () => {
    const f = fileBtn.files?.[0];
    if (!f) return;
    const r = parseTimersPack(await f.text());
    if (!r.ok) { setCount(`导入失败：${r.error}`); return; }
    const reg2 = timerRegistry();
    let added = 0;
    for (const [k, cfg] of Object.entries(r.pack.timers)) {
      if (reg2[k]) continue;   // 已有的不覆盖（本机配置优先）
      reg2[k] = { id: null, interval: cfg.interval, win: cfg.win ?? '', title: cfg.title ?? k,
        values: {}, createdAt: Date.now(), lastRanAt: Date.now(), history: [], paused: !!cfg.paused, nextAt: 0 };
      if (!cfg.paused) startTimerTick(k);
      added++;
    }
    setCount(`导入完成：新增 ${added} 个定时任务`);
    renderTimersRows();
  });
}

/** 面板行渲染：独立函数以便执行后局部刷新（不整页重画）。
 * 第一百三十八轮：叠加持久化执行史（timer-runs.json 经 /api/timer-runs）——
 * 会话内 history 只记成败，持久层还带输出快照与触发来源。 */
async function renderTimersRows() {
  const host = document.getElementById('timersRows');
  if (!host) return;
  const reg = timerRegistry();
  // 持久执行史（拉不到不挡面板——按空处理）
  let savedRuns = [];
  try { savedRuns = (await api('/api/timer-runs')).runs ?? []; } catch { /* 旁路 */ }
  const runsOf = (k) => savedRuns.filter((r) => r.key === k).slice().reverse();
  // 第二百三十九轮④：按下次执行时间升序（最近的最上；暂停的排最后）
  const sortedEntries = Object.entries(reg).sort((a, b) => {
    const na = a[1].paused ? Infinity : (a[1].nextAt ?? Infinity);
    const nb = b[1].paused ? Infinity : (b[1].nextAt ?? Infinity);
    return na - nb;
  });
  const rows = sortedEntries.map(([k, tm]) => {
    const hist = tm.history ?? [];
    const last = hist[hist.length - 1];
    const lastTxt = !last ? '还没跑过'
      : last.ok === null ? `跳过（${esc(last.why ?? '')}）`
      : last.ok ? `✓ ${new Date(last.ts).toLocaleTimeString()}`
      : `✗ ${new Date(last.ts).toLocaleTimeString()} ${esc(last.why ?? '')}`;
    // 第一百三十八轮③：最近一次失败 → 红点显眼（不用点开就知道坏了）
    const saved = runsOf(k);
    const lastSaved = saved[0];
    const failDot = lastSaved && lastSaved.ok === false ? '<span class="risk-dot" data-risk="destructive" title="最近一次执行失败"></span>' : '';
    const histN = saved.length;
    // 第二百三十九轮③：到期高亮——≤5 分钟 warn / 已过期 exp（catch-up 前的视觉态）
    const dueCls = tm.paused ? '' : (tm.nextAt ?? 0) - Date.now() <= 0 ? ' exp' : (tm.nextAt ?? 0) - Date.now() <= 5 * 60_000 ? ' due-soon' : '';
    return `
    <div class="run-row timer-row" data-tk="${esc(k)}">
      <span class="badge">⏱</span>${failDot}
      <span class="run-when">${esc(tm.title)}（每 ${esc(String(tm.interval))} 秒${tm.win ? ` · 窗口 ${esc(tm.win)}` : ''}${tm.paused ? ' · 已暂停' : ''}）</span>
      <span class="timer-next${dueCls}" title="下次触发">${tm.paused ? '—' : nextRunLabel(tm.nextAt ?? Date.now())}</span>
      <span class="timer-last" title="最近一次">${lastTxt}</span>
      <button class="ghost mini" data-trun="${esc(k)}" title="立即跑一次，不影响节奏">现在跑</button>
      <button class="ghost mini" data-tpause="${esc(k)}">${tm.paused ? '恢复' : '暂停'}</button>
      <button class="ghost mini" data-thist="${esc(k)}" title="持久史 ${histN} 条 + 会话史 10 条">历史${histN ? `（${histN}）` : ''}</button>
      <button class="ghost mini" data-stop="${esc(k)}">停止</button>
    </div>`;
  }).join('');
  host.innerHTML = rows || '<div class="ps-empty" role="status">没有定时任务——在只读动作详情页点「⏲ 定时」设间隔，到点自动跑并出结果。</div>';
  host.querySelectorAll('[data-trun]').forEach((b) => b.addEventListener('click', () => {
    fireTimer(b.dataset.trun, 'manual').then(() => renderTimersRows());
  }));
  host.querySelectorAll('[data-tpause]').forEach((b) => b.addEventListener('click', () => {
    const tm = timerRegistry()[b.dataset.tpause];
    if (!tm) return;
    tm.paused = !tm.paused;
    if (tm.paused && tm.id) { clearInterval(tm.id); tm.id = null; }
    else if (!tm.paused) startTimerTick(b.dataset.tpause);
    renderTimersRows();
  }));
  host.querySelectorAll('[data-thist]').forEach((b) => b.addEventListener('click', () => {
    const tm = timerRegistry()[b.dataset.thist];
    if (!tm) return;
    // 第一百三十八轮①②：持久史（输出快照可展开）在前，会话史补尾
    const saved = runsOf(b.dataset.thist);
    const savedLines = saved.map((h) => `
      <details class="timer-hist-run">
        <summary>${h.ok ? '✓' : '✗'} ${new Date(h.ts).toLocaleString()} · ${esc(String(h.ms ?? '?'))}ms · ${esc(h.why ?? 'auto')}</summary>
        ${h.out ? `<pre class="timer-hist-out">${esc(h.out)}</pre>` : '<div class="timer-hist-line dim">（无输出快照）</div>'}
        ${h.err ? `<pre class="timer-hist-out err">${esc(h.err)}</pre>` : ''}
      </details>`).join('');
    const lines = savedLines + (tm.history ?? []).slice().reverse().map((h) =>
      `<div class="timer-hist-line">${h.ok === null ? '⏭' : h.ok ? '✓' : '✗'} ${new Date(h.ts).toLocaleString()} ${esc(h.why ?? '')}</div>`).join('');
    const row = b.closest('.timer-row');
    const old = row?.querySelector('.timer-hist');
    if (old) { old.remove(); return; }
    const div = document.createElement('div');
    div.className = 'timer-hist';
    div.innerHTML = lines || '<div class="timer-hist-line">还没有记录</div>';
    row?.appendChild(div);
  }));
  host.querySelectorAll('[data-stop]').forEach((b) => b.addEventListener('click', () => {
    const k = b.dataset.stop;
    const tm = timerRegistry()[k];
    if (tm) { if (tm.id) clearInterval(tm.id); delete timerRegistry()[k]; }
    renderTimersRows();
  }));
}
  return { fireTimer, liveRefreshWatchPanel, notifyWatchChange, persistWatch, renderTimersRows, runActionQuiet, scheduleWatch, showTimers, showWatchPanel, startTimerTick, stopWatch, timerRegistry, updateWatchTitle, watchRegistry };
}

// web/doctorstats.js —— doctor/统计面板域（第 248 轮 v4 清债第八步：从 app.js 注入式迁出）
// 4 个函数整域迁出（showDoctor/exitDoctor/renderDoctor + showStats 设置与统计大盘）。注入式 + 整域内聚。
import { doctorTrendSparks, dailyTrend, dailyReport, hourlyHeat, msHistogram, weekCompare, exportMime } from './extras.js';

const $ = (id) => document.getElementById(id);

let __exitStats = () => {};
export function createDoctorStats(ui) {
  const { esc, t, lang, el, api, TOKEN, setCount, hidePanels, panelDescBar, skeletonRows, actionKey, openDetail, showPluginHome, idleSuggest, loadPrefs, applyPrefsSnapshot, collectPrefsSnapshot, applyTheme, applyAccent, applyFontScale, applyLang, __wt, modeRef, panelsRef, runStoreRef, exitStats: _exitS = () => {}, readJson } = ui;
  __exitStats = _exitS;

async function showDoctor() {
  modeRef.set('doctor');
  el.modeLabel.textContent = t('modeDoctor');
  el.searchRow.classList.add('hidden');
  hidePanels();
  panelsRef().showPanelAnimated(el.doctorView);
  if (location.hash !== '#/doctor') history.replaceState(null, '', '#/doctor');
  el.doctorView.innerHTML = skeletonRows(4).map(() => '<div class="skel-row" aria-hidden="true"></div>').join('');
  await renderDoctor();
}

function exitDoctor() {
  modeRef.set('command');
  el.doctorView.classList.add('hidden');
  el.searchRow.classList.remove('hidden');
  panelsRef().showPanelAnimated(el.listView);
  el.modeLabel.textContent = t('modeCommand');
  history.replaceState(null, '', location.pathname);
  panelsRef().renderList();
  el.q.focus();
}

async function renderDoctor() {
  el.doctorView.innerHTML = `<div class="ps-head"><h2>${t('doctorTitle')}</h2>
      <span class="sub">${t('doctorSub')}</span></div>
  ${panelDescBar('doctor')}
    <div class="log-tools"><button class="ghost" id="docReload">${t('doctorReload')}</button></div>
    <div id="docBody"><div class="ps-empty" role="status">${t('doctorChecking')}</div></div>`;
  $('docReload').addEventListener('click', renderDoctor);

  let r;
  try { r = await api('/api/doctor'); } catch (e) {
    $('docBody').innerHTML = `<div class="ps-empty" role="status">自检失败：${esc(e.message)}</div>`;
    return;
  }
  // 第八十四轮①④：三级汇总行 + 最近体检趋势（数据来自 server 的 --json 同源接口）
  const sumLine = r.summaryLine ?? '';
  const hist = r.history ?? [];
  // 第一百三十三轮⑥：趋势升级——带 delta 的行表（旧→新）+ 一句话判读
  const trendRows = r.trend?.rows ?? [];
  const trendHtml = trendRows.length >= 2
    ? `<div class="doc-trend"><div class="doc-trend-table">${trendRows.map((row) => {
        const dE = row.deltaE ? `（${row.deltaE > 0 ? '+' : ''}${row.deltaE}）` : '';
        const dW = row.deltaW ? `（${row.deltaW > 0 ? '+' : ''}${row.deltaW}）` : '';
        return `<span class="doc-trend-item">${String(row.ts).slice(5, 16).replace('T', ' ')} ✗${row.errors}${dE} ⚠${row.warnings}${dW}</span>`;
      }).join('<span class="trend-arrow">→</span>')}</div><div class="doc-trend-verdict">判读：${esc(String(r.trend?.verdict ?? ''))}</div></div>`
    : (hist.length >= 2
      ? `<div class="doc-trend">${hist.slice(0, 5).map((e) => `<span class="doc-trend-item">✗${e.errors}/⚠${e.warnings}</span>`).join('<span class="trend-arrow">→</span>')}</div>`
      : '');
  // 第二百三十六轮②：错误/警告 sparkline（最近 10 次，旧→新——一眼看出走势）
  const sparks = doctorTrendSparks(hist, 10);
  const sparkHtml = sparks.length >= 2
    ? `<div class="doc-sparks" title="${t('docSparkTip')}"><span class="sub">${t('docSparkLabel')}</span><span class="watch-spark doc-spark-strip">${sparks.map((sp) => `<i class="${sp.errors > 0 ? 'bad' : sp.warnings > 0 ? 'warn' : 'ok'}" title="${esc(String(sp.ts).slice(5, 16).replace('T', ' '))} ✗${sp.errors} ⚠${sp.warnings}"></i>`).join('')}</span></div>`
    : '';
  const sumHtml = sumLine ? `<div class="doc-summary" role="status">${esc(sumLine)}</div>${trendHtml}${sparkHtml}` : '';
  const toolRows = (r.tools ?? []).map((t) => `<div class="doc-line ${t.ok ? '' : 'bad'}">
      <span class="doc-mark">${t.ok ? '✓' : '!'}</span>
      <span class="doc-name">${esc(t.name)}</span>
      <span class="doc-val">${esc(t.version ?? '')} ${esc(t.path ?? '')}</span>
    </div>`).join('');
  const pluginRows = (r.plugins ?? []).map((p) => {
    const bad = (p.problems ?? []).some((x) => x.level === 'error');
    const warn = (p.problems ?? []).some((x) => x.level === 'warning');
    const persistTag = (text) => {
      const clip = text.length > 120 ? text.slice(0, 117) + '…' : text;
      let n = 0;
      for (const e of hist) { if ((e.failed ?? []).includes(clip) || (e.warn ?? []).includes(clip)) n++; else break; }
      return n >= 2 ? ` <span class="persist-tag">⚠ 持续 ${n} 次</span>` : '';
    };
    const problems = (p.problems ?? []).map((x) => `<div class="doc-problem ${x.level}">
        <span>${esc(x.text)}${persistTag(x.text)}</span>
        ${x.hint ? `<pre class="doc-hint">${esc(x.hint)}</pre>` : ''}
      </div>`).join('');
    return `<div class="doc-plugin">
      <div class="doc-line ${bad ? 'bad' : warn ? 'warn' : 'ok'}">
        <span class="doc-mark">${bad ? '✗' : warn ? '!' : '✓'}</span>
        <span class="doc-name">${esc(p.name || p.dir)}</span>
        <span class="doc-val">${esc(p.id || p.dir)} · ${p.actions} 个动作</span>
      </div>
      ${problems}
    </div>`;
  }).join('');
  $('docBody').innerHTML = `
    ${sumHtml}
    <div class="doc-grid">
      <div class="doc-card"><b>${esc(String(r.summary?.plugins ?? 0))}</b><span>插件</span></div>
      <div class="doc-card"><b>${esc(String(r.summary?.actions ?? 0))}</b><span>动作</span></div>
      <div class="doc-card ${r.summary?.errors ? 'bad' : 'ok'}"><b>${esc(String(r.summary?.errors ?? 0))}</b><span>错误</span></div>
      <div class="doc-card ${r.summary?.warnings ? 'warn' : ''}"><b>${esc(String(r.summary?.warnings ?? 0))}</b><span>提醒</span></div>
    </div>
    <h3 class="plug-home-h">环境</h3>${toolRows}
    <h3 class="plug-home-h">插件</h3>${pluginRows || '<div class="ps-empty" role="status">还没装插件</div>'}`;
}

/** 全局统计：总执行数 / 成功率 / 最活跃插件 / 近 7 天趋势。数据全部来自本机 runStoreRef()。 */
function showStats() {
  modeRef.set('stats');
  el.modeLabel.textContent = t('modeStats');
  el.searchRow.classList.add('hidden');
  hidePanels();
  panelsRef().showPanelAnimated(el.allowView);
  const view = el.allowView;
  if (location.hash !== '#/stats') history.replaceState(null, '', '#/stats');

  // 扁平化全部执行记录
  const runs = [];
  for (const [key, list] of Object.entries(runStoreRef())) {
    for (const r of list ?? []) runs.push({ key, ts: r.ts, ok: r.ok, ms: r.ms });
  }
  runs.sort((a, b) => b.ts - a.ts);
  const total = runs.length;
  const okCount = runs.filter((r) => r.ok).length;
  // 第一百一十九轮⑧：最近 7 天一句话趋势
  const wc7 = weekCompare(runs);
  const tw = wc7.cur.total, pw = wc7.prev.total;
  const wcTxt = tw > pw
    ? t('trendUp')(tw, tw - pw)
    : tw < pw
      ? t('trendDown')(tw, pw - tw)
      : t('trendFlat')(tw);
  const rate = total ? Math.round((okCount / total) * 100) : 0;
  const byPlugin = new Map();
  for (const r of runs) {
    const pid = r.key.split('.')[0];
    byPlugin.set(pid, (byPlugin.get(pid) ?? 0) + 1);
  }
  const top = [...byPlugin.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5);
  const maxTop = top[0]?.[1] ?? 1;
  const trend = dailyTrend(runs, 7);
  const maxDay = Math.max(1, ...trend.map((d) => d.total));
  const avgMs = total ? Math.round(runs.reduce((s, r) => s + (r.ms ?? 0), 0) / total) : 0;

  view.innerHTML = `
    <div class="ps-head"><h2>${t('statsTitle')}</h2>
      <span class="sub">${t('statsPrivacy')}</span></div>
    ${panelDescBar('stats', `<div class="stat-trend">${wcTxt}</div>`)}
    <div class="doc-grid">
      <div class="doc-line stat-big"><b>${total}</b><span>${t('statsTotal')}</span></div>
      <div class="doc-line stat-big"><b>${rate}%</b><span>${t('statsOkRate')(okCount, total)}</span></div>
      <div class="doc-line stat-big"><b>${avgMs} ms</b><span>${t('statsAvgMs')}</span></div>
    </div>
    ${top.length ? `
    <h3 class="plug-home-h">${t('statsTop')}</h3>
    <div class="usage-block">
      ${top.map(([pid, n]) => `
        <div class="usage-row stat-top-plugin" data-plugin="${esc(pid)}" title="${t('statsOpenPlugHome')}">
          <span class="usage-name">${esc(pid)}</span>
          <span class="usage-bar"><i style="width:${Math.round((n / maxTop) * 100)}%"></i></span>
          <span class="usage-n">${t('statsRunsN')(n)}</span></div>`).join('')}
    </div>` : ''}
    <h3 class="plug-home-h">${t('statsLast7')}</h3>
    <div class="usage-block trend">
      ${trend.map((d) => `
        <div class="trend-col" title="${esc(d.day)}：${t('statsRunsFail')(d.total, d.fail)}">
          <div class="trend-bars">
            <i class="trend-ok" style="height:${Math.round(((d.total - d.fail) / maxDay) * 60)}px"></i>
            ${d.fail ? `<i class="trend-fail" style="height:${Math.max(3, Math.round((d.fail / maxDay) * 60))}px"></i>` : ''}
          </div>
          <span class="trend-day">${esc(d.day.slice(5))}</span>
        </div>`).join('')}
    </div>
    ${total ? `
    <h3 class="plug-home-h">${t('statsWhen')}</h3>
    <div class="usage-block heat-row">
      ${(() => {
        const heat = hourlyHeat(runs);
        const maxH = Math.max(1, ...heat.map((x) => x.total));
        return heat.map((b) => `
          <div class="heat-cell" title="${b.hour}:00 — ${t('statsRunsN')(b.total)}">
            <i style="height:${Math.max(2, Math.round((b.total / maxH) * 32))}px;opacity:${(0.25 + 0.7 * (b.total / maxH)).toFixed(2)}"></i>
            <span>${b.hour}</span>
          </div>`).join('');
      })()}
    </div>` : ''}
    ${total ? `
    <h3 class="plug-home-h">${t('statsMsDist')}</h3>
    <div class="usage-block">
      ${(() => {
        const hist = msHistogram(runs.map((r) => r.ms ?? 0));
        const maxC = Math.max(1, ...hist.map((x) => x.count));
        const totalR = runs.length || 1;
        return hist.map((b) => `
          <div class="heat-cell" title="${b.label}ms：${t('statsRunsShare')(b.count, Math.round((b.count / totalR) * 100))}">
            <i style="height:${Math.max(2, Math.round((b.count / maxC) * 32))}px"></i>
            <span>${b.label}</span>
            <em class="heat-count">${b.count || ''}</em>
          </div>`).join('');
      })()}
    </div>` : ''}
    ${total === 0 ? `<div class="ps-empty" role="status">${t('statsEmpty')}——${t('statsEmptyHint')}。</div>` : ''}
    <h3 class="plug-home-h">${t('statsBackupTitle')}</h3>
    <div class="cmd-box prefs-box">
      <div class="help">${t('statsBackupWhat')}——${t('statsAllLocal')}。
        ${t('statsBackupHow')('.')}</div>
      <div class="actions">
        <button class="ghost" id="prefsExport">导出偏好</button>
        <button class="ghost" id="prefsImport">导入偏好</button>
        <input type="file" id="prefsFile" accept="application/json" class="hidden">
        <span class="sub" id="prefsMsg"></span>
      </div>
    </div>
    <h3 class="plug-home-h">偏好快照（两组切换）</h3>
    <div class="cmd-box prefs-box">
      <div class="help">工作、生活各存一套（主题/强调色/字体/收藏/别名/昵称/标签/快捷键），
        一键切换整套偏好。快照存在本机，不进任何云端。</div>
      <div class="actions">
        <button class="ghost" id="snapSaveA">存入 A 组</button>
        <button class="ghost" id="snapSaveB">存入 B 组</button>
        <button class="primary" id="snapUse">切换到另一组</button>
        <span class="sub" id="snapState"></span>
      </div>
    </div>
    <div class="actions">
      <button class="ghost" id="statsBack">返回</button>
      ${total ? '<button class="primary" id="dailyReportBtn">生成今天的日报</button>' : ''}
    </div>`;
  $('statsBack').addEventListener('click', __exitStats);
  view.querySelectorAll('.stat-top-plugin').forEach((row) => row.addEventListener('click', () => {
    showPluginHome(row.dataset.plugin);
  }));
  $('dailyReportBtn')?.addEventListener('click', () => {
    const names = new Map(plugins.map((p) => [p.id, p.name]));
    const rep = dailyReport(runs, { pluginNames: names });
    const box = document.createElement('div');
    box.className = 'overlay';
    box.innerHTML = `
      <div class="modal diff-modal">
        <h3>${esc(rep.title)}</h3>
        <pre class="report-body">${esc(rep.body)}</pre>
        <div class="actions">
          <button class="ghost" id="reportCopy">复制</button>
          <button class="primary" id="reportClose">关闭</button>
        </div>
      </div>`;
    document.body.appendChild(box);
    box.querySelector('#reportClose').addEventListener('click', () => box.remove());
    box.addEventListener('click', (e) => { if (e.target === box) box.remove(); });
    box.querySelector('#reportCopy').addEventListener('click', async (e) => {
      try {
        await navigator.clipboard.writeText(`${rep.title}\n\n${rep.body}`);
        e.currentTarget.textContent = '✓ 已复制';
      } catch { e.currentTarget.textContent = '复制失败'; }
    });
  });

  // 偏好快照：两组一键切换（工作/生活各一套：主题、强调色、收藏、别名、昵称、标签）
  const renderSnap = () => {
    const snapA = readJson('zerokit.snapA');
    const snapB = readJson('zerokit.snapB');
    const cur = readJson('zerokit.snapCur') ?? 'A';
    $('snapState') && ($('snapState').textContent = `当前：${cur}`
      + `${snapA ? ' · A 已存' : ''}${snapB ? ' · B 已存' : ''}`);
  };
  $('snapSaveA')?.addEventListener('click', () => {
    writeJson('zerokit.snapA', collectPrefsSnapshot());
    writeJson('zerokit.snapCur', 'A'); renderSnap();
  });
  $('snapSaveB')?.addEventListener('click', () => {
    writeJson('zerokit.snapB', collectPrefsSnapshot());
    writeJson('zerokit.snapCur', 'B'); renderSnap();
  });
  $('snapUse')?.addEventListener('click', () => {
    const cur = readJson('zerokit.snapCur') ?? 'A';
    const next = cur === 'A' ? 'B' : 'A';
    const snap = readJson(next === 'A' ? 'zerokit.snapA' : 'zerokit.snapB');
    if (!snap) { $('snapState').textContent = `${next} 组还没存过快照`; return; }
    applyPrefsSnapshot(snap);
    writeJson('zerokit.snapCur', next);
    renderSnap();
  });
  renderSnap();

  $('prefsExport').addEventListener('click', async () => {
    const msg = $('prefsMsg');
    const prefs = {};
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k?.startsWith('zerokit.')) prefs[k] = localStorage.getItem(k);
    }
    try {
      const r = await api('/api/prefs/export', { method: 'POST', body: { prefs } });
      const blob = new Blob([JSON.stringify(r.payload, null, 2)], { type: exportMime('json') });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url; a.download = `zerokit-prefs-${new Date().toISOString().slice(0, 10)}.json`; a.click();
      URL.revokeObjectURL(url);
      msg.textContent = '✓ 已导出';
    } catch (e) { msg.textContent = `导出失败：${e.message}`; }
  });
  $('prefsImport').addEventListener('click', () => $('prefsFile').click());
  $('prefsFile').addEventListener('change', async (ev) => {
    const file = ev.target.files?.[0];
    if (!file) return;
    const msg = $('prefsMsg');
    try {
      const parsed = JSON.parse(await file.text());
      const r = await api('/api/prefs/import', { method: 'POST', body: { payload: parsed } });
      let n = 0;
      for (const [k, v] of Object.entries(r.prefs)) {
        localStorage.setItem(k, typeof v === 'string' ? v : JSON.stringify(v));
        n++;
      }
      msg.textContent = `✓ 已导入 ${n} 项，刷新后生效`;
      // 第十轮⑨：空闲推荐（只提示一次；点开即执行该动作详情）
setTimeout(() => {
  const sug = idleSuggest(runStoreRef(), Date.now());
  if (!sug) return;
  const e = entries.find((x) => actionKey(x.plugin.id, x.action.id) === sug.key);
  if (!e) return;
  const tip = document.createElement('div');
  tip.className = 'idle-tip';
  tip.innerHTML = `<span>有一阵子没用了——要不要跑一次「${esc(e.action.title)}」？</span>
    <button class="ghost mini" id="idleGo">打开</button>
    <button class="ghost mini" id="idleNo">不用</button>`;
  document.body.appendChild(tip);
  tip.querySelector('#idleGo').addEventListener('click', () => { tip.remove(); openDetail(e.plugin, e.action); });
  tip.querySelector('#idleNo').addEventListener('click', () => tip.remove());
  setTimeout(() => tip.remove(), 60_000);
}, 35 * 60 * 1000);

// 第十轮：footer 入口
$('timersBtn')?.addEventListener('click', () => __wt().showTimers());
$('briefBtn')?.addEventListener('click', showBrief);

loadPrefs();
applyLang();
applyFontScale(); applyTheme(); applyAccent();
    } catch (e) { msg.textContent = `导入失败：${e.message}`; }
  });
}
  return { exitDoctor, renderDoctor, showDoctor, showStats };
}

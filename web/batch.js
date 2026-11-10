// web/batch.js —— 批量域（第 242 轮 v4 清债第二步：从 app.js 注入式迁出）
// 方案：docs/debt/app-split-plan.md 第 2 步（按 241 轮试点确立的注入式——工厂接收 ui/env，不 import app）。
// 迁出函数：runBatch / applyBatchImport / syncBatchView / curBatch。
import { batchSummary, batchCounts, batchCountsLabel, batchStateIcon, classifyError, chunkWindows, parseBatchList, batchDedup, pickLang, I18N, humanCell } from './extras.js';

/** 创建批量域函数集（ui = app 侧注入的执行环境） */
export function createBatch(ui) {
  const { esc, t, lang, api, TOKEN, el, renderList, openDetail, paramStore, actionKey, entriesRef, batchRef, setCount } = ui;

function curBatch() {
  if (!batchCurKey) return [];
  let arr = batchMap.get(batchCurKey);
  if (!arr) { arr = []; batchMap.set(batchCurKey, arr); }
  return arr;
}


/** 批量顺序执行：逐个跑篮子里的动作（destructive 排最后），完成后弹汇总卡片。
 * 每项用已记忆的参数（参数记忆参数不存在时用默认值），失败不阻断后面的项。 */
async function runBatch(retryItems) {
  const source = Array.isArray(retryItems) ? retryItems : batchRef();   // 防御：事件对象/undefined 都回落整篮

  if (!source.length) return; // 第八项：空队列守卫（按钮禁用是第一道，这里是第二道）
  // destructive 排最后：失败不至于挡住只读项
  const ordered = [...source].sort((a, b) =>
    (a.action.risk === 'destructive' ? 1 : 0) - (b.action.risk === 'destructive' ? 1 : 0));
  const results = [];
  const btn = document.getElementById('batchRun');
  if (btn) { btn.disabled = true; btn.textContent = '执行中…'; }
  // 第九十八轮①②：逐项状态表 + 实时计数条（执行期间插在列表顶上，每项一行可点）
  const states = ordered.map(() => 'queued');
  let prog = document.getElementById('batchProgress');
  if (retryItems && prog) prog.remove();
  prog = document.createElement('div');
  prog.id = 'batchProgress';
  prog.className = 'batch-progress' + (retryItems ? ' batch-retry-run' : '');
  el.listView.insertBefore(prog, el.list);
  const paint = () => {
    const c = batchCounts(states);
    prog.innerHTML = `
      <div class="bp-counts" role="status">${esc(batchCountsLabel(c))}</div>
      <div class="bp-rows">${ordered.map((e, i) => `
        <div class="bp-row st-${states[i]}" data-bp="${i}"${results[i]?.error ? ` title="${esc(String(results[i].error).slice(0, 140))}"` : ''}>
          <span class="bp-ic">${batchStateIcon(states[i])}</span>
          <span class="bp-name">${esc(e.action.title)}</span>
          <span class="bp-src">${esc(e.plugin.name)}</span>
          <span class="bp-ms">${states[i] === 'ok' || states[i] === 'fail' ? formatMs(results[i]?.ms || 0) : (states[i] === 'running' && oneT0.has(i) ? fmtElapsed(Date.now() - oneT0.get(i)) : '')}</span>
        </div>`).join('')}</div>`;
  };
  paint();
  // 第一百七十七轮⑤：单项进行中计时（增量反馈——不等整批，跑一项亮一项耗时）
  const oneT0 = new Map();
  const runOne = async (entry, i) => {
    const key = actionKey(entry.plugin.id, entry.action.id);
    const values = paramStore[key] ?? {};
    const payload = { plugin: entry.plugin.id, action: entry.action.id, values };
    states[i] = 'running'; oneT0.set(i, Date.now()); paint();
    const tick = setInterval(() => {
      if (states[i] === 'running') paint();
    }, 500);
    try {
      return await (async () => {
      const r = await fetch('/api/run', {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-zerokit-token': TOKEN },
        body: JSON.stringify(payload),
      });
      const j = await r.json().catch(() => ({ ok: false, error: '响应不是 JSON' }));
      return { entry, ok: j.ok !== false && r.ok, ms: j.ms ?? 0, error: j.error };
      })();
    } catch (err) {
      return { entry, ok: false, ms: 0, error: String(err) };
    } finally {
      clearInterval(tick); oneT0.delete(i);
    }
  };
  // 第二十五轮⑧：并发窗口——窗口内并行、窗口间串行（1=纯串行，默认 3）
  const conc = Math.max(1, Math.min(8, Number(readJson('zerokit.batchconc', 3)) || 3));
  // 第一百一十四轮⑦：暂停标记——「跑完当前项后停」：窗口边界检查，
  // 已并发的窗口跑完，未开始的不再进。暂停按钮挂在进度条上。
  let paused = false;
  const pauseBtn = document.createElement('button');
  pauseBtn.className = 'ghost mini bp-pause';
  pauseBtn.textContent = '⏸ 暂停';
  pauseBtn.onclick = () => {
    paused = !paused;
    pauseBtn.textContent = paused ? '▶ 继续' : '⏸ 暂停';
    pauseBtn.classList.toggle('paused', paused);
  };
  prog.appendChild(pauseBtn);
  let wi = 0;
  for (const win of chunkWindows(ordered.length, conc)) {
    if (shouldPauseBatch(paused, wi)) {
      // 暂停中：挂起等继续（200ms 轮询——队列场景不需要更细）
      await new Promise((r) => setTimeout(r, 200));
      wi--;   // 本窗口没跑，回退重进循环
      continue;
    }
    // 第七项：失败不中断——窗口内逐项落状态，窗口间不因失败短路
    const rs = await Promise.all(win.map((i) => runOne(ordered[i], i).then((r) => {
      results[i] = r; states[i] = r.ok ? 'ok' : 'fail'; paint(); return r;
    })));
    results.push(...[]);
    void rs;
    wi++;
  }
  if (btn) { btn.disabled = false; btn.textContent = '顺序执行'; }
  // 第一百一十八轮④：整篮跑完清空并收起浮条（汇总卡承担展示；重跑失败项路径保留浮条继续勾选）
  if (!retryItems) { batchRef().length = 0; }
  renderList();
  // 进度条使命完成：撤掉，换汇总卡
  document.getElementById('batchProgress')?.remove();
  // 第五项：批量完成写审计事件 batch_done（server 落 audit.log，审计页可查）
  fetch('/api/batch-done', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-zerokit-token': TOKEN },
    body: JSON.stringify({ items: ordered.map((e, i) => ({
      plugin: e.plugin.id, action: e.action.id, ok: results[i]?.ok ?? false, ms: results[i]?.ms ?? 0,
    })) }),
  }).catch(() => {}); // 审计失败不挡汇总展示
  // 汇总卡片：成功 N / 失败 M / 总耗时，失败项可点开
  const ok = results.filter((r) => r.ok).length;
  const failed = results.length - ok;
  const totalMs = results.reduce((s, r) => s + (r.ms || 0), 0);
  // 第四十八轮⑤：汇总行改走共享 batchSummary（成功/失败/未跑三段式）
  const sum = document.createElement('div');
  sum.id = 'batchSummary';
  sum.className = 'batch-summary';
  sum.innerHTML = `
    <b class="${retryItems ? 'batch-retry-badge' : ''}">${retryItems ? t('batchRetryDone') : t('batchAllDone')}${t('paren')(conc)}</b>
    <span>${esc(batchSummary(results.map((r) => ({ ok: r.ok })), ordered.length, I18N[pickLang(lang)]))}</span>
    <span class="sub">总耗时 ${formatMs(totalMs)}</span>
    ${failed ? `<ul class="batch-fails">${results.filter((r) => !r.ok).map((r, i) => `
      <li data-fail="${i}" title="${esc(classifyError(r.error || '失败', I18N[pickLang(lang)]).title + '：' + String(r.error || '失败').slice(0, 120))}">✗ ${esc(r.entry.action.title)}（${esc(r.entry.plugin.name)}）</li>`).join('')}</ul>
      <button class="ghost mini" id="batchRetry">只重跑失败的（${failed} 项）</button>` : ''}
    <button class="ghost mini" id="batchSumClose">关闭</button>`;
  el.listView.insertBefore(sum, el.list);
  sum.querySelector('#batchSumClose').addEventListener('click', () => sum.remove());
  // 第二十五轮⑥：一键重跑失败项（参数保持原样）
  sum.querySelector('#batchRetry')?.addEventListener('click', () => {
    const failEntries = results.filter((r) => !r.ok).map((r) => r.entry);
    sum.remove();
    runBatch(failEntries);
  });
  const failItems = [...sum.querySelectorAll('[data-fail]')];
  const fails = results.filter((r) => !r.ok);
  failItems.forEach((li) => li.addEventListener('click', () => {
    const r = fails[Number(li.dataset.fail)];
    if (r) openDetail(r.entry.plugin, r.entry.action);
  }));
}



function applyBatchImport(parsed) {
  let added = 0;
  for (const it of parsed.items) {
    const entry = entriesRef().find((en) => en.plugin.id === it.plugin && en.action.id === it.action);
    if (entry) {
      batchRef().push({ plugin: entry.plugin, action: entry.action });
      if (it.values && Object.keys(it.values).length) paramStore[actionKey(it.plugin, it.action)] = it.values;
      added += 1;
    }
  }
  if (batchCurKey) batchMap.set(batchCurKey, batchRef());
  renderList();
  setCount(`导入了 ${added} 项（${parsed.items.length - added} 个动作不存在）`);
}



function syncBatchView() {
  batchRef().length = 0; batchRef().push(...curBatch());
  renderList();
}


  return { curBatch, runBatch, applyBatchImport, syncBatchView };
}

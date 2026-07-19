/* SLO — Image Optimizer (main thread)
 * UI + worker pool. All processing happens in optimizer-worker.js.
 */
(() => {
  'use strict';

  const $ = (sel) => document.querySelector(sel);
  const dropzone = $('#dropzone');
  const fileInput = $('#file-input');
  const formatSel = $('#format');
  const qualityInput = $('#quality');
  const qualityVal = $('#quality-val');
  const maxWInput = $('#max-width');
  const maxHInput = $('#max-height');
  const resultsEl = $('#results');
  const actionsEl = $('#opt-actions');
  const summaryEl = $('#summary');
  const downloadAllBtn = $('#download-all');

  const EXT = { 'image/webp': 'webp', 'image/jpeg': 'jpg', 'image/png': 'png', 'image/avif': 'avif' };

  /* ===== Worker pool ===== */
  const POOL_SIZE = Math.min(4, navigator.hardwareConcurrency || 2);
  const workers = [];
  const idle = [];
  const queue = [];
  const pending = new Map(); // id -> item
  let nextId = 1;

  function makeWorker() {
    const w = new Worker('optimizer-worker.js');
    w.onmessage = (e) => {
      const msg = e.data;
      if (msg.type === 'probe') { applySupport(msg.supported); return; }
      const item = pending.get(msg.id);
      pending.delete(msg.id);
      if (item) (msg.ok ? onDone : onError)(item, msg);
      idle.push(w);
      pump();
    };
    w.onerror = () => { idle.push(w); pump(); };
    return w;
  }
  for (let i = 0; i < POOL_SIZE; i++) { const w = makeWorker(); workers.push(w); idle.push(w); }

  function pump() {
    while (idle.length && queue.length) {
      const item = queue.shift();
      const w = idle.pop();
      pending.set(item.id, item);
      w.postMessage({ id: item.id, file: item.file, options: currentOptions() });
    }
  }

  /* ===== Feature detection (AVIF etc.) ===== */
  workers[0].postMessage({ type: 'probe' });
  function applySupport(supported) {
    for (const opt of formatSel.options) {
      if (!supported.includes(opt.value)) {
        opt.disabled = true;
        opt.textContent += ' — não suportado neste navegador';
      }
    }
    if (formatSel.selectedOptions[0]?.disabled) {
      formatSel.value = supported[0] || 'image/png';
    }
  }

  function currentOptions() {
    return {
      format: formatSel.value,
      quality: Number(qualityInput.value) / 100,
      maxWidth: Number(maxWInput.value) || 0,
      maxHeight: Number(maxHInput.value) || 0,
    };
  }

  /* ===== Items / UI ===== */
  const items = [];

  function fmtBytes(n) {
    if (n >= 1048576) return (n / 1048576).toFixed(2) + ' MB';
    if (n >= 1024) return (n / 1024).toFixed(1) + ' KB';
    return n + ' B';
  }

  function outputName(file) {
    const base = file.name.replace(/\.[^.]+$/, '');
    return `${base}.${EXT[currentOptions().format] || 'img'}`;
  }

  function createRow(item) {
    const row = document.createElement('div');
    row.className = 'result-row';
    row.innerHTML = `
      <img class="result-thumb" alt="" />
      <div class="result-info">
        <div class="result-name"></div>
        <div class="result-meta"></div>
      </div>
      <div class="result-status"><span class="spinner"></span></div>`;
    row.querySelector('.result-name').textContent = item.file.name;
    row.querySelector('.result-meta').textContent = fmtBytes(item.file.size);
    row.querySelector('.result-thumb').src = item.thumbURL;
    resultsEl.appendChild(row);
    item.row = row;
  }

  function onDone(item, msg) {
    item.blob = msg.blob;
    item.outName = msg.kept ? item.file.name : outputName(item.file);
    if (item.blobURL) URL.revokeObjectURL(item.blobURL);
    item.blobURL = URL.createObjectURL(msg.blob);

    if (msg.kept) {
      item.row.querySelector('.result-meta').innerHTML =
        `${fmtBytes(msg.originalSize)} · já otimizada — original mantido · ${msg.ms} ms`;
    } else {
      const pct = ((1 - msg.outputSize / msg.originalSize) * 100).toFixed(0);
      const cls = msg.outputSize <= msg.originalSize ? 'saved' : 'grew';
      const sign = msg.outputSize <= msg.originalSize ? `−${pct}%` : `+${Math.abs(pct)}%`;
      item.row.querySelector('.result-meta').innerHTML =
        `${fmtBytes(msg.originalSize)} → ${fmtBytes(msg.outputSize)} ` +
        `<span class="${cls}">${sign}</span> · ${msg.width}×${msg.height} · ${msg.ms} ms`;
    }

    item.row.querySelector('.result-status').innerHTML = '';
    const a = document.createElement('a');
    a.className = 'btn-dl';
    a.href = item.blobURL;
    a.download = item.outName;
    a.innerHTML = '<span class="material-symbols-outlined">download</span>Baixar';
    item.row.querySelector('.result-status').appendChild(a);
    updateSummary();
  }

  function onError(item, msg) {
    const friendly = String(msg.error || '').startsWith('DECODE:')
      ? 'Não foi possível ler esta imagem'
      : 'Erro ao processar';
    item.row.querySelector('.result-status').innerHTML = `<span class="error">${friendly}</span>`;
    updateSummary();
  }

  function updateSummary() {
    const done = items.filter((i) => i.blob);
    if (!done.length) { actionsEl.classList.add('hidden'); return; }
    actionsEl.classList.remove('hidden');
    const before = done.reduce((s, i) => s + i.file.size, 0);
    const after = done.reduce((s, i) => s + i.blob.size, 0);
    const pct = ((1 - after / before) * 100).toFixed(0);
    summaryEl.innerHTML =
      `${done.length} ${done.length === 1 ? 'imagem' : 'imagens'}: ` +
      `${fmtBytes(before)} → ${fmtBytes(after)} <strong>(−${pct}%)</strong>`;
  }

  /* ===== Adding files ===== */
  function addFiles(fileList) {
    for (const file of fileList) {
      if (!file.type.startsWith('image/')) continue;
      const item = { id: nextId++, file, thumbURL: URL.createObjectURL(file), blob: null, blobURL: null, row: null };
      items.push(item);
      createRow(item);
      queue.push(item);
    }
    pump();
  }

  /* Reprocess everything when settings change */
  let reprocessTimer;
  function reprocessAll() {
    clearTimeout(reprocessTimer);
    reprocessTimer = setTimeout(() => {
      if (!items.length) return;
      queue.length = 0;
      for (const item of items) {
        item.blob = null;
        item.row.querySelector('.result-status').innerHTML = '<span class="spinner"></span>';
        queue.push(item);
      }
      actionsEl.classList.add('hidden');
      pump();
    }, 300);
  }

  /* ===== Events ===== */
  qualityInput.addEventListener('input', () => { qualityVal.textContent = qualityInput.value + '%'; });
  for (const el of [formatSel, qualityInput, maxWInput, maxHInput]) {
    el.addEventListener('change', reprocessAll);
  }

  dropzone.addEventListener('click', () => fileInput.click());
  dropzone.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); fileInput.click(); }
  });
  fileInput.addEventListener('change', () => { addFiles(fileInput.files); fileInput.value = ''; });

  for (const ev of ['dragenter', 'dragover']) {
    dropzone.addEventListener(ev, (e) => { e.preventDefault(); dropzone.classList.add('dragover'); });
  }
  for (const ev of ['dragleave', 'drop']) {
    dropzone.addEventListener(ev, (e) => { e.preventDefault(); dropzone.classList.remove('dragover'); });
  }
  dropzone.addEventListener('drop', (e) => addFiles(e.dataTransfer.files));

  downloadAllBtn.addEventListener('click', async () => {
    for (const item of items) {
      if (!item.blob) continue;
      const a = document.createElement('a');
      a.href = item.blobURL;
      a.download = item.outName;
      document.body.appendChild(a);
      a.click();
      a.remove();
      await new Promise((r) => setTimeout(r, 150)); // let the browser breathe
    }
  });
})();

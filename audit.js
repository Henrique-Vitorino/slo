/* ===== Auditoria de Imagens — SLO ===== */
(() => {
  const API_URL = 'https://2klko0f4id.execute-api.us-east-1.amazonaws.com/audit/images';

  const form = document.getElementById('audit-form');
  const input = document.getElementById('url-input');
  const btn = document.getElementById('audit-btn');
  const loading = document.getElementById('loading');
  const errorBox = document.getElementById('error');
  const errorMsg = document.getElementById('error-msg');
  const report = document.getElementById('report');

  const CIRC = 2 * Math.PI * 52; // score ring circumference

  const fmtBytes = (b) => {
    if (b == null) return '—';
    if (b < 1024) return b + ' B';
    if (b < 1024 * 1024) return (b / 1024).toFixed(1) + ' KB';
    return (b / (1024 * 1024)).toFixed(2) + ' MB';
  };

  const fileName = (url) => {
    try {
      const path = new URL(url).pathname;
      return decodeURIComponent(path.split('/').pop()) || url;
    } catch {
      return url;
    }
  };

  const verdict = (score) => {
    if (score >= 90) return 'Excelente! As imagens deste site estão bem otimizadas.';
    if (score >= 70) return 'Bom, mas há espaço para melhorar a otimização das imagens.';
    if (score >= 50) return 'Atenção: várias imagens precisam de otimização.';
    return 'Crítico: as imagens estão prejudicando a performance do site.';
  };

  const show = (el) => el.classList.remove('hidden');
  const hide = (el) => el.classList.add('hidden');

  function renderReport(data, siteUrl) {
    // Score ring
    const score = Math.max(0, Math.min(100, data.score ?? 0));
    const ring = document.getElementById('score-ring');
    const bar = document.getElementById('score-bar');
    ring.classList.remove('score-good', 'score-mid', 'score-bad');
    ring.classList.add(score >= 90 ? 'score-good' : score >= 60 ? 'score-mid' : 'score-bad');
    bar.setAttribute('stroke-dasharray', CIRC);
    bar.setAttribute('stroke-dashoffset', CIRC);
    document.getElementById('score-value').textContent = score;
    requestAnimationFrame(() =>
      requestAnimationFrame(() => bar.setAttribute('stroke-dashoffset', CIRC * (1 - score / 100)))
    );

    document.getElementById('report-site').textContent = siteUrl;
    document.getElementById('report-verdict').textContent = verdict(score);

    // Summary cards
    const s = data.summary || {};
    const totalBytes = (data.images || []).reduce((acc, i) => acc + (i.size || 0), 0);
    document.getElementById('summary-grid').innerHTML = `
      <div class="summary-card"><div class="num">${s.images ?? '—'}</div><div class="lbl">Imagens analisadas</div></div>
      <div class="summary-card"><div class="num">${fmtBytes(totalBytes)}</div><div class="lbl">Peso total</div></div>
      <div class="summary-card${(s.oversized || 0) > 0 ? ' warn' : ''}"><div class="num">${s.oversized ?? 0}</div><div class="lbl">Imagens grandes demais</div></div>
      <div class="summary-card save"><div class="num">${(s.estimatedSavingsMb ?? 0).toLocaleString('pt-BR')} MB</div><div class="lbl">Economia estimada</div></div>`;

    // Issues
    const issuesList = document.getElementById('issues-list');
    const withIssues = (data.images || []).filter((i) => (i.issues || []).length > 0);
    if (withIssues.length === 0) {
      issuesList.innerHTML = `
        <div class="no-issues">
          <span class="material-symbols-outlined">check_circle</span>
          Nenhum problema encontrado — parabéns!
        </div>`;
    } else {
      issuesList.innerHTML = withIssues
        .map((img) =>
          img.issues
            .map(
              (iss) => `
        <div class="issue-row ${iss.severity || 'warning'}">
          <span class="material-symbols-outlined">${iss.severity === 'error' || iss.severity === 'critical' ? 'error' : 'warning'}</span>
          <div>
            <div class="issue-title">${iss.title || 'Problema'}</div>
            <div class="issue-desc">${iss.description || ''}</div>
            <a class="issue-url" href="${img.url}" target="_blank" rel="noopener">${fileName(img.url)} · ${img.width}×${img.height}px · ${fmtBytes(img.size)}</a>
          </div>
        </div>`
            )
            .join('')
        )
        .join('');
    }

    // Image rows
    const images = data.images || [];
    document.getElementById('img-count').textContent = images.length;
    document.getElementById('img-rows').innerHTML = images
      .map((img) => {
        const issues = img.issues || [];
        const worst = issues.find((i) => i.severity === 'error' || i.severity === 'critical') || issues[0];
        const flag = worst
          ? `<span class="img-flag ${worst.severity || 'warning'}"><span class="material-symbols-outlined">warning</span>${worst.title || 'Problema'}</span>`
          : `<span class="img-flag ok"><span class="material-symbols-outlined">check_circle</span>OK</span>`;
        return `
        <div class="img-row">
          <img class="img-thumb" src="${img.url}" alt="" loading="lazy" onerror="this.style.visibility='hidden'" />
          <div class="img-info">
            <div class="img-name"><a href="${img.url}" target="_blank" rel="noopener" title="${img.url}">${fileName(img.url)}</a></div>
            <div class="img-meta">
              <span class="fmt-badge">${img.format || '?'}</span>
              <span>${img.width}×${img.height}px</span>
              <span>${fmtBytes(img.size)}</span>
            </div>
          </div>
          <div class="img-flag-cell">${flag}</div>
        </div>`;
      })
      .join('');

    show(report);
    report.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  form.addEventListener('submit', async (e) => {
    e.preventDefault();

    let url = input.value.trim();
    if (!/^https?:\/\//i.test(url)) url = 'https://' + url;

    hide(errorBox);
    hide(report);
    show(loading);
    btn.disabled = true;

    try {
      const res = await fetch(API_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url }),
      });

      if (!res.ok) {
        throw new Error(`A análise falhou (erro ${res.status}). Verifique se a URL está correta e tente novamente.`);
      }

      const data = await res.json();
      if (!data || typeof data.score !== 'number') {
        throw new Error('Não foi possível analisar este site. Tente outra URL.');
      }

      renderReport(data, url);
    } catch (err) {
      errorMsg.textContent =
        err instanceof TypeError
          ? 'Não foi possível conectar ao serviço de análise. Verifique sua conexão e tente novamente.'
          : err.message;
      show(errorBox);
    } finally {
      hide(loading);
      btn.disabled = false;
    }
  });
})();

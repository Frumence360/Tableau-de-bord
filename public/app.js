  const API_BASE = window.location.origin; // même serveur Express (server.js) sert l'API et ce fichier
  const TOKEN_KEY = 'fm_token';

  const getToken = () => localStorage.getItem(TOKEN_KEY);
  const setToken = (t) => localStorage.setItem(TOKEN_KEY, t);
  const clearToken = () => localStorage.removeItem(TOKEN_KEY);
  let currentPermissions = new Set();

  function applyPermissions(permissions = [], role = 'viewer') {
    currentPermissions = new Set(permissions);
    document.body.classList.toggle('role-no-write', !currentPermissions.has('write'));
    document.body.classList.toggle('role-no-archive', !currentPermissions.has('archive'));
    document.body.classList.toggle('role-no-export', !currentPermissions.has('export'));
    document.querySelector('[data-view="supervision"]').hidden = !['admin', 'manager'].includes(role);
    document.querySelector('[data-view="users"]').hidden = !['admin', 'manager'].includes(role);
    document.querySelector('[data-view="security"]').hidden = !['admin', 'manager'].includes(role);
    document.body.classList.remove('capabilities-loading');
  }

  async function loadCurrentUser() {
    const currentUser = await fetchJson(`${API_BASE}/api/auth/me`);
    applyPermissions(currentUser.permissions || [], currentUser.role);
    return currentUser;
  }

  const escapeHTML = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const DEFAULT_GRADIENT = 'linear-gradient(135deg,#2a5fb0,#173a70)';
  const safeGradient = (g) => {
    const s = String(g || '');
    return /^linear-gradient\([^<>;{}]*\)$/i.test(s) ? s : DEFAULT_GRADIENT;
  };
  const safeFlagCode = (code) => (/^[a-z]{2}$/i.test(String(code || '')) ? String(code).toLowerCase() : '');
  const safeColor = (c) => (/^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(String(c || '')) ? c : '#c9d6ea');

  async function apiFetch(url, options = {}) {
    const token = getToken();
    const res = await fetch(url, {
      ...options,
      headers: {
        ...(options.headers || {}),
        ...(token ? { Authorization: `Bearer ${token}` } : {})
      }
    });
    // Certaines routes renvoient 401 pour une erreur metier (ex. mauvais mot de
    // passe actuel) : on ne doit pas deconnecter l'utilisateur dans ce cas.
    if (res.status === 401 && !options.allow401) {
      clearToken();
      showLogin('Session expirée, reconnecte-toi.');
      throw new Error('unauthorized');
    }
    return res;
  }

  function showLogin(message) {
    document.getElementById('loginOverlay').style.display = 'flex';
    document.getElementById('app').classList.add('blurred');
    document.getElementById('loginError').textContent = message || '';
  }

  function hideLogin() {
    document.getElementById('loginOverlay').style.display = 'none';
    document.getElementById('app').classList.remove('blurred');
  }

  document.getElementById('loginForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const username = document.getElementById('loginUser').value.trim();
    const password = document.getElementById('loginPass').value;
    const errorEl = document.getElementById('loginError');
    errorEl.textContent = '';

    try {
      const res = await fetch(`${API_BASE}/api/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password })
      });
      const data = await res.json();
      if (!res.ok) {
        errorEl.textContent = data.error || 'Connexion impossible';
        return;
      }
      setToken(data.token);
      applyPermissions(data.permissions || [], data.role);
      document.getElementById('userName').textContent = data.username;
      hideLogin();
      loadDashboard();
    } catch (err) {
      errorEl.textContent = 'Impossible de contacter le serveur';
    }
  });

  const fmtInt = (n) => n.toLocaleString('fr-FR');
  const fmtUSD = (n) => n.toLocaleString('fr-FR') + ' $';
  const upDownSpan = (pct) => {
    const cls = pct >= 0 ? 'up' : 'down';
    const arrow = pct >= 0
      ? '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3"><path d="m6 15 6-6 6 6"/></svg>'
      : '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3"><path d="m6 9 6 6 6-6"/></svg>';
    return `<span class="${cls}">${arrow}${pct >= 0 ? '+' : ''}${pct} %</span>`;
  };

  const ICONS = {
    collecte: `<div class="stat-icon icon-blue"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 7v10h16V7M4 7l8-4 8 4M9 12h6"/></svg></div>`,
    anomalies: `<div class="stat-icon icon-orange"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 8v4l3 3M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z"/></svg></div>`,
    validation: `<div class="stat-icon icon-green"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M20 6 9 17l-5-5"/></svg></div>`,
    archivage: `<div class="stat-icon icon-purple"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="4" width="18" height="4" rx="1"/><path d="M5 8v11h14V8M10 12h4"/></svg></div>`
  };

  /** Rend les quatre cartes de pilotage, à partir de indicators.cards. */
  function renderIndicatorCards(indicators, gridId) {
    const grid = document.getElementById(gridId);
    if (!grid) return;
    const cards = (indicators && indicators.cards) || [];
    if (!cards.length) {
      grid.innerHTML = '<div class="stat-card"><div class="stat-label">Indicateurs indisponibles</div></div>';
      return;
    }
    grid.innerHTML = cards.map((card) => `
      <div class="stat-card">
        <div class="stat-top">${ICONS[card.key] || ''}<div class="stat-label">${escapeHTML(card.label)}</div></div>
        <div class="stat-value">${card.formatted || fmtInt(card.value)}</div>
        <div class="stat-delta">${escapeHTML(card.unit || '')}</div>
        <div class="stat-hint">${escapeHTML(card.hint || '')}</div>
      </div>
    `).join('');
  }

  /** Ligne « libellé / valeur / part » réutilisée par les panneaux de synthèse. */
  function indicatorRow(label, value, detail) {
    return `
      <div class="country-row">
        <span class="cname">${escapeHTML(label)}</span>
        <span class="cval">${escapeHTML(value)}${detail ? ` · ${escapeHTML(detail)}` : ''}</span>
      </div>`;
  }

  function renderWorkPanels(indicators) {
    if (!indicators) return;
    const { collection, anomalies, validation, archiving } = indicators;

    const anomalyList = document.getElementById('anomalyTypeList');
    if (anomalyList) {
      anomalyList.innerHTML = anomalies.byType.length
        ? anomalies.byType.slice(0, 6).map((entry) => indicatorRow(
            ISSUE_TYPE_LABELS[entry.type] || entry.type,
            `${entry.open} ouverte(s)`,
            `${entry.pct} %`
          )).join('')
        : '<div class="empty-state">Aucune anomalie détectée.</div>';
    }

    const statusList = document.getElementById('validationStatusList');
    if (statusList) {
      const total = Object.values(validation.byStatus).reduce((a, b) => a + b, 0);
      const pct = (n) => (total ? Math.round((n / total) * 100) : 0);
      statusList.innerHTML = total
        ? [
            ['validé', validation.valid],
            ['en attente', validation.pending],
            ['incomplet', validation.incomplete],
            ['rejeté', validation.rejected]
          ].map(([label, n]) => indicatorRow(label, String(n), `${pct(n)} %`)).join('')
        : '<div class="empty-state">Aucune fiche collectée.</div>';
    }

    const archiveList = document.getElementById('archivingList');
    if (archiveList) {
      archiveList.innerHTML = archiving.total
        ? [
            indicatorRow('Fiches archivées', `${archiving.archivedRecords}`, `${archiving.rate} % du fonds`),
            indicatorRow('Confidentialité', `${archiving.confidential}`, 'confidentiel/strict'),
            indicatorRow('Rétention moyenne', `${archiving.avgRetention} ans`),
            indicatorRow('Échéance < 3 ans', `${archiving.dueBefore}`),
            ...archiving.byClassification.slice(0, 3).map((entry) => indicatorRow(entry.label, String(entry.count), `${entry.pct} %`))
          ].join('')
        : '<div class="empty-state">Aucune fiche archivée.</div>';
    }
  }

  function renderCategoryLegend(entries) {
    // Palette dérivée du rang : les catégories n'ont pas de couleur en base.
    const palette = ['#38c6ff', '#33d17a', '#8b6bff', '#ff9d3d', '#ff4fa3', '#6cc3ff'];
    const legend = document.getElementById('trafficLegend');
    if (!legend) return;
    legend.innerHTML = entries.map((entry, index) => `
      <div class="legend-row">
        <span class="legend-dot" style="background:${palette[index % palette.length]}"></span>
        <span class="lbl">${escapeHTML(entry.label)}</span>
        <span class="val">${fmtInt(entry.count)} · ${entry.pct} %</span>
      </div>
    `).join('');
  }

  const STATUS_CLASS = { 'Livré': 'done', 'En cours': 'progress' };

  function renderProjects(projects) {
    document.getElementById('projectList').innerHTML = projects.map(p => `
      <div class="project-row">
        <div class="thumb" style="background:${safeGradient(p.thumbGradient)}"></div>
        <div class="p-info">
          <div class="p-title">${escapeHTML(p.title)}</div>
          <div class="p-date">${new Date(p.date).toLocaleDateString('fr-FR', { day: '2-digit', month: 'long', year: 'numeric' })}</div>
        </div>
        <div class="status ${STATUS_CLASS[p.status] || ''}"><span class="sdot"></span>${escapeHTML(p.status)}</div>
        <div class="more-dots" data-id="${p.id}" data-title="${escapeHTML(p.title)}">⋯</div>
      </div>
    `).join('');
  }

  let visitsChart, donutChart;

  function renderVisits(data) {
    const summary = document.getElementById('collectionSummary');
    if (summary) {
      summary.innerHTML = `${fmtInt(data.total)} fiche(s) collectée(s) sur la période`;
    }

    const ctx = document.getElementById('visitsChart').getContext('2d');
    const grad = ctx.createLinearGradient(0, 0, 0, 230);
    grad.addColorStop(0, 'rgba(56,198,255,0.35)');
    grad.addColorStop(1, 'rgba(56,198,255,0)');

    const chartData = {
      labels: data.labels,
      datasets: [{
        data: data.values,
        borderColor: '#38c6ff',
        borderWidth: 2.5,
        pointRadius: 0,
        pointHoverRadius: 5,
        pointHoverBackgroundColor: '#38c6ff',
        pointHoverBorderColor: '#fff',
        tension: 0.4,
        fill: true,
        backgroundColor: grad
      }]
    };

    if (visitsChart) { visitsChart.data = chartData; visitsChart.update(); return; }

    visitsChart = new Chart(ctx, {
      type: 'line',
      data: chartData,
      options: {
        responsive: true,
        maintainAspectRatio: false,
        interaction: { intersect: false, mode: 'index' },
        plugins: {
          legend: { display: false },
          tooltip: {
            backgroundColor: '#0d2144', borderColor: 'rgba(93,164,255,0.3)', borderWidth: 1,
            titleColor: '#9db2d6', bodyColor: '#fff', padding: 10, displayColors: false,
            callbacks: { label: (c) => fmtInt(c.parsed.y) + ' fiche(s)' }
          }
        },
        scales: {
          x: { grid: { display: false }, ticks: { color: '#5f7699', font: { size: 11 }, maxTicksLimit: 8 } },
          y: { grid: { color: 'rgba(93,164,255,0.08)' }, ticks: { color: '#5f7699', font: { size: 11 } } }
        }
      }
    });
  }

  function renderDonut(sources) {
    const center = document.getElementById('donutCenterN');
    if (center) center.textContent = fmtInt(window.__lastCollectionTotal || 0);
    const dctx = document.getElementById('donutChart').getContext('2d');
    const chartData = {
      datasets: [{
        data: sources.map(s => s.pct),
        backgroundColor: sources.map(s => s.color),
        borderColor: '#0b1c3a', borderWidth: 3, hoverOffset: 6
      }]
    };
    if (donutChart) { donutChart.data = chartData; donutChart.update(); return; }
    donutChart = new Chart(dctx, {
      type: 'doughnut',
      data: chartData,
      options: { responsive: true, maintainAspectRatio: false, cutout: '72%', plugins: { legend: { display: false } } }
    });
  }

  async function loadVisits(range) {
    const res = await apiFetch(`${API_BASE}/api/indicators?range=${range}`);
    const data = await res.json();
    renderIndicatorCards(data, 'statsGrid');
    renderWorkPanels(data);
    window.__lastCollectionTotal = data.collection.total;
    renderVisits(data.collection.byDay);
    renderDonut(data.collection.byCategory);
    renderCategoryLegend(data.collection.byCategory);
  }

  async function loadDashboard() {
    const statusEl = document.getElementById('apiStatus');
    const statusText = document.getElementById('apiStatusText');
    try {
      const me = await loadCurrentUser().catch(() => null);
      if (me && me.username) {
        document.getElementById('userName').textContent = me.username;
      }
      const res = await apiFetch(`${API_BASE}/api/dashboard`);
      if (!res.ok) throw new Error('API error ' + res.status);
      const data = await res.json();

      renderIndicatorCards(data.indicators, 'statsGrid');
      renderWorkPanels(data.indicators);
      renderProjects(data.projects);
      window.__lastCollectionTotal = data.indicators.collection.total;
      renderVisits(data.indicators.collection.byDay);
      renderDonut(data.indicators.collection.byCategory);
      renderCategoryLegend(data.indicators.collection.byCategory);

      statusText.textContent = 'API connectée';
      statusEl.classList.remove('offline');

    } catch (err) {
      if (err.message !== 'unauthorized') {
        console.error(err);
        statusText.textContent = 'API hors ligne';
        statusEl.classList.add('offline');
      }
    }
  }

  document.getElementById('rangeSelect').addEventListener('change', (e) => {
    loadVisits(e.target.value);
  });

  document.getElementById('logoutBtn').addEventListener('click', () => {
    clearToken();
    showLogin();
  });

  // ---------- Changement de mot de passe ----------
  const pwdOverlay = document.getElementById('pwdOverlay');
  const pwdMsg = document.getElementById('pwdMsg');

  function openPwdModal() {
    pwdMsg.textContent = '';
    pwdMsg.className = 'modal-msg';
    document.getElementById('pwdForm').reset();
    pwdOverlay.style.display = 'flex';
    document.getElementById('pwdCurrent').focus();
  }

  function closePwdModal() {
    pwdOverlay.style.display = 'none';
  }

  document.getElementById('userChip').addEventListener('click', openPwdModal);
  document.getElementById('pwdClose').addEventListener('click', closePwdModal);
  document.getElementById('pwdCancel').addEventListener('click', closePwdModal);
  pwdOverlay.addEventListener('click', (e) => { if (e.target === pwdOverlay) closePwdModal(); });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closePwdModal(); });

  document.getElementById('pwdForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const currentPassword = document.getElementById('pwdCurrent').value;
    const newPassword = document.getElementById('pwdNew').value;
    const confirmPassword = document.getElementById('pwdConfirm').value;

    pwdMsg.className = 'modal-msg';

    if (newPassword !== confirmPassword) {
      pwdMsg.textContent = 'Les deux nouveaux mots de passe ne correspondent pas.';
      pwdMsg.classList.add('err');
      return;
    }
    if (newPassword.length < 8) {
      pwdMsg.textContent = 'Le nouveau mot de passe doit faire au moins 8 caractères.';
      pwdMsg.classList.add('err');
      return;
    }

    try {
      const res = await apiFetch(`${API_BASE}/api/auth/change-password`, {
        method: 'POST',
        allow401: true, // un 401 ici = mot de passe actuel incorrect, pas une session expirée
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ currentPassword, newPassword })
      });
      const data = await res.json();
      if (!res.ok) {
        pwdMsg.textContent = data.error || 'Changement impossible';
        pwdMsg.classList.add('err');
        return;
      }
      pwdMsg.textContent = 'Mot de passe modifié avec succès.';
      pwdMsg.classList.add('ok');
      if (data.token) setToken(data.token);
      setTimeout(closePwdModal, 1200);
    } catch (err) {
      if (err.message !== 'unauthorized') {
        pwdMsg.textContent = 'Impossible de contacter le serveur.';
        pwdMsg.classList.add('err');
      }
    }
  });

  // ============================================================
  // Navigation multi-vues (pages de la sidebar)
  // ============================================================
  const fmtDateFR = (d) => new Date(d).toLocaleDateString('fr-FR', { day: '2-digit', month: 'long', year: 'numeric' });
  let currentView = 'dashboard';

  async function fetchJson(url, options = {}) {
    const res = await apiFetch(url, options);
    if (!res.ok) throw new Error('API ' + res.status);
    return res.json();
  }

  // ─── Accès paginé aux listes volumineuses ──────────────────────────────────
  // Les endpoints /api/records et /api/validation/issues renvoient désormais
  // { items, page, limit, total, totalPages }. Ces helpers unwrappent `items` pour
  // que le reste du code continue de manipuler des tableaux, tout en exposant
  // la pagination et les filtres côté serveur.
  const MAX_PAGE_SIZE = 200;

  async function fetchPagedList(path, params = {}) {
    const query = new URLSearchParams();
    for (const [key, value] of Object.entries(params)) {
      if (value !== undefined && value !== null && value !== '') query.set(key, value);
    }
    if (!query.has('limit')) query.set('limit', MAX_PAGE_SIZE);
    const qs = query.toString();
    const payload = await fetchJson(`${API_BASE}${path}${qs ? '?' + qs : ''}`);
    if (Array.isArray(payload)) return { items: payload, page: 1, limit: payload.length, total: payload.length, totalPages: 1 };
    return payload;
  }

  function fetchRecordsPage(params) { return fetchPagedList('/api/records', params); }
  function fetchIssuesPage(params) { return fetchPagedList('/api/validation/issues', params); }

  function showView(name) {
    currentView = name;
    document.querySelectorAll('.view').forEach(v => v.classList.toggle('active', v.id === 'view-' + name));
    document.querySelectorAll('.nav-item').forEach(n => n.classList.toggle('active', n.dataset.view === name));
    const loader = viewLoaders[name];
    if (loader) loader().catch(err => console.error('Vue ' + name + ' :', err));
  }

  document.querySelectorAll('.nav-item').forEach(n => {
    n.addEventListener('click', () => showView(n.dataset.view));
  });

  // ---------- Vue : Sites web ----------
  const GRADIENTS = [
    'linear-gradient(135deg,#2a5fb0,#173a70)',
    'linear-gradient(135deg,#c98bd6,#7a4d9e)',
    'linear-gradient(135deg,#3fa9d6,#1b5f8a)'
  ];

  function projectCardHTML(p) {
    return `
      <div class="site-card" data-title="${escapeHTML((p.title || '').toLowerCase())}">
        <div class="thumb-lg" style="background:${safeGradient(p.thumbGradient)}"></div>
        <div class="p-title">${escapeHTML(p.title)}</div>
        <div class="p-date">${fmtDateFR(p.date)}</div>
        <div class="site-foot">
          <div class="status ${STATUS_CLASS[p.status] || ''}"><span class="sdot"></span>${escapeHTML(p.status)}</div>
          <div class="more-dots" data-id="${p.id}" data-title="${escapeHTML(p.title)}" data-status="${escapeHTML(p.status || 'En cours')}" data-date="${escapeHTML(p.date || '')}">⋯</div>
        </div>
      </div>`;
  }

  async function loadSites() {
    const projects = await fetchJson(`${API_BASE}/api/projects`);
    const grid = document.getElementById('siteGrid');
    grid.innerHTML = projects.length
      ? projects.map(projectCardHTML).join('')
      : '<div class="empty-state">Aucun site pour le moment. Crée ton premier projet !</div>';
  }

  // ---------- Vue : Clients ----------
  const CLIENT_CHIP = { 'Actif': 'ok', 'Prospect': 'info', 'Inactif': 'off' };

  async function loadClients() {
    const clients = await fetchJson(`${API_BASE}/api/clients`);
    document.getElementById('clientRows').innerHTML = clients.map(c => `
      <tr>
        <td><b>${escapeHTML(c.name)}</b></td>
        <td>${escapeHTML(c.company || '—')}</td>
        <td>${escapeHTML(c.email || '—')}</td>
        <td>${escapeHTML(c.site || '—')}</td>
        <td><span class="chip ${CLIENT_CHIP[c.status] || 'info'}">${escapeHTML(c.status)}</span></td>
      </tr>`).join('');
  }

  // ---------- Vue : Statistiques ----------
  let barChart;

  async function loadStatsView() {
    const data = await fetchJson(`${API_BASE}/api/indicators?range=90d`);

    renderIndicatorCards(data, 'statsViewCards');
    renderWorkPanels(data);

    const archiveList = document.getElementById('statsArchiveList');
    if (archiveList) {
      archiveList.innerHTML = data.archiving.byClassification.length
        ? data.archiving.byClassification.map((entry) => indicatorRow(entry.label, String(entry.count), `${entry.pct} %`)).join('')
        : '<div class="empty-state">Aucune fiche archivée.</div>';
    }

    const bctx = document.getElementById('barChart').getContext('2d');
    const barData = {
      labels: data.collection.bySource.map(s => s.label),
      datasets: [{
        data: data.collection.bySource.map(s => s.count),
        backgroundColor: data.collection.bySource.map(s => s.pct),
        borderRadius: 8, maxBarThickness: 42
      }]
    };
    if (barChart) { barChart.data = barData; barChart.update(); return; }
    barChart = new Chart(bctx, {
      type: 'bar',
      data: barData,
      options: {
        responsive: true, maintainAspectRatio: false,
        plugins: { legend: { display: false } },
        scales: {
          x: { grid: { display: false }, ticks: { color: '#5f7699', font: { size: 11 } } },
          y: { grid: { color: 'rgba(93,164,255,0.08)' }, ticks: { color: '#5f7699', font: { size: 11 } } }
        }
      }
    });
  }

  // ---------- Vue : Commandes ----------
  const ORDER_CHIP = { 'Payée': 'ok', 'Livrée': 'ok', 'En attente': 'wait', 'Annulée': 'off' };

  async function loadOrders() {
    const orders = await fetchJson(`${API_BASE}/api/orders`);
    document.getElementById('orderRows').innerHTML = orders.map(o => `
      <tr>
        <td><b>${escapeHTML(o.ref)}</b></td>
        <td>${escapeHTML(o.clientName)}</td>
        <td>${escapeHTML(o.item)}</td>
        <td class="num">${fmtUSD(Number(o.amount))}</td>
        <td><span class="chip ${ORDER_CHIP[o.status] || 'info'}">${escapeHTML(o.status)}</span></td>
        <td>${fmtDateFR(o.date)}</td>
      </tr>`).join('');
    const total = orders.reduce((a, o) => a + Number(o.amount), 0);
    document.getElementById('ordersTotal').innerHTML =
      `${orders.length} commande(s) — Total : <b>${fmtUSD(total)}</b>`;
  }

  // ---------- Vue : Maintenance ----------
  async function loadMaintenance() {
    const projects = await fetchJson(`${API_BASE}/api/projects`);
    const enCours = projects.filter(p => p.status === 'En cours');
    const livrés = projects.filter(p => p.status === 'Livré');

    const cards = [
      { icon: 'sitesWeb', label: 'Sites suivis', value: projects.length, delta: 0 },
      { icon: 'commandes', label: 'En maintenance', value: enCours.length, delta: 0 },
      { icon: 'clients', label: 'Sites livrés', value: livrés.length, delta: 0 }
    ];
    document.getElementById('maintenanceCards').innerHTML = cards.map(c => `
      <div class="stat-card">
        <div class="stat-top">${ICONS[c.icon]}<div class="stat-label">${c.label}</div></div>
        <div class="stat-value">${c.value}</div>
      </div>`).join('');

    document.getElementById('maintenanceList').innerHTML = (enCours.length ? enCours : projects).map(p => `
      <div class="project-row">
        <div class="thumb" style="background:${safeGradient(p.thumbGradient)}"></div>
        <div class="p-info">
          <div class="p-title">${escapeHTML(p.title)}</div>
          <div class="p-date">${fmtDateFR(p.date)}</div>
        </div>
        <div class="status ${STATUS_CLASS[p.status] || ''}"><span class="sdot"></span>${escapeHTML(p.status)}</div>
        <div class="more-dots" data-id="${p.id}" data-title="${escapeHTML(p.title)}" data-status="${escapeHTML(p.status || 'En cours')}" data-date="${escapeHTML(p.date || '')}">⋯</div>
      </div>`).join('');
  }

  // ---------- Vue : Messages ----------
  async function updateMsgBadge() {
    try {
      const msgs = await fetchJson(`${API_BASE}/api/messages`);
      const n = msgs.filter(m => !m.isRead).length;
      const badge = document.getElementById('msgBadge');
      badge.textContent = n;
      badge.classList.toggle('zero', n === 0);
      return msgs;
    } catch (err) {
      return [];
    }
  }

  async function loadMessages() {
    const msgs = await updateMsgBadge();
    const list = document.getElementById('msgList');
    list.innerHTML = msgs.length ? msgs.map(m => `
      <div class="msg-row ${m.isRead ? '' : 'unread'}">
        <div class="msg-avatar">${escapeHTML(m.sender).slice(0, 2).toUpperCase()}</div>
        <div class="msg-body">
          <div class="msg-top"><span class="sender">${escapeHTML(m.sender)}</span><span class="when">${fmtDateFR(m.createdAt)}</span>${m.isRead ? '' : '<span class="unread-dot"></span>'}</div>
          <div class="msg-subject">${escapeHTML(m.subject)}</div>
          <div class="msg-text">${escapeHTML(m.body)}</div>
        </div>
      </div>`).join('') : '<div class="empty-state">Aucun message.</div>';
  }

  async function loadUsers() {
    try {
      const [users, currentUser] = await Promise.all([
        fetchJson(`${API_BASE}/api/users`),
        fetchJson(`${API_BASE}/api/auth/me`)
      ]);
      const canManageUsers = currentUser.role === 'admin';
      const userRows = document.getElementById('userRows');
      const staticUserRows = document.getElementById('staticUserRows');
      const createUserForm = document.getElementById('createUserForm');
      if (createUserForm) createUserForm.hidden = !canManageUsers;
      const html = users.length ? users.map((user) => `
        <tr>
          <td><b>${escapeHTML(user.username)}</b></td>
          <td>
            ${canManageUsers ? `<select class="select-full" data-user-id="${user.id}" data-role="${user.role || 'capturer'}">
              <option value="admin" ${user.role === 'admin' ? 'selected' : ''}>Admin</option>
              <option value="manager" ${user.role === 'manager' ? 'selected' : ''}>Manager</option>
              <option value="capturer" ${user.role === 'capturer' || !user.role ? 'selected' : ''}>Capturer</option>
              <option value="viewer" ${user.role === 'viewer' ? 'selected' : ''}>Viewer</option>
            </select>` : escapeHTML(user.role || 'capturer')}
          </td>
          <td><span class="chip ${user.isActive ? 'ok' : 'off'}">${user.isActive ? 'Actif' : 'Désactivé'}</span></td>
          <td><div class="user-actions">${canManageUsers ? `
            <button type="button" class="btn-line save-role-btn" data-user-id="${user.id}">Rôle</button>
            <button type="button" class="btn-line reset-user-password-btn" data-user-id="${user.id}" data-username="${escapeHTML(user.username)}">Mot de passe</button>
            <button type="button" class="btn-line btn-danger toggle-user-status-btn" data-user-id="${user.id}" data-username="${escapeHTML(user.username)}" data-active="${user.isActive}" ${currentUser.username === user.username && user.isActive ? 'disabled title="Tu ne peux pas désactiver ton propre compte"' : ''}>${user.isActive ? 'Désactiver' : 'Activer'}</button>
          ` : '—'}</div></td>
        </tr>
      `).join('') : '<tr><td colspan="4" class="empty-state">Aucun utilisateur.</td></tr>';

      if (userRows) userRows.innerHTML = html;
      if (staticUserRows) staticUserRows.innerHTML = users.length ? users.slice(0, 6).map((user) => `
        <tr>
          <td><b>${escapeHTML(user.username)}</b></td>
          <td>${escapeHTML(user.role || 'capturer')}</td>
          <td><span class="chip ${user.isActive ? 'ok' : 'off'}">${user.isActive ? 'Actif' : 'Désactivé'}</span></td>
        </tr>
      `).join('') : '<tr><td colspan="3" class="empty-state">Aucun utilisateur.</td></tr>';
    } catch (err) {
      console.error(err);
      const userRows = document.getElementById('userRows');
      if (userRows) userRows.innerHTML = '<tr><td colspan="4" class="empty-state">Erreur de chargement.</td></tr>';
      const staticUserRows = document.getElementById('staticUserRows');
      if (staticUserRows) staticUserRows.innerHTML = '<tr><td colspan="3" class="empty-state">Erreur de chargement.</td></tr>';
    }
  }

  async function loadValidationRules() {
    const panel = document.getElementById('validationRulesPanel');
    try {
      const currentUser = await fetchJson(`${API_BASE}/api/auth/me`);
      panel.hidden = currentUser.role !== 'admin';
      if (panel.hidden) return;
      const rules = await fetchJson(`${API_BASE}/api/validation/rules`);
      document.getElementById('ruleRequireCategory').checked = rules.requireCategory;
      document.getElementById('ruleDuplicateReference').checked = rules.detectDuplicateReferences;
      document.getElementById('ruleRejectNegativeQuantity').checked = rules.rejectNegativeQuantity;
      document.getElementById('ruleRejectNegativeValue').checked = rules.rejectNegativeValue;
      document.getElementById('ruleMaxNotes').value = rules.maxNotesLength;
    } catch (err) {
      console.error(err);
      panel.hidden = true;
    }
  }

  document.getElementById('createUserForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const form = e.currentTarget;
    const message = document.getElementById('createUserMessage');
    message.className = 'user-create-message';
    message.textContent = '';

    const payload = {
      username: document.getElementById('newUsername').value.trim(),
      password: document.getElementById('newUserPassword').value,
      role: document.getElementById('newUserRole').value
    };

    try {
      const res = await apiFetch(`${API_BASE}/api/users`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      const data = await res.json();
      if (!res.ok) {
        message.textContent = data.error || 'Création du compte impossible.';
        message.classList.add('err');
        return;
      }
      form.reset();
      message.textContent = `Compte « ${data.username} » créé.`;
      message.classList.add('ok');
      await Promise.all([loadUsers(), loadAuditTrail()]);
    } catch (err) {
      message.textContent = 'Impossible de contacter le serveur.';
      message.classList.add('err');
    }
  });

  document.getElementById('validationRulesForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const message = document.getElementById('validationRulesMessage');
    message.className = 'user-create-message supervision-message';
    message.textContent = '';
    const rules = {
      requireCategory: document.getElementById('ruleRequireCategory').checked,
      detectDuplicateReferences: document.getElementById('ruleDuplicateReference').checked,
      rejectNegativeQuantity: document.getElementById('ruleRejectNegativeQuantity').checked,
      rejectNegativeValue: document.getElementById('ruleRejectNegativeValue').checked,
      maxNotesLength: Number(document.getElementById('ruleMaxNotes').value)
    };
    try {
      const res = await apiFetch(`${API_BASE}/api/validation/rules`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(rules)
      });
      const data = await res.json();
      if (!res.ok) {
        message.textContent = data.error || 'Enregistrement impossible.';
        message.classList.add('err');
        return;
      }
      message.textContent = 'Règles de validation enregistrées.';
      message.classList.add('ok');
      await loadAuditTrail();
    } catch (err) {
      if (err.message !== 'unauthorized') {
        message.textContent = 'Impossible de contacter le serveur.';
        message.classList.add('err');
      }
    }
  });

  async function loadAuditTrail() {
    try {
      const logs = await fetchJson(`${API_BASE}/api/security/audit`);
      const rows = document.getElementById('auditRows');
      const securityRows = document.getElementById('staticSecurityRows');
      const html = logs.length ? logs.map((log) => `
        <tr>
          <td>${escapeHTML(log.username || 'Système')}</td>
          <td>${escapeHTML(log.action || '—')}</td>
          <td>${escapeHTML(log.entity || '—')}</td>
          <td>${fmtDateFR(log.createdAt)}</td>
        </tr>
      `).join('') : '<tr><td colspan="4" class="empty-state">Aucun événement.</td></tr>';
      if (rows) rows.innerHTML = html;
      if (securityRows) securityRows.innerHTML = logs.length ? logs.slice(0, 6).map((log) => `
        <tr>
          <td>${fmtDateFR(log.createdAt)}</td>
          <td>${escapeHTML(log.username || 'Système')}</td>
          <td>${escapeHTML(log.action || '—')}</td>
          <td>${escapeHTML(log.entity || '—')}</td>
        </tr>
      `).join('') : '<tr><td colspan="4" class="empty-state">Aucun événement à afficher.</td></tr>';
    } catch (err) {
      console.error(err);
      const rows = document.getElementById('auditRows');
      if (rows) rows.innerHTML = '<tr><td colspan="4" class="empty-state">Erreur de chargement.</td></tr>';
      const securityRows = document.getElementById('staticSecurityRows');
      if (securityRows) securityRows.innerHTML = '<tr><td colspan="4" class="empty-state">Erreur de chargement.</td></tr>';
    }
  }

  document.addEventListener('click', async (e) => {
    const resetButton = e.target.closest('.reset-user-password-btn');
    if (resetButton) {
      document.getElementById('resetUserId').value = resetButton.dataset.userId;
      document.getElementById('resetUserLabel').textContent = `Nouveau mot de passe pour ${resetButton.dataset.username}`;
      document.getElementById('userPasswordMessage').textContent = '';
      document.getElementById('userPasswordMessage').className = 'modal-msg';
      document.getElementById('userPasswordForm').reset();
      document.getElementById('resetUserId').value = resetButton.dataset.userId;
      document.getElementById('userPasswordOverlay').style.display = 'flex';
      document.getElementById('resetUserPassword').focus();
      return;
    }

    const statusButton = e.target.closest('.toggle-user-status-btn');
    if (statusButton) {
      const wasActive = statusButton.dataset.active === 'true';
      const nextActive = !wasActive;
      const action = nextActive ? 'réactiver' : 'désactiver';
      if (!window.confirm(`Confirmer ${action} le compte « ${statusButton.dataset.username} » ?`)) return;
      try {
        const res = await apiFetch(`${API_BASE}/api/users/${statusButton.dataset.userId}/status`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ active: nextActive })
        });
        const data = await res.json();
        if (!res.ok) {
          showSupervisionMessage(data.error || 'Modification du compte impossible.', true);
          return;
        }
        showSupervisionMessage(`Compte « ${data.username} » ${nextActive ? 'activé' : 'désactivé'}.`);
        await Promise.all([loadUsers(), loadAuditTrail()]);
      } catch (err) {
        if (err.message !== 'unauthorized') showSupervisionMessage('Impossible de contacter le serveur.', true);
      }
      return;
    }

    const button = e.target.closest('.save-role-btn');
    if (!button) return;
    const userId = Number(button.dataset.userId);
    const select = document.querySelector(`select[data-user-id="${userId}"]`);
    const role = select ? select.value : 'capturer';

    try {
      const res = await apiFetch(`${API_BASE}/api/users/${userId}/role`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ role })
      });
      const data = await res.json();
      if (!res.ok) {
        showSupervisionMessage(data.error || 'Erreur de rôle.', true);
        return;
      }
      showSupervisionMessage('Rôle mis à jour.');
      await Promise.all([loadUsers(), loadAuditTrail()]);
    } catch (err) {
      if (err.message !== 'unauthorized') showSupervisionMessage('Impossible de contacter le serveur.', true);
    }
  });

  function showSupervisionMessage(text, isError = false) {
    const message = document.getElementById('supervisionMessage');
    message.textContent = text;
    message.className = `user-create-message supervision-message${isError ? ' err' : ' ok'}`;
  }

  function closeUserPasswordModal() {
    document.getElementById('userPasswordOverlay').style.display = 'none';
    document.getElementById('userPasswordForm').reset();
  }

  document.getElementById('userPasswordClose').addEventListener('click', closeUserPasswordModal);
  document.getElementById('userPasswordCancel').addEventListener('click', closeUserPasswordModal);

  document.getElementById('userPasswordForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const userId = document.getElementById('resetUserId').value;
    const password = document.getElementById('resetUserPassword').value;
    const message = document.getElementById('userPasswordMessage');
    message.textContent = '';
    message.className = 'modal-msg';
    try {
      const res = await apiFetch(`${API_BASE}/api/users/${userId}/password`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password })
      });
      const data = await res.json();
      if (!res.ok) {
        message.textContent = data.error || 'Réinitialisation impossible.';
        message.classList.add('err');
        return;
      }
      closeUserPasswordModal();
      showSupervisionMessage('Mot de passe remplacé; les sessions de cet utilisateur ont été révoquées. Transmets-lui son nouveau mot de passe de façon sécurisée.');
      await loadAuditTrail();
    } catch (err) {
      if (err.message !== 'unauthorized') {
        message.textContent = 'Impossible de contacter le serveur.';
        message.classList.add('err');
      }
    }
  });

  document.getElementById('markReadBtn').addEventListener('click', async () => {
    try {
      await fetchJson(`${API_BASE}/api/messages/read-all`, { method: 'POST' });
      loadMessages();
    } catch (err) { console.error(err); }
  });

  // ---------- Vue : Paramètres ----------
  document.getElementById('settingsPwdForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const msgEl = document.getElementById('setPwdMsg');
    const currentPassword = document.getElementById('setPwdCurrent').value;
    const newPassword = document.getElementById('setPwdNew').value;
    const confirmPassword = document.getElementById('setPwdConfirm').value;

    msgEl.className = 'modal-msg';
    if (newPassword !== confirmPassword) {
      msgEl.textContent = 'Les deux nouveaux mots de passe ne correspondent pas.';
      msgEl.classList.add('err');
      return;
    }
    if (newPassword.length < 8) {
      msgEl.textContent = 'Le nouveau mot de passe doit faire au moins 8 caractères.';
      msgEl.classList.add('err');
      return;
    }
    try {
      const res = await apiFetch(`${API_BASE}/api/auth/change-password`, {
        method: 'POST',
        allow401: true,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ currentPassword, newPassword })
      });
      const data = await res.json();
      if (!res.ok) {
        msgEl.textContent = data.error || 'Changement impossible';
        msgEl.classList.add('err');
        return;
      }
      msgEl.textContent = 'Mot de passe modifié avec succès.';
      msgEl.classList.add('ok');
      if (data.token) setToken(data.token);
      document.getElementById('settingsPwdForm').reset();
    } catch (err) {
      if (err.message !== 'unauthorized') {
        msgEl.textContent = 'Impossible de contacter le serveur.';
        msgEl.classList.add('err');
      }
    }
  });

  document.getElementById('settingsLogout').addEventListener('click', () => {
    clearToken();
    showLogin();
  });

  // ---------- Boutons de la topbar / hero ----------

  // Pill de dates : cycles entre les périodes
  const RANGE_LABELS = { '7d': '7 derniers jours', '30d': '30 derniers jours', '90d': '90 derniers jours' };
  const rangeSelect = document.getElementById('rangeSelect');
  document.getElementById('datePill').addEventListener('click', () => {
    const order = ['7d', '30d', '90d'];
    const next = order[(order.indexOf(rangeSelect.value) + 1) % order.length];
    rangeSelect.value = next;
    document.getElementById('rangeLabel').textContent = RANGE_LABELS[next];
    loadVisits(next);
  });

  // "Voir tout" des projets récents
  document.getElementById('seeAllProjects').addEventListener('click', () => showView('sites'));

  // Modal nouveau projet (bouton du dashboard + bouton de la vue Sites)
  const projOverlay = document.getElementById('projOverlay');
  const projMsg = document.getElementById('projMsg');
  let projectEditId = null;

  function openProjModal(project = null) {
    projMsg.textContent = '';
    projMsg.className = 'modal-msg';
    const form = document.getElementById('projForm');
    const titleEl = document.getElementById('projTitle');
    const statusEl = document.getElementById('projStatus');
    const dateEl = document.getElementById('projDate');
    const heading = document.querySelector('#projOverlay h2');
    const submitBtn = document.getElementById('projSubmit');

    form.reset();
    if (project) {
      projectEditId = Number(project.id);
      titleEl.value = project.title || '';
      statusEl.value = project.status || 'En cours';
      dateEl.value = project.date || '';
      heading.textContent = 'Modifier le projet';
      submitBtn.textContent = 'Enregistrer';
    } else {
      projectEditId = null;
      heading.textContent = 'Nouveau projet';
      submitBtn.textContent = 'Créer';
    }

    projOverlay.style.display = 'flex';
    titleEl.focus();
  }

  function closeProjModal() {
    projOverlay.style.display = 'none';
    projectEditId = null;
    document.getElementById('projForm').reset();
    document.querySelector('#projOverlay h2').textContent = 'Nouveau projet';
    document.getElementById('projSubmit').textContent = 'Créer';
  }
  document.getElementById('newProjectBtn').addEventListener('click', () => openProjModal());
  document.getElementById('newProjectBtn2').addEventListener('click', () => openProjModal());
  document.getElementById('projClose').addEventListener('click', closeProjModal);
  document.getElementById('projCancel').addEventListener('click', closeProjModal);
  projOverlay.addEventListener('click', (e) => { if (e.target === projOverlay) closeProjModal(); });

  document.getElementById('projForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const title = document.getElementById('projTitle').value.trim();
    const status = document.getElementById('projStatus').value;
    const date = document.getElementById('projDate').value;
    projMsg.className = 'modal-msg';
    if (!title || !date) {
      projMsg.textContent = 'Titre et date sont requis.';
      projMsg.classList.add('err');
      return;
    }

    const url = projectEditId ? `${API_BASE}/api/projects/${projectEditId}` : `${API_BASE}/api/projects`;
    const method = projectEditId ? 'PUT' : 'POST';

    try {
      const res = await apiFetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title, status, date })
      });
      const data = await res.json();
      if (!res.ok) {
        projMsg.textContent = data.error || (projectEditId ? 'Modification impossible' : 'Création impossible');
        projMsg.classList.add('err');
        return;
      }
      closeProjModal();
      if (currentView === 'dashboard') loadDashboard();
      else if (currentView === 'sites') loadSites();
      else if (currentView === 'maintenance') loadMaintenance();
    } catch (err) {
      if (err.message !== 'unauthorized') {
        projMsg.textContent = 'Impossible de contacter le serveur.';
        projMsg.classList.add('err');
      }
    }
  });

  // Recherche : filtre les projets affichés (dashboard + vue Sites)
  const searchInput = document.getElementById('searchInput');
  document.getElementById('searchBtn').addEventListener('click', () => {
    const visible = searchInput.style.display === 'block';
    searchInput.style.display = visible ? 'none' : 'block';
    if (visible) { searchInput.value = ''; searchInput.dispatchEvent(new Event('input')); }
    else searchInput.focus();
  });
  searchInput.addEventListener('input', () => {
    const q = searchInput.value.toLowerCase();
    document.querySelectorAll('.project-row, .site-card').forEach(el => {
      el.style.display = el.textContent.toLowerCase().includes(q) ? '' : 'none';
    });
  });

  // Cloche de notifications : messages non lus
  const notifDropdown = document.getElementById('notifDropdown');
  document.getElementById('notifBtn').addEventListener('click', async () => {
    if (notifDropdown.style.display === 'block') { notifDropdown.style.display = 'none'; return; }
    const msgs = await updateMsgBadge();
    const unread = msgs.filter(m => !m.isRead);
    document.getElementById('notifList').innerHTML = (unread.length ? unread : msgs.slice(0, 3)).map(m => `
      <div class="notif-item ${m.isRead ? '' : 'unread'}">
        <b>${escapeHTML(m.subject)}</b>
        ${escapeHTML(m.sender)} — ${escapeHTML(m.body).slice(0, 80)}…
      </div>`).join('') || '<div class="notif-item">Aucune notification.</div>';
    notifDropdown.style.display = 'block';
  });
  document.getElementById('notifAllMsgs').addEventListener('click', () => {
    notifDropdown.style.display = 'none';
    showView('messages');
  });
  document.addEventListener('click', (e) => {
    if (!notifDropdown.contains(e.target) && !e.target.closest('#notifBtn')) {
      notifDropdown.style.display = 'none';
    }
  });

  // Menu ⋯ des projets : supprimer le projet
  const rowMenu = document.getElementById('rowMenu');
  document.addEventListener('click', async (e) => {
    const dot = e.target.closest('.more-dots');
    if (dot) {
      rowMenu.innerHTML = `
        <div class="menu-item" data-action="edit-project" data-id="${dot.dataset.id}" data-title="${escapeHTML(dot.dataset.title)}" data-status="${escapeHTML(dot.dataset.status || 'En cours')}" data-date="${escapeHTML(dot.dataset.date || '')}">✎ Modifier le projet</div>
        <div class="menu-item menu-danger" data-id="${dot.dataset.id}" data-title="${escapeHTML(dot.dataset.title)}">🗑 Supprimer le projet</div>
      `;
      rowMenu.style.display = 'block';
      rowMenu.style.left = Math.min(e.clientX, window.innerWidth - 210) + 'px';
      rowMenu.style.top = Math.min(e.clientY, window.innerHeight - 60) + 'px';
      return;
    }
    const item = e.target.closest('.menu-item');
    if (item && rowMenu.style.display === 'block') {
      rowMenu.style.display = 'none';
      if (item.dataset.action === 'edit-project') {
        openProjModal({
          id: item.dataset.id,
          title: item.dataset.title,
          status: item.dataset.status,
          date: item.dataset.date
        });
        return;
      }
      if (confirm(`Supprimer "${item.dataset.title}" ? Cette action est définitive.`)) {
        try {
          await fetchJson(`${API_BASE}/api/projects/${item.dataset.id}`, { method: 'DELETE' });
          if (currentView === 'dashboard') loadDashboard(); else loadSites();
          if (currentView === 'maintenance') loadMaintenance();
        } catch (err) { console.error(err); }
      }
      return;
    }
    if (rowMenu.style.display === 'block') rowMenu.style.display = 'none';
  });

  // ---------- Registre des loaders par vue ----------

  // Labels lisibles pour les types d'anomalies
  const ISSUE_TYPE_LABELS = {
    missing_source: 'Source manquante', missing_title: 'Titre manquant',
    missing_category: 'Catégorie manquante', invalid_quantity: 'Quantité invalide',
    invalid_value: 'Valeur invalide', long_notes: 'Notes trop longues',
    invalid_status: 'Statut invalide', duplicate_reference: 'Référence en doublon'
  };

  // Cache global des anomalies et des corrections (filtrage côté client)
  let _allIssues = [];
  let _allRecords = [];
  let _allCorrections = [];
  let _recordTable = null;
  let _anomalyTable = null;
  let _correctionTable = null;

  const STATUS_CHIP = (status) => {
    const s = status || 'en_attente';
    const cls = s === 'valide' ? 'ok' : s === 'rejete' ? 'off' : s === 'incomplet' ? 'wait' : 'info';
    return `<span class="chip ${cls}">${escapeHTML(s).replace('_', ' ')}</span>`;
  };

  /** Remplit un <select> de filtre à partir des valeurs distinctes. */
  function fillDistinctOptions(selectId, values) {
    const select = document.getElementById(selectId);
    if (!select) return;
    const placeholder = select.options[0] ? select.options[0].textContent : '';
    const previous = select.value;
    select.innerHTML = `<option value="">${placeholder}</option>` +
      [...values].sort((a, b) => a.localeCompare(b, 'fr'))
        .map((v) => `<option value="${escapeHTML(v)}">${escapeHTML(v)}</option>`).join('');
    select.value = previous;
  }

  function recordRowHTML(r) {
    return `<tr>
      <td><b>${escapeHTML(r.source)}</b></td>
      <td>${escapeHTML(r.title)}</td>
      <td>${escapeHTML(r.category || '—')}</td>
      <td>${Number(r.quantity || 0)}</td>
      <td>${r.value === null ? '—' : Number(r.value).toLocaleString('fr-FR')}</td>
      <td>${STATUS_CHIP(r.status)}</td>
      <td><button type="button" class="record-edit-btn" data-record-id="${r.id}">Modifier</button></td>
    </tr>`;
  }

  function anomalyRowHTML(issue) {
    const resolved = !!issue.resolved;
    const actions = resolved
      ? '<span style="color:var(--text-faint);font-size:11.5px;">✓ Résolu</span>'
      : `<div class="anomaly-actions">
          <button class="btn-action anomaly-fix-btn"
            data-record-id="${issue.recordId}"
            data-issue-id="${issue.id}"
            data-title="${escapeHTML(issue.title || '—')}"
            data-source="${escapeHTML(issue.source || '—')}">✎ Corriger</button>
         </div>`;
    return `<tr class="${resolved ? 'resolved-row' : ''}" style="${resolved ? 'opacity:0.55;' : ''}">
      <td><b>${escapeHTML(issue.source || 'Inconnu')}</b></td>
      <td>${escapeHTML(issue.title || '—')}</td>
      <td>${escapeHTML(ISSUE_TYPE_LABELS[issue.issueType] || issue.issueType || '—')}</td>
      <td>${escapeHTML(issue.issueMessage || '—')}</td>
      <td><span class="chip ${issue.severity === 'error' ? 'off' : 'wait'}">${escapeHTML(issue.severity || 'warning')}</span></td>
      <td>${resolved ? '<span class="chip resolved">Résolu</span>' : '<span class="chip wait">Ouvert</span>'}</td>
      <td>${actions}</td>
    </tr>`;
  }

  function correctionRowHTML(c) {
    return `<tr>
      <td>${escapeHTML(c.source || 'Inconnu')}</td>
      <td>${escapeHTML(c.title || '—')}</td>
      <td>${escapeHTML(c.fieldName || '—')}</td>
      <td>${escapeHTML(c.oldValue ?? '—')}</td>
      <td>${escapeHTML(c.newValue ?? '—')}</td>
      <td>${escapeHTML(c.correctedBy || '—')}</td>
      <td>${escapeHTML(c.reason || '—')}</td>
      <td>${c.createdAt ? new Date(c.createdAt).toLocaleString('fr-FR') : '—'}</td>
    </tr>`;
  }

  const RECORD_COLUMNS = [
    { key: 'source', label: 'Source' }, { key: 'title', label: 'Titre' },
    { key: 'category', label: 'Catégorie' }, { key: 'quantity', label: 'Quantité' },
    { key: 'value', label: 'Valeur' }, { key: 'status', label: 'Statut' }
  ];
  const ANOMALY_COLUMNS = [
    { key: 'source', label: 'Source' }, { key: 'title', label: 'Donnée' },
    { key: 'issueType', label: 'Type' }, { key: 'issueMessage', label: 'Message' },
    { key: 'severity', label: 'Sévérité' }, { key: 'resolved', label: 'Statut' }
  ];
  const CORRECTION_COLUMNS = [
    { key: 'source', label: 'Source' }, { key: 'title', label: 'Donnée' },
    { key: 'fieldName', label: 'Champ' }, { key: 'oldValue', label: 'Ancienne' },
    { key: 'newValue', label: 'Nouveau' }, { key: 'correctedBy', label: 'Auteur' },
    { key: 'reason', label: 'Raison' }, { key: 'createdAt', label: 'Date' }
  ];

  function mountDataTables() {
    _recordTable = TableNav.mountTable('#recordRows', {
      columns: RECORD_COLUMNS,
      getSource: () => _allRecords,
      search: '#recordSearch',
      searchFields: ['source', 'title', 'reference', 'category', 'notes', 'status'],
      filters: [
        { field: 'status', selector: '#filterRecordStatus' },
        { field: 'category', selector: '#filterRecordCategory' },
        { field: 'source', selector: '#filterRecordSource' }
      ],
      pageSize: '#recordPageSize',
      pager: '#recordPager',
      reset: '#recordReset',
      countEl: '#recordCount',
      rowRender: recordRowHTML,
      emptyHTML: '<tr><td colspan="7"><div class="empty-state">Aucune donnée ne correspond à ces critères.</div></td></tr>'
    });

    _anomalyTable = TableNav.mountTable('#validationRows', {
      columns: ANOMALY_COLUMNS,
      getSource: () => _allIssues,
      search: '#anomalySearch',
      searchFields: ['source', 'title', 'issueType', 'issueMessage', 'severity'],
      filters: [
        { field: 'issueType', selector: '#filterAnomalyType' },
        { field: 'severity', selector: '#filterAnomalySeverity' },
        { field: 'resolvedState', selector: '#filterAnomalyStatus', test: (row, value) =>
          value === 'open' ? !row.resolved : !!row.resolved },
        { field: 'recordStatus', selector: '#filterAnomalyRecordStatus' }
      ],
      pageSize: '#anomalyPageSize',
      pager: '#anomalyPager',
      reset: '#anomalyReset',
      countEl: null,
      rowRender: anomalyRowHTML,
      emptyHTML: '<tr><td colspan="7"><div class="empty-state">Aucune anomalie ne correspond à ces critères.</div></td></tr>'
    });

    _correctionTable = TableNav.mountTable('#correctionRows', {
      columns: CORRECTION_COLUMNS,
      getSource: () => _allCorrections,
      search: '#correctionSearch',
      searchFields: ['source', 'title', 'fieldName', 'oldValue', 'newValue', 'correctedBy', 'reason'],
      pageSize: '#correctionPageSize',
      pager: '#correctionPager',
      rowRender: correctionRowHTML,
      emptyHTML: '<tr><td colspan="8"><div class="empty-state">Aucune correction pour cette recherche.</div></td></tr>'
    });
  }

  async function loadDataRecords() {
    try {
      const [recordsResult, issuesResult, corrections] = await Promise.all([
        fetchRecordsPage(),
        fetchIssuesPage(),
        fetchJson(`${API_BASE}/api/corrections`)
      ]);
      const records = recordsResult.items;
      const issues = issuesResult.items;

      _allRecords = records;
      _allCorrections = corrections;
      fillDistinctOptions('filterRecordCategory', records.map((r) => r.category).filter(Boolean));
      fillDistinctOptions('filterRecordSource', records.map((r) => r.source).filter(Boolean));

      // Enrichir les anomalies avec le statut résolu
      // Une anomalie est résolue si le record associé a un statut 'valide'
      // et qu'il existe une correction postérieure à l'anomalie
      const correctionsByRecord = {};
      for (const c of corrections) {
        if (!correctionsByRecord[c.recordId]) correctionsByRecord[c.recordId] = [];
        correctionsByRecord[c.recordId].push(c);
      }
      const recordStatusMap = {};
      for (const r of records) recordStatusMap[r.id] = r.status;

      _allIssues = issues.map(issue => ({
        ...issue,
        recordStatus: recordStatusMap[issue.recordId] || '',
        resolved: issue.status === 'valide' || recordStatusMap[issue.recordId] === 'valide'
          || (correctionsByRecord[issue.recordId] || []).some(c =>
              new Date(c.createdAt) >= new Date(issue.createdAt))
      }));

      _recordTable?.refresh();
      _anomalyTable?.refresh();
      _correctionTable?.refresh();

      const archiveSelect = document.getElementById('archiveRecordId');
      if (archiveSelect) {
        archiveSelect.innerHTML = records.length
          ? records.map(r => `<option value="${r.id}">${escapeHTML(r.title)} (${escapeHTML(r.source)})</option>`).join('')
          : '<option value="">Aucune donnée disponible</option>';
      }

      const total = records.length;
      const valid = records.filter(r => r.status === 'valide').length;
      const pending = records.filter(r => r.status === 'en_attente').length;
      document.getElementById('recordSummary').innerHTML = `
        <div class="stat-card"><div class="stat-top"><div class="stat-icon icon-blue"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 19V5M10 19V9M16 19v-6M22 19V3"/></svg></div><div class="stat-label">Total</div></div><div class="stat-value">${total}</div></div>
        <div class="stat-card"><div class="stat-top"><div class="stat-icon icon-green"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M20 6 9 17l-5-5"/></svg></div><div class="stat-label">Validés</div></div><div class="stat-value">${valid}</div></div>
        <div class="stat-card"><div class="stat-top"><div class="stat-icon icon-orange"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 8v4l3 3M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z"/></svg></div><div class="stat-label">En attente</div></div><div class="stat-value">${pending}</div></div>
      `;
    } catch (err) {
      console.error(err);
      document.getElementById('recordRows').innerHTML = '<tr><td colspan="7" class="empty-state">Erreur de chargement.</td></tr>';
      document.getElementById('validationRows').innerHTML = '<tr><td colspan="7" class="empty-state">Erreur de chargement.</td></tr>';
      document.getElementById('correctionRows').innerHTML = '<tr><td colspan="8" class="empty-state">Erreur de chargement.</td></tr>';
    }
  }

  let validationQueueRecords = [];
  let validationQueueIssues = [];
  let validationQueueFilter = 'en_attente';

  function renderValidationQueue() {
    const rows = document.getElementById('validationQueueRows');
    const filtered = validationQueueRecords.filter((record) => record.status === validationQueueFilter);
    const issueMap = new Map();
    for (const issue of validationQueueIssues) {
      const issues = issueMap.get(issue.recordId) || [];
      issues.push(issue.issueMessage);
      issueMap.set(issue.recordId, issues);
    }

    document.querySelectorAll('[data-validation-filter]').forEach((button) => {
      button.setAttribute('aria-pressed', String(button.dataset.validationFilter === validationQueueFilter));
    });

    rows.innerHTML = filtered.length ? filtered.map((record) => {
      const problems = (issueMap.get(record.id) || []).map(escapeHTML).join('<br>') || 'Aucun problème signalé';
      const actions = validationQueueFilter === 'en_attente' && currentPermissions.has('validate')
        ? `<button type="button" class="btn-action validation-decision-btn" data-record-id="${record.id}" data-status="valide">Valider</button>
           <button type="button" class="btn-action validation-decision-btn" data-record-id="${record.id}" data-status="rejete">Rejeter</button>`
        : '—';
      return `<tr><td>${record.id}</td><td>${escapeHTML(record.title)}</td><td>${escapeHTML(record.source)}</td><td>${problems}</td><td>${STATUS_CHIP(record.status)}</td><td>${actions}</td></tr>`;
    }).join('') : '<tr><td colspan="6" class="empty-state">Aucune donnée dans cette file.</td></tr>';
  }

  async function loadValidationQueue() {
    const rows = document.getElementById('validationQueueRows');
    try {
      const [recordsResult, issuesResult] = await Promise.all([
        fetchRecordsPage({ status: validationQueueFilter }),
        fetchIssuesPage()
      ]);
      validationQueueRecords = recordsResult.items;
      validationQueueIssues = issuesResult.items;
      renderValidationQueue();
      document.getElementById('validationQueueMessage').textContent = currentPermissions.has('validate')
        ? '' : 'Consultation seule : votre rôle ne permet pas de valider les données.';
    } catch (err) {
      rows.innerHTML = '<tr><td colspan="6" class="empty-state">Impossible de charger la file de validation.</td></tr>';
    }
  }

  document.querySelectorAll('[data-validation-filter]').forEach((button) => {
    button.addEventListener('click', () => {
      validationQueueFilter = button.dataset.validationFilter;
      renderValidationQueue();
    });
  });

  document.getElementById('validationQueueRows').addEventListener('click', async (event) => {
    const button = event.target.closest('.validation-decision-btn');
    if (!button || !currentPermissions.has('validate')) return;
    button.disabled = true;
    try {
      const response = await apiFetch(`${API_BASE}/api/records/${button.dataset.recordId}/status`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          status: button.dataset.status,
          reason: button.dataset.status === 'valide' ? 'Validation depuis la file de vérification' : 'Rejet depuis la file de vérification'
        })
      });
      const data = await response.json();
      if (!response.ok) {
        document.getElementById('validationQueueMessage').textContent = data.error || 'Décision impossible.';
        return;
      }
      await Promise.all([loadValidationQueue(), loadDataRecords()]);
      document.getElementById('validationQueueMessage').textContent = button.dataset.status === 'valide'
        ? 'Donnée validée.' : 'Donnée rejetée.';
    } catch (err) {
      if (err.message !== 'unauthorized') document.getElementById('validationQueueMessage').textContent = 'Impossible de contacter le serveur.';
    } finally {
      button.disabled = false;
    }
  });

  function renderAnomalyView() {
    const issues = _allIssues;
    const openCount = issues.filter((issue) => !issue.resolved).length;
    document.getElementById('anomalyCount').textContent = `${issues.length} anomalie(s) · ${openCount} ouverte(s)`;
    document.getElementById('anomalyViewRows').innerHTML = issues.length
      ? issues.map(anomalyRowHTML).join('')
      : '<tr><td colspan="7" class="empty-state">Aucune anomalie détectée.</td></tr>';
  }

  async function loadAnomaliesView() {
    await loadDataRecords();
    renderAnomalyView();
  }

  // ─── Import de lots CSV / Excel ──────────────────────────────────────────────
  const IMPORT_FIELD_LABELS = {
    source: 'Source', reference: 'Référence', title: 'Titre', category: 'Catégorie',
    status: 'Statut', quantity: 'Quantité', value: 'Valeur', notes: 'Notes'
  };
  const importOverlay = document.getElementById('importOverlay');
  let importState = { token: null, filename: '', headers: [], mapping: {}, fields: [] };

  function setImportMsg(target, text, kind = '') {
    const el = document.getElementById(target);
    el.textContent = text;
    el.className = 'modal-msg' + (kind ? ' ' + kind : '');
  }

  function closeImportModal() {
    importOverlay.style.display = 'none';
    importState.token = null;
  }

  document.getElementById('importClose').addEventListener('click', closeImportModal);
  document.getElementById('importCancel').addEventListener('click', closeImportModal);
  importOverlay.addEventListener('click', (e) => { if (e.target === importOverlay) closeImportModal(); });

  const importFileInput = document.getElementById('importFile');
  importFileInput.addEventListener('change', () => {
    const file = importFileInput.files[0];
    const tooLarge = file && file.size > 3 * 1024 * 1024;
    document.getElementById('importPreviewBtn').disabled = !file || tooLarge;
    setImportMsg('importMsg', tooLarge ? 'Le fichier dépasse la limite de 3 Mo.' : '');
  });

  function readFileAsBase64(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => {
        const result = String(reader.result || '');
        resolve(result.slice(result.indexOf(',') + 1));
      };
      reader.onerror = () => reject(new Error('Lecture du fichier impossible.'));
      reader.readAsDataURL(file);
    });
  }

  function renderImportMapping() {
    const { headers, mapping, fields } = importState;
    document.getElementById('importMapping').innerHTML = headers.map((header) => `
      <div>
        <label for="map-${escapeHTML(header)}" style="display:block;font-size:12px;color:var(--text-dim);margin-bottom:4px;">${escapeHTML(header)}</label>
        <select id="map-${escapeHTML(header)}" class="select-full import-map-select" data-header="${escapeHTML(header)}">
          <option value="">— Ignorer —</option>
          ${fields.map(f => `<option value="${f}" ${mapping[header] === f ? 'selected' : ''}>${IMPORT_FIELD_LABELS[f] || f}</option>`).join('')}
        </select>
      </div>`).join('');

    document.querySelectorAll('.import-map-select').forEach((select) => {
      select.addEventListener('change', () => {
        importState.mapping[select.dataset.header] = select.value || null;
      });
    });
  }

  function renderImportPreview(preview) {
    const headers = importState.headers;
    const body = document.querySelector('#importPreviewTable tbody');
    if (!preview.length) {
      body.innerHTML = '<tr><td class="empty-state">Aucune ligne.</td></tr>';
      return;
    }
    body.innerHTML = `
      <thead><tr>${headers.map(h => `<th>${escapeHTML(h)}</th>`).join('')}</tr></thead>
      <tbody>${preview.map((row) => `<tr>${headers.map(h => `<td>${escapeHTML(row[h] ?? '')}</td>`).join('')}</tr>`).join('')}</tbody>`;
  }

  function renderValidationReport(result) {
    const { summary = {}, errors = [], warnings = [] } = result || {};
    const issuesRows = [...errors.map(e => ({ ...e, level: 'error' })), ...warnings.map(w => ({ ...w, level: 'warning' }))];
    document.getElementById('importValidation').innerHTML = `
      <div style="display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:12px;margin-bottom:14px;">
        <div class="stat-card"><div class="stat-label">Lignes lues</div><div class="stat-value">${Number(summary.totalRows || 0)}</div></div>
        <div class="stat-card"><div class="stat-label">Importables</div><div class="stat-value">${Number(summary.valid || 0)}</div></div>
        <div class="stat-card"><div class="stat-label">Erreurs</div><div class="stat-value">${Number(summary.errors || 0)}</div></div>
        <div class="stat-card"><div class="stat-label">Doublons</div><div class="stat-value">${Number(summary.duplicates || 0)}</div></div>
      </div>
      ${issuesRows.length ? `
        <div style="max-height:200px;overflow:auto;border:1px solid var(--border);border-radius:10px;">
          <table class="data-table">
            <thead><tr><th>Ligne</th><th>Donnée</th><th>Niveau</th><th>Message</th></tr></thead>
            <tbody>${issuesRows.map(i => `
              <tr>
                <td>${i.line ?? '—'}</td>
                <td>${escapeHTML(i.title || '—')}</td>
                <td><span class="chip ${i.level === 'error' ? 'off' : 'wait'}">${i.level === 'error' ? 'Erreur' : 'Avertissement'}</span></td>
                <td>${escapeHTML(i.message || '—')}</td>
              </tr>`).join('')}</tbody>
          </table>
        </div>` : '<div class="modal-msg ok">Aucun problème détecté : toutes les lignes sont importables.</div>'}
      ${(result && result.mappingErrors && result.mappingErrors.length) ? `<div class="modal-msg err">${escapeHTML(result.mappingErrors.join(' '))}</div>` : ''}`;
  }

  document.getElementById('importPreviewBtn').addEventListener('click', async () => {
    const file = importFileInput.files[0];
    if (!file) return;
    setImportMsg('importMsg', 'Lecture du fichier…');
    try {
      const content = await readFileAsBase64(file);
      const res = await apiFetch(`${API_BASE}/api/imports/preview`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ filename: file.name, content })
      });
      const data = await res.json();
      if (!res.ok) {
        setImportMsg('importMsg', data.error || 'Lecture impossible.', 'err');
        return;
      }

      importState = {
        token: data.token,
        filename: data.filename,
        headers: data.headers,
        mapping: data.suggestedMapping || {},
        fields: data.fields || []
      };
      document.getElementById('importModalInfo').textContent =
        `${data.filename} — ${data.totalRows} ligne(s), ${data.headers.length} colonne(s)`;
      document.getElementById('importStep2').hidden = false;
      document.getElementById('importReanalyze').hidden = false;
      document.getElementById('importCommitBtn').hidden = true;
      renderImportMapping();
      renderImportPreview(data.preview);
      document.getElementById('importValidation').innerHTML = '';
      setImportMsg('importModalMsg', (data.mappingErrors || []).join(' ') || 'Fichier analysé. Vérifie l’association des colonnes.');
      importOverlay.style.display = 'flex';
      setImportMsg('importMsg', '');
    } catch (err) {
      setImportMsg('importMsg', err.message === 'unauthorized' ? '' : 'Impossible de lire le fichier.', 'err');
    }
  });

  async function revalidateImport() {
    setImportMsg('importModalMsg', 'Validation en cours…');
    try {
      const res = await apiFetch(`${API_BASE}/api/imports/validate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token: importState.token, mapping: importState.mapping })
      });
      const data = await res.json();
      if (!res.ok) {
        setImportMsg('importModalMsg', data.error || 'Validation impossible.', 'err');
        renderValidationReport({ mappingErrors: data.mappingErrors });
        document.getElementById('importCommitBtn').hidden = true;
        return;
      }
      renderValidationReport(data);
      document.getElementById('importCommitBtn').hidden = !data.summary.valid;
      setImportMsg('importModalMsg',
        data.summary.valid
          ? `${data.summary.valid} ligne(s) prête(s) à importer, ${data.summary.errors} en erreur.`
          : 'Aucune ligne importable : corrige l’association ou le fichier.',
        data.summary.valid ? 'ok' : 'err');
    } catch (err) {
      if (err.message !== 'unauthorized') setImportMsg('importModalMsg', 'Impossible de contacter le serveur.', 'err');
    }
  }

  document.getElementById('importReanalyze').addEventListener('click', revalidateImport);

  document.getElementById('importCommitBtn').addEventListener('click', async () => {
    setImportMsg('importModalMsg', 'Import en cours…');
    try {
      const res = await apiFetch(`${API_BASE}/api/imports/commit`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token: importState.token, skipInvalid: true })
      });
      const data = await res.json();
      if (!res.ok) {
        setImportMsg('importModalMsg', data.error || 'Import impossible.', 'err');
        return;
      }

      closeImportModal();
      importFileInput.value = '';
      document.getElementById('importPreviewBtn').disabled = true;
      const report = document.getElementById('importReport');
      const total = data.imported + data.skipped;
      report.innerHTML = `
        <div class="modal-msg ok" style="margin-top:12px;">
          Import terminé : ${data.imported} ligne(s) importée(s)
          ${data.skipped ? `, ${data.skipped} doublon(s) ignoré(s)` : ''}
          ${(data.planErrors || []).length ? `, ${data.planErrors.length} ligne(s) en erreur non importée(s)` : ''}
          sur ${total} ligne(s) analysée(s).
        </div>
        ${(data.issues || []).length ? `
          <div style="margin-top:10px;max-height:160px;overflow:auto;border:1px solid var(--border);border-radius:10px;">
            <table class="data-table">
              <thead><tr><th>Ligne</th><th>Donnée</th><th>Anomalie</th><th>Message</th></tr></thead>
              <tbody>${data.issues.map(i => `
                <tr><td>${i.line ?? '—'}</td><td>${escapeHTML(i.title || '—')}</td>
                <td>${escapeHTML(i.type || '—')}</td><td>${escapeHTML(i.message || '—')}</td></tr>`).join('')}</tbody>
            </table>
          </div>` : ''}`;
      await loadDataRecords();
    } catch (err) {
      if (err.message !== 'unauthorized') setImportMsg('importModalMsg', 'Impossible de contacter le serveur.', 'err');
    }
  });

  // Modèle CSV téléchargeable
  document.getElementById('importTemplateBtn').addEventListener('click', () => {
    const header = 'source,reference,title,category,status,quantity,value,notes';
    const sample = 'Service A,REF-001,Exemple de donnée,client,en_attente,2,150.50,Note libre';
    const blob = new Blob(['' + header + '\n' + sample + '\n'], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'modele-import-frumence.csv';
    a.click();
    URL.revokeObjectURL(url);
  });

  // ─── Modal modification d'une fiche ─────────────────────────────────────────
  const recordEditOverlay = document.getElementById('recordEditOverlay');

  function openRecordEditModal(recordId) {
    const record = _allRecords.find(r => String(r.id) === String(recordId));
    if (!record) return;
    document.getElementById('recordEditId').value = record.id;
    document.getElementById('recordEditInfo').textContent = `${record.title} (${record.source})`;
    document.getElementById('recordEditSource').value = record.source || '';
    document.getElementById('recordEditReference').value = record.reference || '';
    document.getElementById('recordEditTitleField').value = record.title || '';
    document.getElementById('recordEditCategory').value = record.category || '';
    document.getElementById('recordEditStatusField').value = record.status || 'en_attente';
    document.getElementById('recordEditQuantity').value = record.quantity ?? 0;
    document.getElementById('recordEditValue').value = record.value ?? '';
    document.getElementById('recordEditNotes').value = record.notes || '';
    document.getElementById('recordEditReason').value = '';
    const msg = document.getElementById('recordEditMsg');
    msg.textContent = '';
    msg.className = 'modal-msg';
    recordEditOverlay.style.display = 'flex';
    document.getElementById('recordEditAuthor').focus();
  }

  function closeRecordEditModal() {
    recordEditOverlay.style.display = 'none';
  }

  document.getElementById('recordEditClose').addEventListener('click', closeRecordEditModal);
  document.getElementById('recordEditCancel').addEventListener('click', closeRecordEditModal);
  recordEditOverlay.addEventListener('click', (e) => { if (e.target === recordEditOverlay) closeRecordEditModal(); });

  // Délégation : bouton "Modifier" du tableau des données capturées
  document.addEventListener('click', (e) => {
    const editBtn = e.target.closest('.record-edit-btn');
    if (!editBtn) return;
    openRecordEditModal(editBtn.dataset.recordId);
  });

  document.getElementById('recordEditForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const recordId = document.getElementById('recordEditId').value;
    const author = document.getElementById('recordEditAuthor').value.trim();
    const reason = document.getElementById('recordEditReason').value.trim();
    const msg = document.getElementById('recordEditMsg');
    msg.className = 'modal-msg';

    if (!author || !reason) {
      msg.textContent = 'L\'auteur et le motif sont requis.';
      msg.classList.add('err');
      return;
    }

    const valueRaw = document.getElementById('recordEditValue').value;
    const payload = {
      source: document.getElementById('recordEditSource').value.trim(),
      reference: document.getElementById('recordEditReference').value.trim(),
      title: document.getElementById('recordEditTitleField').value.trim(),
      category: document.getElementById('recordEditCategory').value.trim(),
      status: document.getElementById('recordEditStatusField').value,
      quantity: Number(document.getElementById('recordEditQuantity').value || 0),
      value: valueRaw === '' ? null : Number(valueRaw),
      notes: document.getElementById('recordEditNotes').value.trim(),
      correctedBy: author,
      reason
    };

    try {
      const res = await apiFetch(`${API_BASE}/api/records/${recordId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        msg.textContent = data.error || 'Modification impossible.';
        msg.classList.add('err');
        return;
      }

      const changed = (data.changes || []).length;
      msg.textContent = changed
        ? `Fiche mise à jour (${changed} champ${changed > 1 ? 's' : ''} corrigé${changed > 1 ? 's' : ''}).`
        : 'Aucun changement à enregistrer.';
      msg.classList.add('ok');
      setTimeout(closeRecordEditModal, 1200);
      await loadDataRecords();
    } catch (err) {
      if (err.message !== 'unauthorized') {
        msg.textContent = 'Impossible de contacter le serveur.';
        msg.classList.add('err');
      }
    }
  });

  // ─── Modal correction anomalie ───────────────────────────────────────────────
  const anomalyFixOverlay = document.getElementById('anomalyFixOverlay');

  function openAnomalyFixModal({ recordId, issueId, title, source }) {
    document.getElementById('anomalyFixRecordId').value = recordId;
    document.getElementById('anomalyFixIssueId').value = issueId;
    document.getElementById('anomalyFixInfo').textContent = `${title} (${source})`;
    document.getElementById('anomalyFixAuthor').value = '';
    document.getElementById('anomalyFixReason').value = '';
    document.getElementById('anomalyFixNewStatus').value = 'valide';
    const msg = document.getElementById('anomalyFixMsg');
    msg.textContent = '';
    msg.className = 'modal-msg';
    anomalyFixOverlay.style.display = 'flex';
    document.getElementById('anomalyFixAuthor').focus();
  }

  function closeAnomalyFixModal() {
    anomalyFixOverlay.style.display = 'none';
  }

  document.getElementById('anomalyFixClose').addEventListener('click', closeAnomalyFixModal);
  document.getElementById('anomalyFixCancel').addEventListener('click', closeAnomalyFixModal);
  anomalyFixOverlay.addEventListener('click', (e) => { if (e.target === anomalyFixOverlay) closeAnomalyFixModal(); });

  // Délégation : clic sur le bouton "Corriger" dans le tableau des anomalies
  document.addEventListener('click', (e) => {
    const fixBtn = e.target.closest('.anomaly-fix-btn');
    if (!fixBtn) return;
    openAnomalyFixModal({
      recordId: fixBtn.dataset.recordId,
      issueId:  fixBtn.dataset.issueId,
      title:    fixBtn.dataset.title,
      source:   fixBtn.dataset.source
    });
  });

  // Soumission du formulaire de correction
  document.getElementById('anomalyFixForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const recordId  = document.getElementById('anomalyFixRecordId').value;
    const author    = document.getElementById('anomalyFixAuthor').value.trim();
    const reason    = document.getElementById('anomalyFixReason').value.trim();
    const newStatus = document.getElementById('anomalyFixNewStatus').value;
    const msg       = document.getElementById('anomalyFixMsg');
    msg.className = 'modal-msg';

    if (!author || !reason) {
      msg.textContent = 'L\'auteur et le motif sont requis.';
      msg.classList.add('err');
      return;
    }

    try {
      // 1. Enregistrer la correction (motif + auteur + nouveau statut)
      const corrRes = await apiFetch(`${API_BASE}/api/records/${recordId}/correction`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          correctedBy: author,
          fieldName: 'status',
          oldValue: '—',
          newValue: newStatus,
          reason
        })
      });
      if (!corrRes.ok) {
        const d = await corrRes.json();
        msg.textContent = d.error || 'Correction impossible.';
        msg.classList.add('err');
        return;
      }

      // 2. Enregistrer la nouvelle valeur du statut (historique avant/après + auteur)
      const statusRes = await apiFetch(`${API_BASE}/api/records/${recordId}/status`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: newStatus, reason })
      });
      if (!statusRes.ok) {
        const d = await statusRes.json();
        msg.textContent = d.error || 'Mise à jour du statut impossible.';
        msg.classList.add('err');
        return;
      }

      msg.textContent = 'Anomalie marquée comme résolue.';
      msg.classList.add('ok');
      setTimeout(closeAnomalyFixModal, 1000);
      await loadDataRecords();
      if (currentView === 'anomalies') renderAnomalyView();
    } catch (err) {
      if (err.message !== 'unauthorized') {
        msg.textContent = 'Impossible de contacter le serveur.';
        msg.classList.add('err');
      }
    }
  });



  async function loadArchives() {
    try {
      const archives = await fetchJson(`${API_BASE}/api/archives`);
      const archiveRows = document.getElementById('archiveRows');
      archiveRows.innerHTML = archives.length
        ? archives.map(item => `
            <tr>
              <td>${escapeHTML(item.archiveCode || '—')}</td>
              <td>${escapeHTML(item.title || '—')}</td>
              <td>${escapeHTML(item.classification || 'interne')}</td>
              <td>${escapeHTML(item.confidentiality || 'interne')}</td>
              <td>${Number(item.retentionYears || 0)} an(s)</td>
              <td>${escapeHTML(item.reason || '—')}</td>
            </tr>
          `).join('')
        : '<tr><td colspan="6" class="empty-state">Aucun dossier archivé.</td></tr>';

      const docTable = document.querySelector('#view-documents tbody');
      if (docTable) {
        docTable.innerHTML = archives.length
          ? archives.map(item => `
              <tr data-confidentiality="${escapeHTML(item.confidentiality || 'interne')}" data-search="${escapeHTML([item.archiveCode, item.title, item.source, item.classification, item.reason].join(' ').toLocaleLowerCase('fr'))}">
                <td>${escapeHTML(item.archiveCode || '—')}</td>
                <td>${escapeHTML(item.source || '—')}</td>
                <td>${escapeHTML(item.classification || 'interne')}</td>
                <td>${item.archivedAt ? fmtDateFR(item.archivedAt) : '—'}</td>
                <td><span class="chip ${item.confidentiality === 'strict' || item.confidentiality === 'confidentiel' ? 'off' : 'ok'}">${escapeHTML(item.confidentiality || 'interne')}</span></td>
                <td>${escapeHTML(item.reason || '—')}</td>
              </tr>
            `).join('')
          : '<tr><td colspan="6" class="empty-state">Aucun document.</td></tr>';
        applyDocumentFilters();
      }
    } catch (err) {
      console.error(err);
      document.getElementById('archiveRows').innerHTML = '<tr><td colspan="6" class="empty-state">Erreur de chargement.</td></tr>';
      const docTable = document.querySelector('#view-documents tbody');
      if (docTable) docTable.innerHTML = '<tr><td colspan="6" class="empty-state">Erreur de chargement.</td></tr>';
    }
  }

  function applyDocumentFilters() {
    const query = document.getElementById('documentSearch').value.trim().toLocaleLowerCase('fr');
    const confidentiality = document.getElementById('documentConfidentialityFilter').value;
    document.querySelectorAll('#documentRows tr[data-search]').forEach((row) => {
      row.hidden = !row.dataset.search.includes(query) ||
        (confidentiality && row.dataset.confidentiality !== confidentiality);
    });
  }

  document.getElementById('documentSearch').addEventListener('input', applyDocumentFilters);
  document.getElementById('documentConfidentialityFilter').addEventListener('change', applyDocumentFilters);

  async function loadSourceView() {
    try {
      const [records, indicators] = await Promise.all([
        fetchJson(`${API_BASE}/api/records`),
        fetchJson(`${API_BASE}/api/indicators?range=30d`)
      ]);
      const groups = new Map();
      for (const record of records) {
        const source = record.source || 'Inconnu';
        const entry = groups.get(source) || { total: 0, treated: 0, pending: 0 };
        entry.total += 1;
        if ((record.status || 'en_attente') === 'en_attente') entry.pending += 1; else entry.treated += 1;
        groups.set(source, entry);
      }

      const rows = [...groups.entries()].map(([source, info]) => {
        const state = info.pending > 20 ? 'À surveiller' : info.pending > 0 ? 'OK' : 'Stable';
        const stateClass = info.pending > 20 ? 'wait' : info.pending > 0 ? 'ok' : 'resolved';
        return {
          source,
          total: info.total,
          treated: info.treated,
          pending: info.pending,
          state,
          stateClass
        };
      }).sort((a, b) => b.total - a.total);

      const sourceTable = document.querySelector('#view-sources tbody');
      if (!sourceTable) return;
      sourceTable.innerHTML = rows.length
        ? rows.map((row) => `
            <tr>
              <td>${escapeHTML(row.source)}</td>
              <td>${row.total}</td>
              <td>${row.treated}</td>
              <td>${row.pending}</td>
              <td><span class="chip ${row.stateClass}">${escapeHTML(row.state)}</span></td>
            </tr>
          `).join('')
        : '<tr><td colspan="5" class="empty-state">Aucun flux de service.</td></tr>';

      const sourceSummary = indicators && indicators.collection && indicators.collection.bySource ? indicators.collection.bySource : [];
      if (sourceSummary.length && rows.length) {
        const top = sourceSummary.slice(0, 4);
        const label = top.map((item) => `${escapeHTML(item.label)} (${item.count})`).join(' • ');
        const summary = document.querySelector('#view-sources .panel-head');
        if (summary) summary.setAttribute('data-summary', label);
      }
    } catch (err) {
      console.error(err);
      const sourceTable = document.querySelector('#view-sources tbody');
      if (sourceTable) sourceTable.innerHTML = '<tr><td colspan="5" class="empty-state">Erreur de chargement.</td></tr>';
    }
  }

  async function loadDataReport() {
    try {
      const report = await fetchJson(`${API_BASE}/api/reports/data`);
      const reportSummary = document.getElementById('reportSummary');
      if (reportSummary) {
        reportSummary.innerHTML = `
          <div class="stat-card"><div class="stat-top"><div class="stat-icon icon-blue"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 19V5M10 19V9M16 19v-6M22 19V3"/></svg></div><div class="stat-label">Total</div></div><div class="stat-value">${report.total}</div></div>
          <div class="stat-card"><div class="stat-top"><div class="stat-icon icon-green"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M20 6 9 17l-5-5"/></svg></div><div class="stat-label">Validés</div></div><div class="stat-value">${report.byStatus.valide || 0}</div></div>
          <div class="stat-card"><div class="stat-top"><div class="stat-icon icon-orange"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 8v4l3 3M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z"/></svg></div><div class="stat-label">En attente</div></div><div class="stat-value">${report.byStatus.en_attente || 0}</div></div>
          <div class="stat-card"><div class="stat-top"><div class="stat-icon icon-purple"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M7 7h10v10H7z"/><path d="M10 10h4v4h-4z"/></svg></div><div class="stat-label">Valeur totale</div></div><div class="stat-value">${Number(report.totalValue || 0).toLocaleString('fr-FR')}</div></div>
        `;
      }

      const reportsGrid = document.querySelector('#view-reports .stats');
      if (reportsGrid) {
        reportsGrid.innerHTML = `
          <div class="stat-card"><div class="stat-top"><div class="stat-icon icon-blue"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 19V5M10 19V9M16 19v-6M22 19V3"/></svg></div><div class="stat-label">Données saisies</div></div><div class="stat-value">${report.total}</div></div>
          <div class="stat-card"><div class="stat-top"><div class="stat-icon icon-green"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M20 6 9 17l-5-5"/></svg></div><div class="stat-label">Validées</div></div><div class="stat-value">${report.byStatus.valide || 0}</div></div>
          <div class="stat-card"><div class="stat-top"><div class="stat-icon icon-orange"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 8v4l3 3M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z"/></svg></div><div class="stat-label">Fiches incomplètes</div></div><div class="stat-value">${report.byStatus.incomplet || 0}</div></div>
          <div class="stat-card"><div class="stat-top"><div class="stat-icon icon-purple"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 7v10h16V7M4 7l8-4 8 4M9 12h6"/></svg></div><div class="stat-label">Taux de validation</div></div><div class="stat-value">${report.total ? Math.round(((report.byStatus.valide || 0) / report.total) * 100) : 0}%</div></div>
        `;
      }
    } catch (err) {
      console.error(err);
      const reportSummary = document.getElementById('reportSummary');
      if (reportSummary) reportSummary.innerHTML = '<div class="empty-state">Erreur de report.</div>';
      const reportsGrid = document.querySelector('#view-reports .stats');
      if (reportsGrid) reportsGrid.innerHTML = '<div class="empty-state">Erreur de report.</div>';
    }
  }

  async function downloadDataCsv(message) {
    message.className = 'modal-msg';
    try {
      // Étape 1 : obtenir un token à usage unique (valable 60 s)
      const tokenRes = await apiFetch(`${API_BASE}/api/exports/token`, { method: 'POST' });
      if (!tokenRes.ok) {
        const d = await tokenRes.json().catch(() => ({}));
        throw new Error(d.error || 'Export impossible.');
      }
      const { token } = await tokenRes.json();

      // Étape 2 : déclencher le téléchargement via un lien signé
      // Le token fait office de credential — aucun JWT dans l'URL
      const link = document.createElement('a');
      link.href = `${API_BASE}/api/exports/data.csv?token=${encodeURIComponent(token)}`;
      link.download = 'frumence-donnees.csv';
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);

      message.textContent = 'Export CSV téléchargé.';
      message.classList.add('ok');
    } catch (err) {
      if (err.message !== 'unauthorized') {
        message.textContent = err.message || 'Export impossible.';
        message.classList.add('err');
      }
    }
  }

  document.getElementById('exportCsvBtn').addEventListener('click', () => {
    downloadDataCsv(document.getElementById('reportMsg'));
  });
  document.getElementById('reportsCsvBtn').addEventListener('click', () => {
    downloadDataCsv(document.getElementById('reportsMsg'));
  });

  document.getElementById('archiveRecordBtn').addEventListener('click', async () => {
    const msg = document.getElementById('archiveMsg');
    const recordId = document.getElementById('archiveRecordId').value;
    const classification = document.getElementById('archiveClassification').value;
    const confidentiality = document.getElementById('archiveConfidentiality').value;
    const retentionYears = Number(document.getElementById('archiveRetentionYears').value || 3);
    const reason = document.getElementById('archiveReason').value.trim();

    msg.className = 'modal-msg';
    if (!recordId) {
      msg.textContent = 'Aucune donnée disponible à archiver.';
      msg.classList.add('err');
      return;
    }

    try {
      const res = await apiFetch(`${API_BASE}/api/records/${recordId}/archive`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ classification, confidentiality, retentionYears, reason })
      });
      const data = await res.json();
      if (!res.ok) {
        msg.textContent = data.error || 'Archivage impossible';
        msg.classList.add('err');
        return;
      }
      msg.textContent = `Donnée archivée : ${data.archiveCode}`;
      msg.classList.add('ok');
      document.getElementById('archiveReason').value = '';
      loadArchives();
      loadDataRecords();
    } catch (err) {
      msg.textContent = 'Impossible d’archiver la donnée.';
      msg.classList.add('err');
    }
  });

  document.getElementById('recordForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const payload = {
      source: document.getElementById('recordSource').value.trim(),
      reference: document.getElementById('recordReference').value.trim(),
      title: document.getElementById('recordTitle').value.trim(),
      category: document.getElementById('recordCategory').value.trim(),
      status: document.getElementById('recordStatus').value,
      quantity: Number(document.getElementById('recordQuantity').value || 0),
      value: document.getElementById('recordValue').value === '' ? null : Number(document.getElementById('recordValue').value),
      notes: document.getElementById('recordNotes').value.trim()
    };

    const msg = document.getElementById('recordMsg');
    msg.className = 'modal-msg';
    if (!payload.source || !payload.title) {
      msg.textContent = 'La source et le titre sont requis.';
      msg.classList.add('err');
      return;
    }

    try {
      const res = await apiFetch(`${API_BASE}/api/records`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      const data = await res.json();
      if (!res.ok) {
        msg.textContent = data.error || 'Erreur lors de la saisie';
        msg.classList.add('err');
        return;
      }
      msg.textContent = 'Donnée enregistrée avec succès.';
      msg.classList.add('ok');
      document.getElementById('recordForm').reset();
      document.getElementById('recordQuantity').value = 0;
      document.getElementById('recordStatus').value = 'en_attente';
      loadDataRecords();
    } catch (err) {
      msg.textContent = 'Impossible de contacter le serveur.';
      msg.classList.add('err');
    }
  });

  const entryDraftFieldIds = {
    source: 'entrySource',
    reference: 'entryReference',
    docType: 'entryDocType',
    docDate: 'entryDocDate',
    issuer: 'entryIssuer',
    recipient: 'entryRecipient',
    title: 'entryTitle',
    confidentiality: 'entryConfidentiality',
    dueDate: 'entryDueDate',
    quantity: 'entryQuantity',
    value: 'entryValue',
    notes: 'entryNotes'
  };
  let entryDraftUsername = 'user';
  let restoredEntryDraftKey = '';

  function entryDraftStorageKey() {
    return `fm_entry_draft_${encodeURIComponent(entryDraftUsername)}`;
  }

  function readEntryPayload() {
    const value = document.getElementById('entryValue').value;
    const docType = document.getElementById('entryDocType').value.trim();
    const docDate = document.getElementById('entryDocDate').value;
    const issuer = document.getElementById('entryIssuer').value.trim();
    const recipient = document.getElementById('entryRecipient').value.trim();
    const confidentiality = document.getElementById('entryConfidentiality').value;
    const dueDate = document.getElementById('entryDueDate').value;
    const observations = document.getElementById('entryNotes').value.trim();
    const notes = [
      docType ? `Type: ${docType}` : '',
      docDate ? `Date document: ${docDate}` : '',
      issuer ? `Emetteur: ${issuer}` : '',
      recipient ? `Destinataire: ${recipient}` : '',
      confidentiality ? `Confidentialite: ${confidentiality}` : '',
      dueDate ? `Echeance: ${dueDate}` : '',
      observations ? `Observations: ${observations}` : ''
    ].filter(Boolean).join(' | ');

    return {
      source: document.getElementById('entrySource').value.trim(),
      reference: document.getElementById('entryReference').value.trim(),
      title: document.getElementById('entryTitle').value.trim(),
      category: docType,
      status: 'en_attente',
      quantity: Number(document.getElementById('entryQuantity').value || 0),
      value: value === '' ? null : Number(value),
      notes,
      draft: { docType, docDate, issuer, recipient, confidentiality, dueDate, observations }
    };
  }

  function setEntryMessage(text, kind = '') {
    const message = document.getElementById('entryMsg');
    message.textContent = text;
    message.className = `modal-msg${kind ? ` ${kind}` : ''}`;
  }

  const entryAttachmentInput = document.getElementById('entryAttachmentInput');
  const entryAttachmentName = document.getElementById('entryAttachmentName');
  const entryDocumentChoiceOverlay = document.getElementById('entryDocumentChoiceOverlay');
  let pendingAttachmentRecordId = null;

  let editorWindow = null;

  window.addEventListener('message', (event) => {
    if (event.origin !== API_BASE || event.source !== editorWindow || !event.data) return;
    if (event.data.type === 'frumence-editor-ready') {
      editorWindow.postMessage({
        type: 'frumence-editor-init',
        text: document.getElementById('entryNotes').value,
        title: document.getElementById('entryTitle').value.trim() || document.getElementById('entryDocType').value || 'Document1'
      }, API_BASE);
      return;
    }
    if (event.data.type === 'frumence-editor-result' && typeof event.data.text === 'string') {
      document.getElementById('entryNotes').value = event.data.text;
      setEntryMessage('Document insere dans les observations.', 'ok');
      editorWindow = null;
    }
  });

  function openTextEditor() {
    editorWindow = window.open(API_BASE + '/editor.html?mode=entry', '_blank');
    if (!editorWindow) {
      setEntryMessage('Le navigateur a bloque la fenetre de l’editeur. Autorise les fenetres pop-up puis reessaie.', 'err');
      return;
    }
    entryDocumentChoiceOverlay.style.display = 'none';
  }

  function restoreEntryDraft() {
    const key = entryDraftStorageKey();
    if (restoredEntryDraftKey === key) return;
    restoredEntryDraftKey = key;
    try {
      const draft = JSON.parse(localStorage.getItem(key) || 'null');
      if (!draft) return;
      for (const [field, id] of Object.entries(entryDraftFieldIds)) {
        if (draft[field] !== undefined && draft[field] !== null) {
          document.getElementById(id).value = draft[field];
        }
      }
      setEntryMessage('Brouillon restauré.', 'ok');
    } catch (err) {
      setEntryMessage('Impossible de restaurer le brouillon enregistré.', 'err');
    }
  }

  async function loadEntryRecentRecords() {
    const rows = document.getElementById('entryRecentRows');
    try {
      const payload = await fetchJson(`${API_BASE}/api/records?limit=20`);
      const records = Array.isArray(payload) ? payload : (payload.items || []);
      const recent = records
        .slice()
        .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
        .slice(0, 5);
      const attachmentLists = await Promise.all(recent.map(async (record) => {
        const attachments = await fetchJson(`${API_BASE}/api/records/${record.id}/attachments`);
        return [record.id, attachments];
      }));
      const attachmentsByRecord = new Map(attachmentLists);
      rows.innerHTML = recent.length ? recent.map((record) => {
        const date = record.createdAt && Number.isFinite(new Date(record.createdAt).getTime())
          ? new Date(record.createdAt).toLocaleDateString('fr-FR')
          : '—';
        const attachments = attachmentsByRecord.get(record.id) || [];
        const attachmentLinks = attachments.map((attachment) =>
          `<button type="button" class="btn-action entry-attachment-download" data-record-id="${record.id}" data-attachment-id="${attachment.id}" data-file-name="${escapeHTML(attachment.fileName)}">${escapeHTML(attachment.fileName)}</button>`
        ).join(' ');
        return `<tr><td>${escapeHTML(record.source)}</td><td>${escapeHTML(record.title)}</td><td>${escapeHTML(record.category || '—')}</td><td>${escapeHTML(record.status)}</td><td>${date}</td><td>${attachmentLinks || '—'}</td></tr>`;
      }).join('') : '<tr><td colspan="6" class="empty-state">Aucune saisie récente.</td></tr>';
    } catch (err) {
      rows.innerHTML = '<tr><td colspan="6" class="empty-state">Erreur de chargement des saisies.</td></tr>';
    }
  }

  async function downloadRecordAttachment(recordId, attachmentId, fileName) {
    const response = await apiFetch(`${API_BASE}/api/records/${recordId}/attachments/${attachmentId}/download`);
    if (!response.ok) {
      const data = await response.json();
      throw new Error(data.error || 'Téléchargement impossible.');
    }
    const url = URL.createObjectURL(await response.blob());
    const link = document.createElement('a');
    link.href = url;
    link.download = fileName;
    link.click();
    URL.revokeObjectURL(url);
  }

  document.getElementById('entryRecentRows').addEventListener('click', async (event) => {
    const button = event.target.closest('.entry-attachment-download');
    if (!button) return;
    button.disabled = true;
    try {
      await downloadRecordAttachment(button.dataset.recordId, button.dataset.attachmentId, button.dataset.fileName);
    } catch (err) {
      if (err.message !== 'unauthorized') setEntryMessage(err.message, 'err');
    } finally {
      button.disabled = false;
    }
  });

  document.getElementById('openTextEditorBtn').addEventListener('click', () => {
    entryDocumentChoiceOverlay.style.display = 'flex';
  });
  document.getElementById('entryChooseWordModel').addEventListener('click', () => {
    entryDocumentChoiceOverlay.style.display = 'none';
    openTextEditor();
  });
  document.getElementById('entryChooseFile').addEventListener('click', () => {
    entryDocumentChoiceOverlay.style.display = 'none';
    entryAttachmentInput.click();
  });
  entryDocumentChoiceOverlay.addEventListener('click', (event) => {
    if (event.target === entryDocumentChoiceOverlay) entryDocumentChoiceOverlay.style.display = 'none';
  });
  entryAttachmentInput.addEventListener('change', () => {
    const file = entryAttachmentInput.files[0];
    if (file && file.size > 4 * 1024 * 1024) {
      entryAttachmentName.textContent = 'Le fichier sélectionné dépasse la limite de 4 Mo.';
      entryAttachmentInput.value = '';
      return;
    }
    entryAttachmentName.textContent = file ? `Fichier à joindre : ${file.name}` : '';
  });

  document.getElementById('saveEntryDraftBtn').addEventListener('click', () => {
    try {
      const payload = readEntryPayload();
      localStorage.setItem(entryDraftStorageKey(), JSON.stringify({
        ...payload,
        ...payload.draft,
        notes: payload.draft.observations
      }));
      setEntryMessage('Brouillon enregistré sur cet appareil.', 'ok');
    } catch (err) {
      setEntryMessage('Impossible d’enregistrer le brouillon sur cet appareil.', 'err');
    }
  });

  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && entryDocumentChoiceOverlay.style.display === 'flex') {
      entryDocumentChoiceOverlay.style.display = 'none';
    }
  });

  document.getElementById('submitEntryBtn').addEventListener('click', async (event) => {
    const payload = readEntryPayload();
    const attachment = entryAttachmentInput.files[0] || null;
    if (attachment && attachment.size > 4 * 1024 * 1024) {
      setEntryMessage('Le fichier sélectionné dépasse la limite de 4 Mo.', 'err');
      return;
    }
    if (!payload.source || !payload.title || !payload.category) {
      setEntryMessage('Le service source, le type de document et l’objet sont requis.', 'err');
      return;
    }
    if (!Number.isInteger(payload.quantity) || payload.quantity < 0 ||
        (payload.value !== null && !Number.isFinite(payload.value))) {
      setEntryMessage('Vérifiez la quantité et la valeur saisies.', 'err');
      return;
    }

    const submitButton = event.currentTarget;
    submitButton.disabled = true;
    setEntryMessage('Envoi de la donnée…');
    try {
      let recordId = pendingAttachmentRecordId;
      if (!recordId) {
        const response = await apiFetch(`${API_BASE}/api/records`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            source: payload.source,
            reference: payload.reference,
            title: payload.title,
            category: payload.category,
            status: payload.status,
            quantity: payload.quantity,
            value: payload.value,
            notes: payload.notes
          })
        });
        const data = await response.json();
        if (!response.ok) {
          setEntryMessage(data.error || 'Soumission impossible.', 'err');
          return;
        }
        recordId = data.id;
        pendingAttachmentRecordId = attachment ? recordId : null;
      }

      if (attachment) {
        setEntryMessage('Ajout de la pièce jointe…');
        const attachmentResponse = await apiFetch(`${API_BASE}/api/records/${recordId}/attachments`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/octet-stream',
            'X-File-Name': encodeURIComponent(attachment.name)
          },
          body: attachment
        });
        const attachmentResult = await attachmentResponse.json();
        if (!attachmentResponse.ok) {
          setEntryMessage(`La fiche est créée, mais le fichier n’a pas été joint : ${attachmentResult.error || 'réessaie.'} Clique de nouveau pour réessayer sans recréer la fiche.`, 'err');
          return;
        }
      }
      pendingAttachmentRecordId = null;
      localStorage.removeItem(entryDraftStorageKey());
      document.getElementById('entrySource').value = '';
      document.getElementById('entryReference').value = '';
      document.getElementById('entryDocType').value = '';
      document.getElementById('entryDocDate').value = '';
      document.getElementById('entryIssuer').value = '';
      document.getElementById('entryRecipient').value = '';
      document.getElementById('entryTitle').value = '';
      document.getElementById('entryConfidentiality').value = 'interne';
      document.getElementById('entryDueDate').value = '';
      document.getElementById('entryQuantity').value = '0';
      document.getElementById('entryValue').value = '0';
      document.getElementById('entryNotes').value = '';
      entryAttachmentInput.value = '';
      entryAttachmentName.textContent = '';
      setEntryMessage(attachment ? 'Document soumis avec sa pièce jointe.' : 'Document soumis pour vérification.', 'ok');
      await Promise.all([loadEntryRecentRecords(), loadDataRecords()]);
    } catch (err) {
      if (err.message !== 'unauthorized') setEntryMessage('Impossible de contacter le serveur.', 'err');
    } finally {
      submitButton.disabled = false;
    }
  });

  const viewLoaders = {
    dashboard: loadDashboard,
    entry: async () => {
      const user = await loadCurrentUser();
      entryDraftUsername = user.username || 'user';
      restoreEntryDraft();
      mountDataTables();
      await loadDataRecords();
      await loadEntryRecentRecords();
    },
    validation: async () => {
      await loadCurrentUser();
      await loadValidationQueue();
    },
    anomalies: async () => {
      await loadCurrentUser();
      await loadAnomaliesView();
    },
    records: async () => {
      await loadCurrentUser();
      mountDataTables();
      await loadDataRecords();
      await loadArchives();
      await loadDataReport();
    },
    documents: async () => {
      await loadCurrentUser();
      await loadArchives();
    },
    reports: async () => {
      await loadCurrentUser();
      await loadDataReport();
    },
    sources: async () => {
      await loadCurrentUser();
      await loadSites();
      await loadSourceView();
    },
    data: async () => {
      await loadCurrentUser();
      mountDataTables();
      await loadDataRecords();
      await loadArchives();
      await loadDataReport();
    },
    sites: loadSites,
    clients: loadClients,
    stats: loadStatsView,
    orders: loadOrders,
    maintenance: loadMaintenance,
    messages: loadMessages,
    users: async () => {
      await Promise.all([loadUsers(), loadAuditTrail(), loadValidationRules()]);
    },
    security: async () => {
      await Promise.all([loadAuditTrail(), loadUsers()]);
    },
    supervision: async () => {
      await Promise.all([loadUsers(), loadAuditTrail(), loadValidationRules()]);
    },
    settings: async () => {} // statique, rien à charger
  };

  // Point d'entrée : si on a déjà un token, on tente de charger directement ;
  // sinon on affiche l'écran de connexion.
  if (getToken()) {
    hideLogin();
    loadDashboard();
    updateMsgBadge();
  } else {
    showLogin();
  }

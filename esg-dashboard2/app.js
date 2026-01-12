// app.js
(() => {
  'use strict';

  // -----------------------------
  // Utilities
  // -----------------------------
  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

  const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
  const sleep = (ms) => new Promise(r => setTimeout(r, ms));

  const toStr = (v) => (v === undefined || v === null) ? '' : String(v).trim();
  const toNum = (v, fallback = NaN) => {
    const n = Number(v);
    return Number.isFinite(n) ? n : fallback;
  };

  const uniq = (arr) => [...new Set(arr.filter(v => toStr(v) !== ''))];

  const escapeHtml = (s) => String(s ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');

  const truncate = (s, n = 180) => {
    const t = toStr(s);
    if (!t) return '';
    return t.length > n ? (t.slice(0, n - 1) + '…') : t;
  };

  const debounce = (fn, ms = 180) => {
    let t = null;
    return (...args) => {
      clearTimeout(t);
      t = setTimeout(() => fn(...args), ms);
    };
  };

  const safeCol = (obj, candidates) => {
    for (const c of candidates) if (c in obj) return c;
    return null;
  };

  const fmt = (n, digits = 2) => {
    const x = Number(n);
    if (!Number.isFinite(x)) return '—';
    return x.toFixed(digits);
  };

  const mean = (arr) => {
    const xs = arr.filter(Number.isFinite);
    if (!xs.length) return NaN;
    return xs.reduce((a, b) => a + b, 0) / xs.length;
  };

  const pearson = (xs, ys) => {
    const pairs = xs.map((x, i) => [x, ys[i]])
      .filter(([x, y]) => Number.isFinite(x) && Number.isFinite(y));
    if (pairs.length < 3) return NaN;
    const x = pairs.map(p => p[0]);
    const y = pairs.map(p => p[1]);
    const mx = mean(x), my = mean(y);
    const num = x.reduce((a, xi, i) => a + (xi - mx) * (y[i] - my), 0);
    const den = Math.sqrt(x.reduce((a, xi) => a + (xi - mx) ** 2, 0) * y.reduce((a, yi) => a + (yi - my) ** 2, 0));
    return den === 0 ? NaN : (num / den);
  };

  // -----------------------------
  // App state
  // -----------------------------
  const state = {
    loaded: false,
    loading: true,
    error: null,

    data: {
      company: [],
      scores: [],
      initiatives: [],
      clusterSummary: [],
      themeCounts: [],
      actorCat: [],
      actorName: [],
    },

    derived: {
      companyByReportId: new Map(),
      scoreByReportId: new Map(),
      companyScoreRows: [],

      // filtered subsets
      fCompanies: [],
      fCompanyScoreRows: [],
      fInitiatives: [],
      fActorCat: [],
      fActorName: [],
    },

    filters: {
      company: '',
      sector: '',
      ownership: '',
      year: '',
      esg: '',
      theme: '',
      collab: '',
      cluster: '',
    },

    ui: {
      tab: 'overview',
      charts: {},
      network: null,
      networkMode: 'category', // 'category' | 'actor'
      topNEdges: 250,

      companies: {
        search: '',
        sortKey: 'company_name_english',
        sortDir: 'asc',
        page: 1,
        pageSize: 14
      },

      initiatives: {
        search: '',
        sortKey: 'company_name_english',
        sortDir: 'asc',
        page: 1,
        pageSize: 16
      },

      fuseCompanies: null,
      fuseInitiatives: null,
    }
  };

  // -----------------------------
  // Data loading
  // -----------------------------
  async function fetchText(url) {
    const res = await fetch(url, { cache: 'no-store' });
    if (!res.ok) throw new Error(`Fetch failed ${res.status}: ${url}`);
    return await res.text();
  }

  function parseCsv(text) {
    const parsed = Papa.parse(text, { header: true, skipEmptyLines: true });
    if (parsed.errors && parsed.errors.length) {
      console.warn('CSV parse warnings:', parsed.errors.slice(0, 3));
    }
    return parsed.data || [];
  }

  async function loadCsv(url) {
    const text = await fetchText(url);
    return parseCsv(text);
  }

  async function loadAllData() {
    const base = 'data/';
    const files = {
      company: base + 'company_master.csv',
      scores: base + 'scores.csv',
      initiatives: base + 'initiatives.csv',
      clusterSummary: base + 'cluster_summary.csv',
      themeCounts: base + 'theme_counts.csv',
      actorCat: base + 'actor_category_edges.csv',
      actorName: base + 'actor_name_edges.csv',
    };

    const keys = Object.keys(files);
    const results = await Promise.all(keys.map(async (k) => {
      try {
        const rows = await loadCsv(files[k]);
        return [k, rows];
      } catch (e) {
        // allow missing optional files (cluster/theme) but keep core strict
        if (k === 'clusterSummary' || k === 'themeCounts') return [k, []];
        throw e;
      }
    }));

    for (const [k, rows] of results) state.data[k] = rows;
  }

  // -----------------------------
  // Schema inference & joins
  // -----------------------------
  function normalizeCore() {
    const { company, scores, initiatives } = state.data;

    // Build report_id maps
    const companyReportCol = company.length ? safeCol(company[0], ['report_id', 'Report_ID', 'reportId']) : null;
    const scoreReportCol = scores.length ? safeCol(scores[0], ['report_id', 'Report_ID', 'reportId']) : null;

    if (companyReportCol) {
      for (const r of company) state.derived.companyByReportId.set(toStr(r[companyReportCol]), r);
    }
    if (scoreReportCol) {
      for (const r of scores) state.derived.scoreByReportId.set(toStr(r[scoreReportCol]), r);
    }

    // Create company-score joined rows for Companies table
    const joined = [];
    for (const [rid, comp] of state.derived.companyByReportId.entries()) {
      const sc = state.derived.scoreByReportId.get(rid) || {};
      joined.push({ report_id: rid, ...comp, ...sc });
    }
    state.derived.companyScoreRows = joined;

    // Add convenience fields to initiatives
    if (initiatives.length) {
      const i0 = initiatives[0];

      const iReportCol = safeCol(i0, ['report_id', 'Report_ID', 'reportId']);
      const iCompanyCol = safeCol(i0, ['company_name_english', 'company', 'company_name', 'Company']);
      const iEsgCol = safeCol(i0, ['ESG_block', 'esg_block', 'ESG', 'block']);
      const iThemeCol = safeCol(i0, ['theme_tag', 'theme', 'Theme']);
      const iCollabCol = safeCol(i0, ['collaboration_type', 'collab_type', 'Collaboration_Type']);
      const iDriverCol = safeCol(i0, ['driver_primary', 'driver', 'Driver']);
      const iClusterIdCol = safeCol(i0, ['cluster_id', 'cluster', 'Cluster_ID']);
      const iClusterKwCol = safeCol(i0, ['cluster_keywords', 'cluster_label', 'cluster_terms']);
      const iConfCol = safeCol(i0, ['confidence', 'conf', 'Confidence']);
      const iEvidenceFileCol = safeCol(i0, ['evidence_file_name', 'evidence_file', 'file_name', 'file']);
      const iEvidencePageCol = safeCol(i0, ['evidence_page_numbers', 'evidence_page', 'page', 'pages']);
      const iExcerptCol = safeCol(i0, ['evidence_excerpt', 'excerpt', 'Evidence_Excerpt']);
      const iTitleCol = safeCol(i0, ['initiative_title', 'title', 'Initiative_Title']);
      const iDescCol = safeCol(i0, ['initiative_description', 'description', 'Initiative_Description']);
      const iSimilarIdsCol = safeCol(i0, ['similar_initiative_ids']);
      const iSimilarTitlesCol = safeCol(i0, ['similar_initiative_titles']);

      for (const r of initiatives) {
        const rid = iReportCol ? toStr(r[iReportCol]) : '';
        const comp = iCompanyCol ? toStr(r[iCompanyCol]) : '';
        const compRow = state.derived.companyByReportId.get(rid);
        const sector = compRow ? toStr(compRow[safeCol(compRow, ['industry_sector', 'sector', 'industry']) || '']) : '';
        const ownership = compRow ? toStr(compRow[safeCol(compRow, ['ownership_type', 'ownership']) || '']) : '';
        const year = compRow ? toStr(compRow[safeCol(compRow, ['year_of_report', 'year']) || '']) : '';

        r.__report_id = rid;
        r.__company = comp;
        r.__sector = sector;
        r.__ownership = ownership;
        r.__year = year;

        r.__esg = iEsgCol ? toStr(r[iEsgCol]) : '';
        r.__theme = iThemeCol ? toStr(r[iThemeCol]) : '';
        r.__collab = iCollabCol ? toStr(r[iCollabCol]) : '';
        r.__driver = iDriverCol ? toStr(r[iDriverCol]) : '';
        r.__cluster_id = iClusterIdCol ? toStr(r[iClusterIdCol]) : '';
        r.__cluster_kw = iClusterKwCol ? toStr(r[iClusterKwCol]) : '';
        r.__confidence = iConfCol ? toStr(r[iConfCol]) : '';

        const ef = iEvidenceFileCol ? toStr(r[iEvidenceFileCol]) : '';
        const ep = iEvidencePageCol ? toStr(r[iEvidencePageCol]) : '';
        r.__evidence = [ef, ep ? `p.${ep}` : ''].filter(Boolean).join(' · ');

        // Excerpt policy: never show by default; if needed, only 180 chars
        r.__excerpt = iExcerptCol ? truncate(r[iExcerptCol], 180) : '';

        r.__title = iTitleCol ? toStr(r[iTitleCol]) : '';
        r.__desc = iDescCol ? toStr(r[iDescCol]) : '';

        r.__similar_ids = iSimilarIdsCol ? toStr(r[iSimilarIdsCol]) : '';
        r.__similar_titles = iSimilarTitlesCol ? toStr(r[iSimilarTitlesCol]) : '';
      }
    }
  }

  // -----------------------------
  // Filtering
  // -----------------------------
  function applyFilters() {
    const f = state.filters;
    const { companyScoreRows, companyByReportId } = state.derived;

    // Filter companyScoreRows (company-level)
    const sectorCol = state.data.company.length ? safeCol(state.data.company[0], ['industry_sector', 'sector', 'industry']) : null;
    const ownershipCol = state.data.company.length ? safeCol(state.data.company[0], ['ownership_type', 'ownership']) : null;
    const yearCol = state.data.company.length ? safeCol(state.data.company[0], ['year_of_report', 'year']) : null;
    const companyCol = state.data.company.length ? safeCol(state.data.company[0], ['company_name_english', 'company', 'company_name', 'Company']) : null;

    let rows = companyScoreRows.slice();

    if (f.company) rows = rows.filter(r => toStr(r[companyCol || 'company_name_english']) === f.company);
    if (f.sector) rows = rows.filter(r => toStr(r[sectorCol || 'industry_sector']) === f.sector);
    if (f.ownership) rows = rows.filter(r => toStr(r[ownershipCol || 'ownership_type']) === f.ownership);
    if (f.year) rows = rows.filter(r => toStr(r[yearCol || 'year_of_report']) === f.year);

    // Save filtered company views
    state.derived.fCompanyScoreRows = rows;
    state.derived.fCompanies = rows.map(r => {
      const rid = toStr(r.report_id || r.reportId || r.Report_ID);
      return companyByReportId.get(rid) || r;
    });

    // Initiatives filtering
    let inits = state.data.initiatives.slice();
    if (f.company) inits = inits.filter(r => r.__company === f.company);
    if (f.sector) inits = inits.filter(r => r.__sector === f.sector);
    if (f.ownership) inits = inits.filter(r => r.__ownership === f.ownership);
    if (f.year) inits = inits.filter(r => r.__year === f.year);
    if (f.esg) inits = inits.filter(r => r.__esg === f.esg);
    if (f.theme) inits = inits.filter(r => r.__theme === f.theme);
    if (f.collab) inits = inits.filter(r => r.__collab === f.collab);
    if (f.cluster) {
      // cluster filter might be "id — keywords", store as id in select value
      inits = inits.filter(r => r.__cluster_id === f.cluster);
    }
    state.derived.fInitiatives = inits;

    // Network edges filtering (where columns exist)
    const catEdges = filterEdges(state.data.actorCat, f, { mode: 'category' });
    const nameEdges = filterEdges(state.data.actorName, f, { mode: 'actor' });
    state.derived.fActorCat = catEdges;
    state.derived.fActorName = nameEdges;

    // update status line
    const status = `Showing ${rows.length} companies, ${inits.length} initiatives · Network edges: ${catEdges.length} (cat), ${nameEdges.length} (named)`;
    $('#statusLine').textContent = status;

    // Render everything (batched)
    scheduleRender();
  }

  function filterEdges(edges, f, { mode }) {
    if (!edges || !edges.length) return [];
    const e0 = edges[0];

    const companyCol = safeCol(e0, ['company', 'company_name_english', 'company_name', 'Company']);
    const esgCol = safeCol(e0, ['ESG_block', 'esg_block', 'ESG']);
    const themeCol = safeCol(e0, ['theme_tag', 'theme', 'Theme']);
    // collab/cluster may not exist here; apply only when present

    let out = edges.slice();

    if (companyCol && f.company) out = out.filter(r => toStr(r[companyCol]) === f.company);
    if (themeCol && f.theme) out = out.filter(r => toStr(r[themeCol]) === f.theme);
    if (mode === 'category' && esgCol && f.esg) out = out.filter(r => toStr(r[esgCol]) === f.esg);

    // sector/ownership/year: use report_id to map to company_master if present
    const ridCol = safeCol(e0, ['report_id', 'Report_ID', 'reportId']);
    if (ridCol && (f.sector || f.ownership || f.year)) {
      out = out.filter(r => {
        const rid = toStr(r[ridCol]);
        const comp = state.derived.companyByReportId.get(rid);
        if (!comp) return true;
        const sectorCol2 = safeCol(comp, ['industry_sector', 'sector', 'industry']);
        const ownershipCol2 = safeCol(comp, ['ownership_type', 'ownership']);
        const yearCol2 = safeCol(comp, ['year_of_report', 'year']);
        if (f.sector && toStr(comp[sectorCol2 || '']) !== f.sector) return false;
        if (f.ownership && toStr(comp[ownershipCol2 || '']) !== f.ownership) return false;
        if (f.year && toStr(comp[yearCol2 || '']) !== f.year) return false;
        return true;
      });
    }
    return out;
  }

  // -----------------------------
  // Routing
  // -----------------------------
  function setTab(tab) {
    state.ui.tab = tab;
    $$('.section').forEach(sec => {
      const isActive = sec.dataset.section === tab;
      sec.classList.toggle('hidden', !isActive);
    });
    $$('.tab').forEach(a => {
      const active = a.dataset.tab === tab;
      a.setAttribute('aria-current', active ? 'page' : 'false');
      if (!active) a.removeAttribute('aria-current');
    });

    // render network when tab is active (avoids heavy work while hidden)
    if (tab === 'network') {
      scheduleRender({ forceNetwork: true });
    }
  }

  function syncTabFromHash() {
    const raw = (location.hash || '#overview').replace('#', '');
    const tab = ['overview', 'companies', 'initiatives', 'network', 'methods'].includes(raw) ? raw : 'overview';
    setTab(tab);
  }

  // -----------------------------
  // UI: filter controls
  // -----------------------------
  function fillSelect(selectEl, values, { placeholder = 'All', valueFormatter = (x) => x } = {}) {
    selectEl.innerHTML = '';
    const opt0 = document.createElement('option');
    opt0.value = '';
    opt0.textContent = placeholder;
    selectEl.appendChild(opt0);

    for (const v of values) {
      const opt = document.createElement('option');
      opt.value = v;
      opt.textContent = valueFormatter(v);
      selectEl.appendChild(opt);
    }
  }

  function initFilterOptions() {
    const companyCol = state.data.company.length ? safeCol(state.data.company[0], ['company_name_english', 'company', 'company_name', 'Company']) : null;
    const sectorCol = state.data.company.length ? safeCol(state.data.company[0], ['industry_sector', 'sector', 'industry']) : null;
    const ownershipCol = state.data.company.length ? safeCol(state.data.company[0], ['ownership_type', 'ownership']) : null;
    const yearCol = state.data.company.length ? safeCol(state.data.company[0], ['year_of_report', 'year']) : null;

    const companies = uniq(state.data.company.map(r => toStr(r[companyCol || 'company_name_english']))).sort((a, b) => a.localeCompare(b));
    const sectors = uniq(state.data.company.map(r => toStr(r[sectorCol || 'industry_sector']))).sort((a, b) => a.localeCompare(b));
    const ownerships = uniq(state.data.company.map(r => toStr(r[ownershipCol || 'ownership_type']))).sort((a, b) => a.localeCompare(b));
    const years = uniq(state.data.company.map(r => toStr(r[yearCol || 'year_of_report']))).sort((a, b) => a.localeCompare(b));

    const esgs = uniq(state.data.initiatives.map(r => r.__esg)).sort((a, b) => a.localeCompare(b));
    const themes = uniq(state.data.initiatives.map(r => r.__theme)).sort((a, b) => a.localeCompare(b));
    const collabs = uniq(state.data.initiatives.map(r => r.__collab)).sort((a, b) => a.localeCompare(b));
    const clusterIds = uniq(state.data.initiatives.map(r => r.__cluster_id)).sort((a, b) => Number(a) - Number(b));

    fillSelect($('#fCompany'), companies, { placeholder: 'All companies' });
    fillSelect($('#fSector'), sectors, { placeholder: 'All sectors' });
    fillSelect($('#fOwnership'), ownerships, { placeholder: 'All ownership types' });
    fillSelect($('#fYear'), years, { placeholder: 'All years' });
    fillSelect($('#fESG'), esgs, { placeholder: 'All ESG blocks' });
    fillSelect($('#fTheme'), themes, { placeholder: 'All themes' });
    fillSelect($('#fCollab'), collabs, { placeholder: 'All collaboration types' });

    // Cluster select shows "id — keywords" in label, but value = id
    const clusterLabelById = new Map();
    for (const r of state.data.initiatives) {
      const id = r.__cluster_id;
      if (id && !clusterLabelById.has(id)) clusterLabelById.set(id, r.__cluster_kw);
    }
    fillSelect($('#fCluster'), clusterIds, {
      placeholder: 'All clusters',
      valueFormatter: (id) => {
        const kw = clusterLabelById.get(id) || '';
        return kw ? `${id} — ${kw.slice(0, 64)}` : id;
      }
    });

    // Wire filter changes
    const onFilterChange = () => {
      state.filters.company = $('#fCompany').value;
      state.filters.sector = $('#fSector').value;
      state.filters.ownership = $('#fOwnership').value;
      state.filters.year = $('#fYear').value;
      state.filters.esg = $('#fESG').value;
      state.filters.theme = $('#fTheme').value;
      state.filters.collab = $('#fCollab').value;
      state.filters.cluster = $('#fCluster').value;

      renderActiveChips();
      applyFilters();
    };

    ['fCompany','fSector','fOwnership','fYear','fESG','fTheme','fCollab','fCluster'].forEach(id => {
      $('#' + id).addEventListener('change', onFilterChange);
    });

    $('#btnResetFilters').addEventListener('click', () => resetFilters());
    $('#btnResetAll').addEventListener('click', () => {
      resetFilters();
      state.ui.companies.search = '';
      state.ui.initiatives.search = '';
      $('#companySearch').value = '';
      $('#initiativeSearch').value = '';
      applyFilters();
    });

    $('#btnHelp').addEventListener('click', () => {
      location.hash = '#methods';
    });

    renderActiveChips();
  }

  function renderActiveChips() {
    const chips = $('#activeChips');
    chips.innerHTML = '';

    const entries = [
      ['Company', 'company', state.filters.company],
      ['Sector', 'sector', state.filters.sector],
      ['Ownership', 'ownership', state.filters.ownership],
      ['Year', 'year', state.filters.year],
      ['ESG', 'esg', state.filters.esg],
      ['Theme', 'theme', state.filters.theme],
      ['Collab', 'collab', state.filters.collab],
      ['Cluster', 'cluster', state.filters.cluster],
    ].filter(([, , v]) => !!v);

    if (!entries.length) {
      const el = document.createElement('div');
      el.className = 'mini muted';
      el.textContent = 'No active filters';
      chips.appendChild(el);
      return;
    }

    for (const [label, key, value] of entries) {
      const chip = document.createElement('div');
      chip.className = 'chip';
      chip.innerHTML = `<span>${escapeHtml(label)}:</span><strong>${escapeHtml(value)}</strong>`;
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.setAttribute('aria-label', `Remove filter ${label}`);
      btn.textContent = '×';
      btn.addEventListener('click', () => {
        state.filters[key] = '';
        // sync selects
        if (key === 'company') $('#fCompany').value = '';
        if (key === 'sector') $('#fSector').value = '';
        if (key === 'ownership') $('#fOwnership').value = '';
        if (key === 'year') $('#fYear').value = '';
        if (key === 'esg') $('#fESG').value = '';
        if (key === 'theme') $('#fTheme').value = '';
        if (key === 'collab') $('#fCollab').value = '';
        if (key === 'cluster') $('#fCluster').value = '';

        renderActiveChips();
        applyFilters();
      });
      chip.appendChild(btn);
      chips.appendChild(chip);
    }
  }

  function resetFilters() {
    state.filters = { company:'', sector:'', ownership:'', year:'', esg:'', theme:'', collab:'', cluster:'' };
    $('#fCompany').value = '';
    $('#fSector').value = '';
    $('#fOwnership').value = '';
    $('#fYear').value = '';
    $('#fESG').value = '';
    $('#fTheme').value = '';
    $('#fCollab').value = '';
    $('#fCluster').value = '';
    renderActiveChips();
    applyFilters();
  }

  // -----------------------------
  // Charts
  // -----------------------------
  function chartDefaults() {
    Chart.defaults.color = 'rgba(255,255,255,0.78)';
    Chart.defaults.borderColor = 'rgba(255,255,255,0.12)';
    Chart.defaults.font.family = getComputedStyle(document.documentElement).getPropertyValue('--sans').trim() || 'system-ui';
    Chart.defaults.animation.duration = 260;
    Chart.defaults.plugins.legend.labels.boxWidth = 10;
    Chart.defaults.plugins.tooltip.backgroundColor = 'rgba(10,14,24,0.92)';
    Chart.defaults.plugins.tooltip.borderColor = 'rgba(255,255,255,0.14)';
    Chart.defaults.plugins.tooltip.borderWidth = 1;
    Chart.defaults.plugins.tooltip.titleColor = 'rgba(255,255,255,0.92)';
    Chart.defaults.plugins.tooltip.bodyColor = 'rgba(255,255,255,0.80)';
  }

  function destroyChart(key) {
    const ch = state.ui.charts[key];
    if (ch) {
      try { ch.destroy(); } catch {}
      state.ui.charts[key] = null;
    }
  }

  function barChart(canvasId, labels, values, { onClick, horizontal = false } = {}) {
    const ctx = $('#' + canvasId);
    if (!ctx) return null;

    const key = canvasId;
    destroyChart(key);

    const ch = new Chart(ctx, {
      type: 'bar',
      data: { labels, datasets: [{ label: 'Count', data: values }] },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        indexAxis: horizontal ? 'y' : 'x',
        plugins: { legend: { display: false } },
        scales: {
          x: { grid: { color: 'rgba(255,255,255,0.08)' }, ticks: { maxRotation: 0 } },
          y: { grid: { color: 'rgba(255,255,255,0.08)' }, beginAtZero: true }
        },
        onClick: (evt, elems) => {
          if (!onClick || !elems?.length) return;
          const idx = elems[0].index;
          onClick(idx, labels[idx]);
        }
      }
    });

    state.ui.charts[key] = ch;
    return ch;
  }

  function doughnutChart(canvasId, labels, values, { onClick } = {}) {
    const ctx = $('#' + canvasId);
    if (!ctx) return null;
    const key = canvasId;
    destroyChart(key);

    const ch = new Chart(ctx, {
      type: 'doughnut',
      data: { labels, datasets: [{ data: values, borderWidth: 1 }] },
      options: {
        responsive: true,
        plugins: {
          legend: { position: 'bottom' },
        },
        onClick: (evt, elems) => {
          if (!onClick || !elems?.length) return;
          const idx = elems[0].index;
          onClick(idx, labels[idx]);
        }
      }
    });

    state.ui.charts[key] = ch;
    return ch;
  }

  function lineChart(canvasId, labels, values, { label = 'Value' } = {}) {
    const ctx = $('#' + canvasId);
    if (!ctx) return null;
    const key = canvasId;
    destroyChart(key);

    const ch = new Chart(ctx, {
      type: 'line',
      data: { labels, datasets: [{ label, data: values, tension: 0.35, pointRadius: 2 }] },
      options: {
        responsive: true,
        plugins: { legend: { display: false } },
        scales: {
          x: { grid: { color: 'rgba(255,255,255,0.08)' } },
          y: { grid: { color: 'rgba(255,255,255,0.08)' }, beginAtZero: true }
        }
      }
    });

    state.ui.charts[key] = ch;
    return ch;
  }

  function scatterChart(canvasId, points, { label = 'Scatter' } = {}) {
    const ctx = $('#' + canvasId);
    if (!ctx) return null;
    const key = canvasId;
    destroyChart(key);

    const ch = new Chart(ctx, {
      type: 'scatter',
      data: { datasets: [{ label, data: points, pointRadius: 3 }] },
      options: {
        responsive: true,
        plugins: { legend: { display: false } },
        scales: {
          x: { grid: { color: 'rgba(255,255,255,0.08)' }, title: { display: true, text: 'ESG (avg E/S/G)' } },
          y: { grid: { color: 'rgba(255,255,255,0.08)' }, title: { display: true, text: 'Collaboration intensity' } }
        }
      }
    });

    state.ui.charts[key] = ch;
    return ch;
  }

  function radarChart(canvasEl, labels, values) {
    const key = canvasEl.id;
    destroyChart(key);

    const ch = new Chart(canvasEl, {
      type: 'radar',
      data: { labels, datasets: [{ data: values, fill: true, borderWidth: 1 }] },
      options: {
        responsive: true,
        plugins: { legend: { display: false } },
        scales: {
          r: {
            grid: { color: 'rgba(255,255,255,0.10)' },
            angleLines: { color: 'rgba(255,255,255,0.10)' },
            pointLabels: { color: 'rgba(255,255,255,0.86)' },
            ticks: { backdropColor: 'transparent', color: 'rgba(255,255,255,0.55)' }
          }
        }
      }
    });

    state.ui.charts[key] = ch;
    return ch;
  }

  // -----------------------------
  // Rendering (batched)
  // -----------------------------
  let rafPending = false;
  let forceNetworkNext = false;

  function scheduleRender({ forceNetwork = false } = {}) {
    forceNetworkNext = forceNetworkNext || forceNetwork;
    if (rafPending) return;
    rafPending = true;

    requestAnimationFrame(() => {
      rafPending = false;
      renderAll({ forceNetwork: forceNetworkNext });
      forceNetworkNext = false;
    });
  }

  function renderAll({ forceNetwork = false } = {}) {
    renderKPIs();
    renderOverviewCharts();
    renderCompanies();
    renderInitiatives();

    if (state.ui.tab === 'network' || forceNetwork) {
      renderNetwork();
    }
    renderDataDictionary();
  }

  // -----------------------------
  // Overview
  // -----------------------------
  function renderKPIs() {
    const fRows = state.derived.fCompanyScoreRows;

    $('#kpiCompanies').textContent = fRows.length || '0';
    $('#kpiCompaniesSub').textContent = state.filters.company ? '1 selected' : 'Filtered';

    $('#kpiInitiatives').textContent = state.derived.fInitiatives.length || '0';
    $('#kpiInitiativesSub').textContent = 'Filtered';

    // Score columns
    const sc0 = state.data.scores[0] || {};
    const Ecol = safeCol(sc0, ['E_score', 'E', 'EScore']);
    const Scol = safeCol(sc0, ['S_score', 'S', 'SScore']);
    const Gcol = safeCol(sc0, ['G_score', 'G', 'GScore']);
    const CollabCol = safeCol(sc0, ['collaboration_intensity', 'collab_intensity', 'Collaboration_Intensity']);
    const EvidCol = safeCol(sc0, ['evidence_density', 'Evidence_Density', 'evidenceDensity']);

    const Eavg = mean(fRows.map(r => toNum(r[Ecol])));
    const Savg = mean(fRows.map(r => toNum(r[Scol])));
    const Gavg = mean(fRows.map(r => toNum(r[Gcol])));

    $('#kpiESG').textContent = (Number.isFinite(Eavg) || Number.isFinite(Savg) || Number.isFinite(Gavg))
      ? `${fmt(Eavg, 2)} / ${fmt(Savg, 2)} / ${fmt(Gavg, 2)}`
      : '—';

    $('#kpiCollab').textContent = fmt(mean(fRows.map(r => toNum(r[CollabCol]))), 2);
    $('#kpiEvidence').textContent = fmt(mean(fRows.map(r => toNum(r[EvidCol]))), 2);
  }

  function renderOverviewCharts() {
    // Composition: actor category weights
    const edges = state.derived.fActorCat;
    const e0 = state.data.actorCat[0] || {};
    const catCol = safeCol(e0, ['actor_category', 'category', 'actor_type', 'Actor_Category']);
    const wCol = safeCol(e0, ['weight', 'count', 'mentions', 'Weight']);

    if (!edges.length || !catCol) {
      $('#emptyComposition').classList.remove('hidden');
      destroyChart('chartComposition');
    } else {
      $('#emptyComposition').classList.add('hidden');

      const agg = new Map();
      for (const r of edges) {
        const cat = toStr(r[catCol]) || 'Other';
        const w = Number.isFinite(toNum(r[wCol])) ? toNum(r[wCol]) : 1;
        agg.set(cat, (agg.get(cat) || 0) + w);
      }
      const pairs = Array.from(agg.entries()).sort((a, b) => b[1] - a[1]).slice(0, 10);
      const labels = pairs.map(p => p[0]);
      const vals = pairs.map(p => p[1]);

      doughnutChart('chartComposition', labels, vals, {
        onClick: (_, label) => {
          // map click to ESG theme? No. Here we just filter by theme? Not applicable.
          // We keep this as insight only.
        }
      });
    }

    // ESG distributions + collab distribution
    const rows = state.derived.fCompanyScoreRows;
    const s0 = state.data.scores[0] || {};
    const Ecol = safeCol(s0, ['E_score']);
    const Scol = safeCol(s0, ['S_score']);
    const Gcol = safeCol(s0, ['G_score']);
    const CollabCol = safeCol(s0, ['collaboration_intensity']);
    const EvidCol = safeCol(s0, ['evidence_density']);

    if (!rows.length || !CollabCol) {
      $('#emptyDists').classList.remove('hidden');
      destroyChart('chartESGDist');
      destroyChart('chartCollabDist');
    } else {
      $('#emptyDists').classList.add('hidden');

      // Simple binned distribution (10 bins)
      const esgAvg = rows.map(r => {
        const e = toNum(r[Ecol]);
        const s = toNum(r[Scol]);
        const g = toNum(r[Gcol]);
        const vals = [e, s, g].filter(Number.isFinite);
        return vals.length ? mean(vals) : NaN;
      }).filter(Number.isFinite);

      const collabs = rows.map(r => toNum(r[CollabCol])).filter(Number.isFinite);

      const esgHist = histogram(esgAvg, 10);
      const colHist = histogram(collabs, 10);

      lineChart('chartESGDist', esgHist.labels, esgHist.counts, { label: 'ESG avg' });
      lineChart('chartCollabDist', colHist.labels, colHist.counts, { label: 'Collab intensity' });

      // Correlation mini-view scatter
      const points = rows.map(r => {
        const e = toNum(r[Ecol]);
        const s = toNum(r[Scol]);
        const g = toNum(r[Gcol]);
        const vals = [e, s, g].filter(Number.isFinite);
        const x = vals.length ? mean(vals) : NaN;
        const y = toNum(r[CollabCol]);
        return (Number.isFinite(x) && Number.isFinite(y)) ? { x, y } : null;
      }).filter(Boolean);

      scatterChart('chartCorr', points);

      const xs = points.map(p => p.x);
      const ys = points.map(p => p.y);
      const r = pearson(xs, ys);
      const evidAvg = mean(rows.map(r => toNum(r[EvidCol])));
      $('#corrText').textContent = Number.isFinite(r)
        ? `Pearson r ≈ ${fmt(r, 2)} · Evidence avg ≈ ${fmt(evidAvg, 2)}`
        : 'Not enough data for correlation.';
    }

    // Themes chart from theme_counts (click to filter theme)
    const tc = state.data.themeCounts;
    if (!tc.length) {
      $('#emptyThemes').classList.remove('hidden');
      destroyChart('chartThemes');
    } else {
      $('#emptyThemes').classList.add('hidden');
      const t0 = tc[0];
      const themeCol = safeCol(t0, ['theme_tag', 'theme', 'Theme']);
      const countCol = safeCol(t0, ['count', 'Count', 'n']);
      const pairs = tc
        .map(r => [toStr(r[themeCol]), toNum(r[countCol], 0)])
        .filter(([t]) => !!t)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 12);

      barChart('chartThemes', pairs.map(p => p[0]), pairs.map(p => p[1]), {
        horizontal: true,
        onClick: (_, label) => {
          // Apply theme filter
          state.filters.theme = label;
          $('#fTheme').value = label;
          renderActiveChips();
          applyFilters();
        }
      });
    }
  }

  function histogram(values, bins = 10) {
    const xs = values.filter(Number.isFinite);
    if (!xs.length) return { labels: [], counts: [] };
    const min = Math.min(...xs);
    const max = Math.max(...xs);
    if (min === max) {
      return { labels: [fmt(min, 2)], counts: [xs.length] };
    }
    const step = (max - min) / bins;
    const counts = new Array(bins).fill(0);
    for (const v of xs) {
      const idx = clamp(Math.floor((v - min) / step), 0, bins - 1);
      counts[idx] += 1;
    }
    const labels = counts.map((_, i) => {
      const a = min + i * step;
      const b = a + step;
      return `${fmt(a, 1)}–${fmt(b, 1)}`;
    });
    return { labels, counts };
  }

  // -----------------------------
  // Companies section (table + drawer)
  // -----------------------------
  function initCompaniesSearchAndSort() {
    const onSearch = debounce(() => {
      state.ui.companies.search = $('#companySearch').value.trim();
      state.ui.companies.page = 1;
      scheduleRender();
    }, 160);
    $('#companySearch').addEventListener('input', onSearch);

    $('#companiesPrev').addEventListener('click', () => {
      state.ui.companies.page = Math.max(1, state.ui.companies.page - 1);
      scheduleRender();
    });
    $('#companiesNext').addEventListener('click', () => {
      state.ui.companies.page = state.ui.companies.page + 1;
      scheduleRender();
    });

    $$('#companiesTable thead th').forEach(th => {
      th.addEventListener('click', () => {
        const key = th.dataset.sort;
        if (!key) return;
        if (state.ui.companies.sortKey === key) {
          state.ui.companies.sortDir = state.ui.companies.sortDir === 'asc' ? 'desc' : 'asc';
        } else {
          state.ui.companies.sortKey = key;
          state.ui.companies.sortDir = 'asc';
        }
        scheduleRender();
      });
    });
  }

  function renderCompanies() {
    const rows = state.derived.fCompanyScoreRows.slice();
    const meta = $('#companiesMeta');

    // Fuse search (optional)
    if (!state.ui.fuseCompanies && rows.length) {
      state.ui.fuseCompanies = new Fuse(rows, {
        includeScore: false,
        threshold: 0.34,
        keys: ['company_name_english', 'industry_sector', 'ownership_type', 'report_id']
      });
    }

    let filtered = rows;
    const q = state.ui.companies.search;
    if (q) {
      if (state.ui.fuseCompanies) {
        filtered = state.ui.fuseCompanies.search(q).map(r => r.item);
      } else {
        const qq = q.toLowerCase();
        filtered = rows.filter(r =>
          [r.company_name_english, r.industry_sector, r.ownership_type, r.report_id].join(' ').toLowerCase().includes(qq)
        );
      }
    }

    // Sort
    const { sortKey, sortDir } = state.ui.companies;
    filtered.sort((a, b) => compareAny(a[sortKey], b[sortKey], sortDir));

    // Pagination
    const pageSize = state.ui.companies.pageSize;
    const total = filtered.length;
    const pages = Math.max(1, Math.ceil(total / pageSize));
    state.ui.companies.page = clamp(state.ui.companies.page, 1, pages);

    const start = (state.ui.companies.page - 1) * pageSize;
    const slice = filtered.slice(start, start + pageSize);

    meta.textContent = `${total} rows · sorted by ${sortKey} (${sortDir})`;

    $('#companiesPagerMeta').textContent = `Page ${state.ui.companies.page} / ${pages}`;
    $('#companiesPrev').disabled = state.ui.companies.page <= 1;
    $('#companiesNext').disabled = state.ui.companies.page >= pages;

    const tbody = $('#companiesTbody');
    tbody.innerHTML = '';

    if (!slice.length) {
      $('#emptyCompanies').classList.remove('hidden');
      return;
    }
    $('#emptyCompanies').classList.add('hidden');

    for (const r of slice) {
      const tr = document.createElement('tr');
      tr.tabIndex = 0;
      tr.setAttribute('role', 'button');
      tr.setAttribute('aria-label', `Open company details for ${toStr(r.company_name_english) || 'company'}`);
      tr.innerHTML = `
        <td>${escapeHtml(toStr(r.company_name_english || r.company || '—'))}</td>
        <td>${escapeHtml(toStr(r.industry_sector || '—'))}</td>
        <td>${escapeHtml(toStr(r.ownership_type || '—'))}</td>
        <td>${escapeHtml(toStr(r.year_of_report || '—'))}</td>
        <td class="num">${escapeHtml(fmt(toNum(r.E_score), 2))}</td>
        <td class="num">${escapeHtml(fmt(toNum(r.S_score), 2))}</td>
        <td class="num">${escapeHtml(fmt(toNum(r.G_score), 2))}</td>
        <td class="num">${escapeHtml(fmt(toNum(r.collaboration_intensity), 2))}</td>
        <td class="num">${escapeHtml(fmt(toNum(r.evidence_density), 2))}</td>
      `;
      tr.addEventListener('click', () => openCompanyDrawer(r));
      tr.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') openCompanyDrawer(r);
      });
      tbody.appendChild(tr);
    }
  }

  function compareAny(a, b, dir = 'asc') {
    const A = (a === undefined || a === null) ? '' : a;
    const B = (b === undefined || b === null) ? '' : b;
    const na = Number(A), nb = Number(B);
    let out;
    if (Number.isFinite(na) && Number.isFinite(nb)) out = na - nb;
    else out = String(A).localeCompare(String(B));
    return dir === 'asc' ? out : -out;
  }

  function openCompanyDrawer(row) {
    const company = toStr(row.company_name_english || row.company || 'Company');
    const rid = toStr(row.report_id);

    const inits = state.data.initiatives.filter(r => r.__report_id === rid || r.__company === company);
    const topThemes = topCounts(inits.map(r => r.__theme), 6);
    const topCollabs = topCounts(inits.map(r => r.__collab), 6);

    const edges = state.data.actorCat.filter(e => {
      const e0 = state.data.actorCat[0] || {};
      const compCol = safeCol(e0, ['company','company_name_english','company_name','Company']);
      const ridCol = safeCol(e0, ['report_id','Report_ID','reportId']);
      if (compCol && toStr(e[compCol]) === company) return true;
      if (ridCol && toStr(e[ridCol]) === rid) return true;
      return false;
    });
    const e0 = edges[0] || {};
    const catCol = safeCol(e0, ['actor_category','category','actor_type']);
    const wCol = safeCol(e0, ['weight','count','mentions']);
    const topActorCats = catCol ? topCountsWeighted(edges.map(e => [toStr(e[catCol]) || 'Other', toNum(e[wCol], 1)]), 6) : [];

    const title = company;
    const sub = `${toStr(row.industry_sector || '—')} · ${toStr(row.ownership_type || '—')} · ${toStr(row.year_of_report || '—')}`;

    setDrawerContent({
      kicker: 'Company',
      title,
      sub,
      bodyHtml: `
        <div class="grid two">
          <div class="card" style="box-shadow:none; background: rgba(255,255,255,0.04); border-color: rgba(255,255,255,0.10);">
            <div class="card-head"><h2>ESG radar</h2><div class="hint">E / S / G</div></div>
            <div class="card-body"><canvas id="drawerRadar" height="220"></canvas></div>
          </div>
          <div class="card" style="box-shadow:none; background: rgba(255,255,255,0.04); border-color: rgba(255,255,255,0.10);">
            <div class="card-head"><h2>At a glance</h2><div class="hint">Filtered by report/company</div></div>
            <div class="card-body">
              <div class="mini"><span class="badge">Initiatives: <strong>${inits.length}</strong></span></div>
              <div class="mini" style="margin-top:8px;"><span class="badge">Collab intensity: <strong>${escapeHtml(fmt(toNum(row.collaboration_intensity), 2))}</strong></span></div>
              <div class="mini" style="margin-top:8px;"><span class="badge">Evidence density: <strong>${escapeHtml(fmt(toNum(row.evidence_density), 2))}</strong></span></div>
              <div class="divider"></div>
              <div class="mini muted">Top themes</div>
              <div style="display:flex; flex-wrap:wrap; gap:8px; margin-top:8px;">
                ${topThemes.map(([k, v]) => `<span class="badge">${escapeHtml(k || '—')} <span class="muted">(${v})</span></span>`).join('') || `<span class="mini muted">—</span>`}
              </div>
              <div class="divider"></div>
              <div class="mini muted">Top collaboration types</div>
              <div style="display:flex; flex-wrap:wrap; gap:8px; margin-top:8px;">
                ${topCollabs.map(([k, v]) => `<span class="badge">${escapeHtml(k || '—')} <span class="muted">(${v})</span></span>`).join('') || `<span class="mini muted">—</span>`}
              </div>
              <div class="divider"></div>
              <div class="mini muted">Top actor categories</div>
              <div style="display:flex; flex-wrap:wrap; gap:8px; margin-top:8px;">
                ${topActorCats.map(([k, v]) => `<span class="badge">${escapeHtml(k || '—')} <span class="muted">(${fmt(v, 0)})</span></span>`).join('') || `<span class="mini muted">—</span>`}
              </div>
            </div>
          </div>
        </div>

        <div style="margin-top:12px; display:flex; gap:10px; flex-wrap:wrap;">
          <button class="btn btn-primary" id="btnJumpInitiatives">View initiatives for this company</button>
          <button class="btn btn-ghost" id="btnSetCompanyFilter">Set as global company filter</button>
        </div>
      `
    });

    // Radar render
    const canvas = $('#drawerRadar');
    const E = toNum(row.E_score);
    const S = toNum(row.S_score);
    const G = toNum(row.G_score);
    radarChart(canvas, ['E', 'S', 'G'], [Number.isFinite(E) ? E : 0, Number.isFinite(S) ? S : 0, Number.isFinite(G) ? G : 0]);

    $('#btnJumpInitiatives').addEventListener('click', () => {
      state.filters.company = company;
      $('#fCompany').value = company;
      renderActiveChips();
      applyFilters();
      closeDrawer();
      location.hash = '#initiatives';
    });

    $('#btnSetCompanyFilter').addEventListener('click', () => {
      state.filters.company = company;
      $('#fCompany').value = company;
      renderActiveChips();
      applyFilters();
    });

    openDrawer();
  }

  function topCounts(items, n = 6) {
    const m = new Map();
    for (const x of items) {
      const k = toStr(x) || '';
      if (!k) continue;
      m.set(k, (m.get(k) || 0) + 1);
    }
    return Array.from(m.entries()).sort((a, b) => b[1] - a[1]).slice(0, n);
  }

  function topCountsWeighted(pairs, n = 6) {
    const m = new Map();
    for (const [kRaw, wRaw] of pairs) {
      const k = toStr(kRaw) || '';
      if (!k) continue;
      const w = Number.isFinite(wRaw) ? wRaw : 1;
      m.set(k, (m.get(k) || 0) + w);
    }
    return Array.from(m.entries()).sort((a, b) => b[1] - a[1]).slice(0, n);
  }

  // -----------------------------
  // Initiatives section
  // -----------------------------
  function initInitiativesSearchAndSort() {
    const onSearch = debounce(() => {
      state.ui.initiatives.search = $('#initiativeSearch').value.trim();
      state.ui.initiatives.page = 1;
      scheduleRender();
    }, 160);
    $('#initiativeSearch').addEventListener('input', onSearch);

    $('#initiativesPrev').addEventListener('click', () => {
      state.ui.initiatives.page = Math.max(1, state.ui.initiatives.page - 1);
      scheduleRender();
    });
    $('#initiativesNext').addEventListener('click', () => {
      state.ui.initiatives.page = state.ui.initiatives.page + 1;
      scheduleRender();
    });

    $$('#initiativesTable thead th').forEach(th => {
      th.addEventListener('click', () => {
        const key = th.dataset.sort;
        if (!key) return;
        if (state.ui.initiatives.sortKey === key) {
          state.ui.initiatives.sortDir = state.ui.initiatives.sortDir === 'asc' ? 'desc' : 'asc';
        } else {
          state.ui.initiatives.sortKey = key;
          state.ui.initiatives.sortDir = 'asc';
        }
        scheduleRender();
      });
    });
  }

  function renderInitiatives() {
    const meta = $('#initiativesMeta');
    const base = state.derived.fInitiatives.slice();

    // Setup fuse once
    if (!state.ui.fuseInitiatives && state.data.initiatives.length) {
      state.ui.fuseInitiatives = new Fuse(state.data.initiatives, {
        includeScore: false,
        threshold: 0.36,
        keys: ['__company','__esg','__theme','__collab','__driver','__cluster_kw','__title','__desc','__evidence']
      });
    }

    // Search within filtered base (fast approach)
    let filtered = base;
    const q = state.ui.initiatives.search;
    if (q) {
      // Use a cheap filter first (because fuse on full set would ignore global filters)
      const qq = q.toLowerCase();
      filtered = base.filter(r =>
        [r.__company, r.__esg, r.__theme, r.__collab, r.__driver, r.__cluster_kw, r.__title, r.__desc, r.__evidence]
          .join(' ')
          .toLowerCase()
          .includes(qq)
      );
    }

    // Sort
    const { sortKey, sortDir } = state.ui.initiatives;
    filtered.sort((a, b) => compareAny(a['__' + sortKey] ?? a[sortKey], b['__' + sortKey] ?? b[sortKey], sortDir));

    // Pagination
    const pageSize = state.ui.initiatives.pageSize;
    const total = filtered.length;
    const pages = Math.max(1, Math.ceil(total / pageSize));
    state.ui.initiatives.page = clamp(state.ui.initiatives.page, 1, pages);

    const start = (state.ui.initiatives.page - 1) * pageSize;
    const slice = filtered.slice(start, start + pageSize);

    meta.textContent = `${total} rows · sorted by ${sortKey} (${sortDir})`;

    $('#initiativesPagerMeta').textContent = `Page ${state.ui.initiatives.page} / ${pages}`;
    $('#initiativesPrev').disabled = state.ui.initiatives.page <= 1;
    $('#initiativesNext').disabled = state.ui.initiatives.page >= pages;

    const tbody = $('#initiativesTbody');
    tbody.innerHTML = '';

    if (!slice.length) {
      $('#emptyInitiatives').classList.remove('hidden');
    } else {
      $('#emptyInitiatives').classList.add('hidden');
    }

    for (const r of slice) {
      const tr = document.createElement('tr');
      tr.tabIndex = 0;
      tr.setAttribute('role', 'button');
      tr.setAttribute('aria-label', `Open initiative details for ${r.__company || 'initiative'}`);

      tr.innerHTML = `
        <td>${escapeHtml(r.__company || '—')}</td>
        <td><span class="badge">${escapeHtml(r.__esg || '—')}</span></td>
        <td>${escapeHtml(r.__theme || '—')}</td>
        <td>${escapeHtml(r.__collab || '—')}</td>
        <td>${escapeHtml(r.__driver || '—')}</td>
        <td title="${escapeHtml(r.__cluster_kw || '')}">
          ${escapeHtml((r.__cluster_id ? `${r.__cluster_id} — ` : '') + (r.__cluster_kw ? r.__cluster_kw.slice(0, 52) : '—'))}
        </td>
        <td>${escapeHtml(r.__confidence || '—')}</td>
        <td>${escapeHtml(r.__evidence || '—')}</td>
      `;
      tr.addEventListener('click', () => openInitiativeDrawer(r));
      tr.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') openInitiativeDrawer(r);
      });
      tbody.appendChild(tr);
    }

    // Charts within Initiatives section
    renderClusterChart();
    renderCollabTypesChart();
  }

  function renderClusterChart() {
    const cs = state.data.clusterSummary;
    if (!cs.length) {
      $('#emptyClusters').classList.remove('hidden');
      destroyChart('chartClusters');
      return;
    }
    $('#emptyClusters').classList.add('hidden');

    const c0 = cs[0];
    const idCol = safeCol(c0, ['cluster_id', 'cluster', 'Cluster_ID']);
    const kwCol = safeCol(c0, ['cluster_keywords', 'cluster_label', 'cluster_terms']);
    const nCol = safeCol(c0, ['initiative_count', 'count', 'n']);

    const rows = cs.map(r => ({
      id: toStr(r[idCol]),
      kw: toStr(r[kwCol]),
      n: toNum(r[nCol], 0)
    }))
      .filter(r => r.id)
      .sort((a, b) => b.n - a.n)
      .slice(0, 18);

    const labels = rows.map(r => r.kw ? `${r.id} — ${r.kw.slice(0, 28)}` : r.id);
    const ids = rows.map(r => r.id);
    const vals = rows.map(r => r.n);

    barChart('chartClusters', labels, vals, {
      horizontal: true,
      onClick: (idx) => {
        const id = ids[idx];
        state.filters.cluster = id;
        $('#fCluster').value = id;
        renderActiveChips();
        applyFilters();
      }
    });
  }

  function renderCollabTypesChart() {
    const inits = state.derived.fInitiatives;
    if (!inits.length) {
      $('#emptyCollabTypes').classList.remove('hidden');
      destroyChart('chartCollabTypes');
      return;
    }
    $('#emptyCollabTypes').classList.add('hidden');

    const pairs = topCounts(inits.map(r => r.__collab), 12);
    barChart('chartCollabTypes', pairs.map(p => p[0]), pairs.map(p => p[1]), {
      onClick: (_, label) => {
        state.filters.collab = label;
        $('#fCollab').value = label;
        renderActiveChips();
        applyFilters();
      }
    });
  }

  function openInitiativeDrawer(r) {
    const title = r.__title || 'Initiative';
    const sub = `${r.__company || '—'} · ${r.__esg || '—'} · ${r.__theme || '—'}`;

    const evidenceLine = r.__evidence || '—';
    const excerpt = r.__excerpt ? truncate(r.__excerpt, 180) : '';

    const similar = getSimilarInitiatives(r);

    setDrawerContent({
      kicker: 'Initiative',
      title,
      sub,
      bodyHtml: `
        <div class="grid two">
          <div class="card" style="box-shadow:none; background: rgba(255,255,255,0.04); border-color: rgba(255,255,255,0.10);">
            <div class="card-head"><h2>Details</h2><div class="hint">Public-safe</div></div>
            <div class="card-body prose">
              ${r.__desc ? `<p>${escapeHtml(truncate(r.__desc, 520))}</p>` : `<p class="muted">No description available.</p>`}
              <div style="display:flex; flex-wrap:wrap; gap:8px; margin-top: 10px;">
                <span class="badge">${escapeHtml(r.__collab || '—')}</span>
                <span class="badge">${escapeHtml(r.__driver || '—')}</span>
                ${r.__cluster_id ? `<span class="badge">Cluster ${escapeHtml(r.__cluster_id)}</span>` : ''}
                ${r.__confidence ? `<span class="badge muted">Confidence: ${escapeHtml(r.__confidence)}</span>` : ''}
              </div>
              <div class="divider"></div>
              <div class="mini muted">Evidence reference</div>
              <div class="mini">${escapeHtml(evidenceLine)}</div>
              ${excerpt ? `<div class="mini muted" style="margin-top:10px;">Excerpt (truncated)</div><div class="mini">${escapeHtml(excerpt)}</div>` : ''}
            </div>
          </div>

          <div class="card" style="box-shadow:none; background: rgba(255,255,255,0.04); border-color: rgba(255,255,255,0.10);">
            <div class="card-head"><h2>Similar initiatives</h2><div class="hint">Precomputed or lightweight</div></div>
            <div class="card-body">
              ${similar.length ? `
                <div style="display:grid; gap:10px;">
                  ${similar.map(item => `
                    <div class="card" style="box-shadow:none; background: rgba(255,255,255,0.03); border-color: rgba(255,255,255,0.08);">
                      <div class="card-body" style="padding: 12px 12px;">
                        <div style="font-weight:700;">${escapeHtml(item.title || '—')}</div>
                        <div class="mini">${escapeHtml(item.company || '—')} · ${escapeHtml(item.theme || '—')} · ${escapeHtml(item.collab || '—')}</div>
                        <div class="mini muted" style="margin-top:6px;">${escapeHtml(truncate(item.desc || '', 160))}</div>
                        <div style="margin-top:10px;">
                          <button class="btn btn-ghost" data-open-init="${escapeHtml(item.id)}" type="button">Open</button>
                        </div>
                      </div>
                    </div>
                  `).join('')}
                </div>
              ` : `<div class="empty">No similar initiatives available.</div>`}
            </div>
          </div>
        </div>

        <div style="margin-top:12px; display:flex; gap:10px; flex-wrap:wrap;">
          <button class="btn btn-primary" id="btnFilterCompanyInit">Filter to this company</button>
          ${r.__theme ? `<button class="btn btn-ghost" id="btnFilterThemeInit">Filter to this theme</button>` : ''}
          ${r.__cluster_id ? `<button class="btn btn-ghost" id="btnFilterClusterInit">Filter to this cluster</button>` : ''}
        </div>
      `
    });

    // Wire buttons
    $('#btnFilterCompanyInit').addEventListener('click', () => {
      state.filters.company = r.__company;
      $('#fCompany').value = r.__company;
      renderActiveChips();
      applyFilters();
    });

    const btnTheme = $('#btnFilterThemeInit');
    if (btnTheme) btnTheme.addEventListener('click', () => {
      state.filters.theme = r.__theme;
      $('#fTheme').value = r.__theme;
      renderActiveChips();
      applyFilters();
    });

    const btnCluster = $('#btnFilterClusterInit');
    if (btnCluster) btnCluster.addEventListener('click', () => {
      state.filters.cluster = r.__cluster_id;
      $('#fCluster').value = r.__cluster_id;
      renderActiveChips();
      applyFilters();
    });

    // Similar open buttons
    $$('[data-open-init]').forEach(btn => {
      btn.addEventListener('click', () => {
        const id = btn.getAttribute('data-open-init');
        const found = state.data.initiatives.find(x => toStr(x.initiative_id) === id || toStr(x.__initiative_id) === id) ||
                      state.data.initiatives.find(x => toStr(x.initiative_id) === id);
        if (found) openInitiativeDrawer(found);
      });
    });

    openDrawer();
  }

  function getSimilarInitiatives(r) {
    // Prefer precomputed columns
    let ids = [];
    if (r.__similar_ids) {
      ids = r.__similar_ids.split(';').map(s => s.trim()).filter(Boolean);
    }

    const byId = new Map();
    for (const it of state.data.initiatives) {
      const id = toStr(it.initiative_id || it.__initiative_id);
      if (id) byId.set(id, it);
    }

    const out = [];
    if (ids.length) {
      for (const id of ids.slice(0, 5)) {
        const it = byId.get(id);
        if (!it) continue;
        out.push({
          id,
          title: it.__title || it.initiative_title || '—',
          company: it.__company || '—',
          theme: it.__theme || '—',
          collab: it.__collab || '—',
          desc: it.__desc || it.initiative_description || ''
        });
      }
      return out;
    }

    // Otherwise: lightweight token overlap similarity within same filtered pool
    const pool = state.derived.fInitiatives.length ? state.derived.fInitiatives : state.data.initiatives;
    const target = tokenSet([r.__title, r.__desc, r.__theme, r.__collab, r.__driver].join(' '));
    if (!target.size) return [];

    const scored = [];
    for (const it of pool) {
      if (it === r) continue;
      const set = tokenSet([it.__title, it.__desc, it.__theme, it.__collab, it.__driver].join(' '));
      const score = jaccard(target, set);
      if (score > 0.08) {
        scored.push([score, it]);
      }
    }
    scored.sort((a, b) => b[0] - a[0]);
    return scored.slice(0, 5).map(([_, it]) => ({
      id: toStr(it.initiative_id || it.__initiative_id),
      title: it.__title || it.initiative_title || '—',
      company: it.__company || '—',
      theme: it.__theme || '—',
      collab: it.__collab || '—',
      desc: it.__desc || it.initiative_description || ''
    }));
  }

  function tokenSet(text) {
    const t = toStr(text).toLowerCase();
    if (!t) return new Set();
    const tokens = t
      .replace(/[^a-z0-9\s-]/g, ' ')
      .split(/\s+/)
      .filter(w => w.length >= 3 && !STOP.has(w))
      .slice(0, 140);
    return new Set(tokens);
  }

  function jaccard(a, b) {
    if (!a.size || !b.size) return 0;
    let inter = 0;
    for (const x of a) if (b.has(x)) inter++;
    const union = a.size + b.size - inter;
    return union ? inter / union : 0;
  }

  const STOP = new Set([
    'the','and','for','with','from','that','this','into','over','under','their','they','them','have','has','had',
    'are','was','were','will','shall','can','could','should','would','about','which','when','where','what','who',
    'company','companies','initiative','project','program','report','support','development','sustainable','sustainability'
  ]);

  // -----------------------------
  // Network section
  // -----------------------------
  function initNetworkUI() {
    $('#topNEdges').addEventListener('input', () => {
      state.ui.topNEdges = toNum($('#topNEdges').value, 250);
      $('#topNEdgesLabel').textContent = String(state.ui.topNEdges);
      if (state.ui.tab === 'network') scheduleRender({ forceNetwork: true });
    });

    $('#netModeCategory').addEventListener('click', () => {
      state.ui.networkMode = 'category';
      $('#netModeCategory').classList.add('active');
      $('#netModeActor').classList.remove('active');
      $('#netHint').textContent = 'Category edges (company ↔ actor category)';
      scheduleRender({ forceNetwork: true });
    });

    $('#netModeActor').addEventListener('click', () => {
      state.ui.networkMode = 'actor';
      $('#netModeActor').classList.add('active');
      $('#netModeCategory').classList.remove('active');
      $('#netHint').textContent = 'Named actor edges (company ↔ actor)';
      scheduleRender({ forceNetwork: true });
    });

    $('#btnFit').addEventListener('click', () => {
      try { state.ui.network?.fit({ animation: true }); } catch {}
    });
    $('#btnStabilize').addEventListener('click', () => {
      try { state.ui.network?.stabilize(80); } catch {}
    });
  }

  function renderNetwork() {
    const mode = state.ui.networkMode;
    const topN = state.ui.topNEdges;

    const edges = mode === 'category' ? state.derived.fActorCat : state.derived.fActorName;
    if (!edges.length) {
      $('#emptyNetwork').classList.remove('hidden');
      $('#netStats').textContent = '—';
      if (state.ui.network) {
        try { state.ui.network.destroy(); } catch {}
        state.ui.network = null;
      }
      return;
    }
    $('#emptyNetwork').classList.add('hidden');

    const e0 = edges[0];
    const companyCol = safeCol(e0, ['company','company_name_english','company_name','Company']) || 'company';
    const weightCol = safeCol(e0, ['weight','count','mentions','Weight']) || null;

    const targetCol = mode === 'category'
      ? (safeCol(e0, ['actor_category','category','actor_type','Actor_Category']) || 'actor_category')
      : (safeCol(e0, ['actor_name','actor','name','Actor_Name']) || 'actor_name');

    const themeCol = safeCol(e0, ['theme_tag','theme','Theme']);
    const esgCol = safeCol(e0, ['ESG_block','esg_block','ESG']); // category edges only typically

    // Aggregate edges by (company,target) to reduce density
    const agg = new Map();
    for (const r of edges) {
      const c = toStr(r[companyCol]) || '';
      const t = toStr(r[targetCol]) || '';
      if (!c || !t) continue;
      const key = `${c}||${t}`;
      const w = weightCol ? (toNum(r[weightCol], 1) || 1) : 1;
      agg.set(key, (agg.get(key) || 0) + w);
    }

    let pairs = Array.from(agg.entries()).map(([k, w]) => {
      const [c, t] = k.split('||');
      return { c, t, w };
    });
    pairs.sort((a, b) => b.w - a.w);
    pairs = pairs.slice(0, topN);

    // Nodes
    const nodes = [];
    const nodeMap = new Map();

    const addNode = (id, label, group) => {
      if (nodeMap.has(id)) return;
      nodeMap.set(id, true);
      nodes.push({
        id,
        label,
        group,
        shape: 'dot',
        value: group === 'company' ? 20 : 12,
        font: { color: 'rgba(255,255,255,0.92)' }
      });
    };

    for (const p of pairs) {
      addNode(`c:${p.c}`, p.c, 'company');
      addNode(`t:${p.t}`, p.t, 'actor');
    }

    // Edges
    const visEdges = pairs.map(p => ({
      from: `c:${p.c}`,
      to: `t:${p.t}`,
      value: clamp(p.w, 1, 30),
      title: `${p.c} ↔ ${p.t}\nWeight: ${fmt(p.w, 0)}`
    }));

    // Initialize / update vis-network
    const container = $('#networkCanvas');
    const data = {
      nodes: new vis.DataSet(nodes),
      edges: new vis.DataSet(visEdges)
    };

    const options = {
      interaction: { hover: true, tooltipDelay: 120 },
      physics: { stabilization: true },
      edges: { smooth: true, color: { color: 'rgba(255,255,255,0.35)' } },
      nodes: { borderWidth: 1, color: { border: 'rgba(255,255,255,0.22)' } },
      groups: {
        company: { color: { background: 'rgba(124,92,255,0.95)' } },
        actor: { color: { background: 'rgba(34,211,238,0.92)' } }
      }
    };

    if (state.ui.network) {
      try { state.ui.network.destroy(); } catch {}
    }
    state.ui.network = new vis.Network(container, data, options);

    $('#netStats').textContent = `${pairs.length} edges · ${nodes.length} nodes · mode: ${mode}`;

    // Click node to filter
    state.ui.network.on('click', (params) => {
      const id = params?.nodes?.[0];
      if (!id) return;

      if (id.startsWith('c:')) {
        const comp = id.slice(2);
        state.filters.company = comp;
        $('#fCompany').value = comp;
        renderActiveChips();
        applyFilters();
      } else if (id.startsWith('t:')) {
        // If target matches a theme, apply theme filter; otherwise keep as insight-only
        const target = id.slice(2);
        // Try theme match
        const themes = new Set(state.data.initiatives.map(r => r.__theme));
        if (themes.has(target)) {
          state.filters.theme = target;
          $('#fTheme').value = target;
          renderActiveChips();
          applyFilters();
        }
      }
    });
  }

  // -----------------------------
  // Data dictionary (Methods)
  // -----------------------------
  function renderDataDictionary() {
    const tbody = $('#dictTbody');
    if (!tbody) return;

    const dict = [];

    // Company
    if (state.data.company.length) {
      const cols = Object.keys(state.data.company[0]);
      pushDict(dict, 'company_master.csv', cols, {
        report_id: 'Unique report identifier (join key).',
        company_name_english: 'Company name in English.',
        industry_sector: 'Sector/industry classification.',
        ownership_type: 'State/Private/Mixed (if provided).',
        year_of_report: 'Report year.'
      });
    }

    // Scores
    if (state.data.scores.length) {
      const cols = Object.keys(state.data.scores[0]);
      pushDict(dict, 'scores.csv', cols, {
        report_id: 'Join key to company_master.',
        E_score: 'Environment score.',
        S_score: 'Social score.',
        G_score: 'Governance score.',
        collaboration_intensity: 'Summary measure of collaboration prevalence/intensity.',
        evidence_density: 'How dense/quantitative the reported evidence is.'
      });
    }

    // Initiatives
    if (state.data.initiatives.length) {
      const cols = Object.keys(state.data.initiatives[0]);
      pushDict(dict, 'initiatives.csv', cols, {
        initiative_id: 'Unique initiative identifier.',
        report_id: 'Join key to company_master.',
        ESG_block: 'Environment/Social/Governance/Cross-cutting.',
        theme_tag: 'Initiative theme label.',
        collaboration_type: 'Type of cross-sector collaboration.',
        driver_primary: 'Primary driver (e.g., government, society, international exposure).',
        cluster_id: 'Cluster assignment for initiative text.',
        cluster_keywords: 'Keywords describing the cluster.',
        similar_initiative_ids: 'Precomputed similar initiatives (IDs).',
        evidence_file_name: 'Evidence: report file name (reference).',
        evidence_page_numbers: 'Evidence: page number(s) in report (reference).'
      });
    }

    // Network
    if (state.data.actorCat.length) {
      pushDict(dict, 'actor_category_edges.csv', Object.keys(state.data.actorCat[0]), {
        actor_category: 'Actor category (Government/NGO/Society/Business partners).',
        weight: 'Edge weight (count or intensity).',
        theme_tag: 'Optional theme label.'
      });
    }
    if (state.data.actorName.length) {
      pushDict(dict, 'actor_name_edges.csv', Object.keys(state.data.actorName[0]), {
        actor_name: 'Named actor (if explicitly mentioned).',
        actor_type: 'Type of actor (if provided).',
        weight: 'Edge weight (count/mentions).'
      });
    }

    tbody.innerHTML = dict.map(row => `
      <tr>
        <td>${escapeHtml(row.dataset)}</td>
        <td><code>${escapeHtml(row.column)}</code></td>
        <td class="muted">${escapeHtml(row.desc)}</td>
      </tr>
    `).join('');
  }

  function pushDict(out, dataset, cols, knownMap) {
    for (const c of cols.slice(0, 80)) {
      out.push({
        dataset,
        column: c,
        desc: knownMap[c] || 'Column detected in CSV (description not specified).'
      });
    }
  }

  // -----------------------------
  // Drawer controls
  // -----------------------------
  function initDrawer() {
    $('#drawerClose').addEventListener('click', closeDrawer);
    $('#drawerBackdrop').addEventListener('click', closeDrawer);
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') closeDrawer();
    });
  }

  function setDrawerContent({ kicker, title, sub, bodyHtml }) {
    $('#drawerKicker').textContent = kicker || 'Details';
    $('#drawerTitle').textContent = title || '—';
    $('#drawerSub').textContent = sub || '—';
    $('#drawerBody').innerHTML = bodyHtml || '';
  }

  function openDrawer() {
    const drawer = $('#drawer');
    drawer.classList.remove('hidden');
    drawer.setAttribute('aria-hidden', 'false');
    // focus close button for accessibility
    setTimeout(() => $('#drawerClose').focus(), 0);
  }

  function closeDrawer() {
    const drawer = $('#drawer');
    if (drawer.classList.contains('hidden')) return;
    drawer.classList.add('hidden');
    drawer.setAttribute('aria-hidden', 'true');
  }

  // -----------------------------
  // Boot
  // -----------------------------
  async function boot() {
    document.body.classList.add('loading');
    chartDefaults();

    // Wire routing
    window.addEventListener('hashchange', syncTabFromHash);
    syncTabFromHash();

    // Wire UI
    initDrawer();
    initCompaniesSearchAndSort();
    initInitiativesSearchAndSort();
    initNetworkUI();

    try {
      // Slight delay = smoother skeleton perception
      await Promise.race([loadAllData(), sleep(60)]);
      normalizeCore();
      initFilterOptions();

      // Default render
      $('#statusLine').textContent = 'Loaded. Applying filters…';
      applyFilters();

      state.loaded = true;
      state.loading = false;
      document.body.classList.remove('loading');
    } catch (e) {
      state.error = e;
      state.loading = false;
      document.body.classList.remove('loading');
      $('#errorBanner').classList.remove('hidden');
      $('#errorText').textContent = `${e?.message || e}`;
      $('#statusLine').textContent = 'Error loading data.';
      console.error(e);
    }
  }

  // Start
  document.addEventListener('DOMContentLoaded', boot);

})();

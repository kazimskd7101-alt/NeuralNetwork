/* =========================================================
   China ESG Dashboard (2026 modern, evidence-grounded)
   - Loads CSVs from /data
   - Cross-filters: company/sector/year/ownership + initiative facets
   - Overview: scores + themes + drivers + collaboration types + top companies
   - Company: profile + scorecard + evidence initiatives
   - Initiatives: full explorer (Tabulator)
   - Network: category + named actors (D3)
   - EDA: distributions, sector averages, correlation heatmap, KPI vs evidence
========================================================= */

const PATHS = {
  company: "./data/company_master.csv",
  initiatives: "./data/initiatives.csv",
  scores: "./data/scores.csv",
  catEdges: "./data/actor_category_edges.csv",
  nameEdges: "./data/actor_name_edges.csv",
};

const STATE = {
  raw: {
    company: [],
    initiatives: [],
    scores: [],
    catEdges: [],
    nameEdges: [],
  },
  joined: {
    companies: [],     // company_master joined with scores
  },
  filters: {
    company: "",       // report_id
    sector: "",
    year: "",
    ownership: "",
    block: "",
    theme: "",
    collabType: "",
    driver: "",
    confidence: "",
  },
  ui: {
    tab: "overview",
    theme: "dark",
    currentThemeFilterFromChart: null,
  },
  charts: {},
  tables: {},
  nets: {
    cat: null,
    named: null,
  }
};

// ------------------------- Utilities -------------------------

function $(id){ return document.getElementById(id); }

function parseCSV(url){
  return new Promise((resolve, reject) => {
    Papa.parse(url, {
      download: true,
      header: true,
      skipEmptyLines: true,
      complete: (res) => resolve(res.data),
      error: (err) => reject(err),
    });
  });
}

function uniq(arr){
  return Array.from(new Set(arr.filter(v => v !== undefined && v !== null && String(v).trim() !== "")))
    .sort((a,b) => String(a).localeCompare(String(b)));
}

function toNum(x, fallback=0){
  const v = Number(String(x).trim());
  return Number.isFinite(v) ? v : fallback;
}

function safeStr(x, fallback="not stated"){
  const s = (x === undefined || x === null) ? "" : String(x).trim();
  return s.length ? s : fallback;
}

function mean(nums){
  const arr = nums.filter(n => Number.isFinite(n));
  if (!arr.length) return 0;
  return arr.reduce((a,b)=>a+b,0)/arr.length;
}

function countBy(rows, key){
  const m = new Map();
  for (const r of rows){
    const k = safeStr(r[key], "not stated");
    m.set(k, (m.get(k) || 0) + 1);
  }
  return [...m.entries()].sort((a,b)=>b[1]-a[1]);
}

function topNCountPairs(pairs, n=10){
  return pairs.slice(0,n);
}

function fmt1(x){
  return (Math.round(x*10)/10).toFixed(1);
}

function asPct(n, d){
  if (!d) return "0%";
  return `${Math.round((n/d)*100)}%`;
}

function buildSelect(el, values, placeholder="All"){
  el.innerHTML = "";
  const o0 = document.createElement("option");
  o0.value = "";
  o0.textContent = placeholder;
  el.appendChild(o0);
  for (const v of values){
    const o = document.createElement("option");
    o.value = v;
    o.textContent = v;
    el.appendChild(o);
  }
}

function setTab(tab){
  STATE.ui.tab = tab;
  document.querySelectorAll(".tab").forEach(btn => {
    btn.classList.toggle("active", btn.dataset.tab === tab);
  });
  document.querySelectorAll(".tabview").forEach(sec => sec.classList.remove("active"));
  $(`tab-${tab}`).classList.add("active");
}

function applyTheme(theme){
  STATE.ui.theme = theme;
  if (theme === "light") {
    document.documentElement.setAttribute("data-theme", "light");
  } else {
    document.documentElement.removeAttribute("data-theme");
  }
}

// ------------------------- Filtering -------------------------

function currentScopeCompanyRows(){
  // Company-level filtering on master fields
  let rows = STATE.joined.companies.slice();

  if (STATE.filters.company) rows = rows.filter(r => r.report_id === STATE.filters.company);
  if (STATE.filters.sector) rows = rows.filter(r => safeStr(r.industry_sector) === STATE.filters.sector);
  if (STATE.filters.year) rows = rows.filter(r => safeStr(r.year_of_report) === STATE.filters.year);
  if (STATE.filters.ownership) rows = rows.filter(r => safeStr(r.ownership_type) === STATE.filters.ownership);

  return rows;
}

function currentScopeReportIds(){
  return currentScopeCompanyRows().map(r => r.report_id);
}

function currentScopeInitiatives(){
  let rows = STATE.raw.initiatives.slice();
  const ids = new Set(currentScopeReportIds());
  rows = rows.filter(r => ids.has(r.report_id));

  if (STATE.filters.block) rows = rows.filter(r => safeStr(r.ESG_block) === STATE.filters.block);
  if (STATE.filters.theme) rows = rows.filter(r => safeStr(r.theme_tag) === STATE.filters.theme);
  if (STATE.filters.collabType) rows = rows.filter(r => safeStr(r.collaboration_type) === STATE.filters.collabType);
  if (STATE.filters.driver) rows = rows.filter(r => safeStr(r.driver_primary) === STATE.filters.driver);
  if (STATE.filters.confidence) rows = rows.filter(r => safeStr(r.confidence) === STATE.filters.confidence);

  return rows;
}

function currentScopeScores(){
  const ids = new Set(currentScopeReportIds());
  return STATE.raw.scores.filter(r => ids.has(r.report_id));
}

// ------------------------- Load & Prepare -------------------------

async function loadAll(){
  const [company, initiatives, scores, catEdges, nameEdges] = await Promise.all([
    parseCSV(PATHS.company),
    parseCSV(PATHS.initiatives),
    parseCSV(PATHS.scores),
    parseCSV(PATHS.catEdges),
    parseCSV(PATHS.nameEdges),
  ]);

  // Normalize types
  STATE.raw.company = company.map(r => ({
    ...r,
    report_id: safeStr(r.report_id, ""),
    file_name: safeStr(r.file_name),
    company_name_english: safeStr(r.company_name_english),
    company_name_original: safeStr(r.company_name_original),
    year_of_report: safeStr(r.year_of_report),
    industry_sector: safeStr(r.industry_sector),
    ownership_type: safeStr(r.ownership_type),
    quantitative_data_richness: toNum(r.quantitative_data_richness, 0),
    overall_text_quality: toNum(r.overall_text_quality, 0),
  })).filter(r => r.report_id);

  STATE.raw.initiatives = initiatives.map(r => ({
    ...r,
    report_id: safeStr(r.report_id, ""),
    initiative_id: safeStr(r.initiative_id, ""),
    company_name_english: safeStr(r.company_name_english),
    ESG_block: safeStr(r.ESG_block),
    theme_tag: safeStr(r.theme_tag),
    collaboration_type: safeStr(r.collaboration_type),
    driver_primary: safeStr(r.driver_primary),
    collaboration_model: safeStr(r.collaboration_model),
    collaboration_present: safeStr(r.collaboration_present),
    KPI_present: safeStr(r.KPI_present),
    evidence_file_name: safeStr(r.evidence_file_name),
    evidence_page_numbers: safeStr(r.evidence_page_numbers),
    evidence_excerpt: safeStr(r.evidence_excerpt),
    confidence: safeStr(r.confidence),
  })).filter(r => r.report_id && r.initiative_id);

  STATE.raw.scores = scores.map(r => ({
    ...r,
    report_id: safeStr(r.report_id, ""),
    E_score: toNum(r.E_score, 0),
    S_score: toNum(r.S_score, 0),
    G_score: toNum(r.G_score, 0),
    collaboration_intensity: toNum(r.collaboration_intensity, 0),
    gov_interaction_score: toNum(r.gov_interaction_score, 0),
    ngo_interaction_score: toNum(r.ngo_interaction_score, 0),
    society_interaction_score: toNum(r.society_interaction_score, 0),
    business_partner_interaction_score: toNum(r.business_partner_interaction_score, 0),
    evidence_density: toNum(r.evidence_density, 0),
    quant_metrics_count: toNum(r.quant_metrics_count, 0),
  })).filter(r => r.report_id);

  STATE.raw.catEdges = catEdges.map(r => ({
    ...r,
    report_id: safeStr(r.report_id, ""),
    company: safeStr(r.company),
    actor_category: safeStr(r.actor_category),
    ESG_block: safeStr(r.ESG_block),
    theme_tag: safeStr(r.theme_tag),
    weight: toNum(r.weight, 0),
  })).filter(r => r.report_id);

  STATE.raw.nameEdges = nameEdges.map(r => ({
    ...r,
    report_id: safeStr(r.report_id, ""),
    company: safeStr(r.company),
    actor_name: safeStr(r.actor_name),
    actor_type: safeStr(r.actor_type),
    theme_tag: safeStr(r.theme_tag),
    evidence_page_numbers: safeStr(r.evidence_page_numbers),
  })).filter(r => r.report_id);

  // Join company_master + scores
  const scoreById = new Map(STATE.raw.scores.map(s => [s.report_id, s]));
  STATE.joined.companies = STATE.raw.company.map(c => ({
    ...c,
    ...(scoreById.get(c.report_id) || {}),
  }));

  // Sidebar KPIs (global)
  $("kReports").textContent = String(STATE.raw.company.length);
  $("kInitiatives").textContent = String(STATE.raw.initiatives.length);
  $("kCollab").textContent = String(STATE.raw.initiatives.filter(x => String(x.collaboration_present).toLowerCase() === "yes").length);
  $("kNamedEdges").textContent = String(STATE.raw.nameEdges.length);

  buildFiltersUI();
  buildTables();
  buildCharts();
  buildNetworks();
  renderAll();
}

// ------------------------- Build Filters UI -------------------------

function buildFiltersUI(){
  buildSelect($("fCompany"),
    STATE.raw.company.map(r => r.report_id),
    "All companies"
  );

  buildSelect($("fSector"),
    uniq(STATE.raw.company.map(r => r.industry_sector)),
    "All sectors"
  );

  buildSelect($("fYear"),
    uniq(STATE.raw.company.map(r => r.year_of_report)),
    "All years"
  );

  buildSelect($("fOwnership"),
    uniq(STATE.raw.company.map(r => r.ownership_type)),
    "All ownership"
  );

  buildSelect($("fBlock"),
    uniq(STATE.raw.initiatives.map(r => r.ESG_block)),
    "All ESG blocks"
  );

  buildSelect($("fTheme"),
    uniq(STATE.raw.initiatives.map(r => r.theme_tag)),
    "All themes"
  );

  buildSelect($("fCollabType"),
    uniq(STATE.raw.initiatives.map(r => r.collaboration_type)),
    "All collaboration types"
  );

  buildSelect($("fDriver"),
    uniq(STATE.raw.initiatives.map(r => r.driver_primary)),
    "All drivers"
  );

  buildSelect($("fConfidence"),
    uniq(STATE.raw.initiatives.map(r => r.confidence)),
    "All confidence"
  );

  // Network selectors
  buildSelect($("netThemeSelect"),
    uniq(STATE.raw.catEdges.map(r => r.theme_tag)),
    "All themes"
  );
  buildSelect($("netActorTypeSelect"),
    uniq(STATE.raw.nameEdges.map(r => r.actor_type)),
    "All actor types"
  );

  // Buttons
  $("btnApply").addEventListener("click", () => {
    STATE.filters.company = $("fCompany").value;
    STATE.filters.sector = $("fSector").value;
    STATE.filters.year = $("fYear").value;
    STATE.filters.ownership = $("fOwnership").value;

    STATE.filters.block = $("fBlock").value;
    STATE.filters.theme = $("fTheme").value;
    STATE.filters.collabType = $("fCollabType").value;
    STATE.filters.driver = $("fDriver").value;
    STATE.filters.confidence = $("fConfidence").value;

    STATE.ui.currentThemeFilterFromChart = null;
    renderAll();
  });

  $("btnReset").addEventListener("click", () => {
    Object.keys(STATE.filters).forEach(k => STATE.filters[k] = "");
    ["fCompany","fSector","fYear","fOwnership","fBlock","fTheme","fCollabType","fDriver","fConfidence"].forEach(id => $(id).value="");
    STATE.ui.currentThemeFilterFromChart = null;
    renderAll();
  });

  // Theme toggle
  $("btnTheme").addEventListener("click", () => {
    const next = (STATE.ui.theme === "dark") ? "light" : "dark";
    applyTheme(next);
    // Rebuild charts for better colors on theme change
    destroyCharts();
    buildCharts();
    renderAll();
  });

  // Tabs
  $("tabs").addEventListener("click", (e) => {
    const btn = e.target.closest(".tab");
    if (!btn) return;
    setTab(btn.dataset.tab);
    // Re-render networks when tab opens (sizing)
    if (btn.dataset.tab === "network") {
      renderNetworks();
    }
  });

  // Exports
  $("btnExportScope").addEventListener("click", () => exportScopeInitiatives());
  $("btnExportInitiatives").addEventListener("click", () => STATE.tables.initiatives?.download("csv", "initiatives_filtered.csv"));
  $("btnExportCompany").addEventListener("click", () => exportCompanyInitiatives());
  $("btnExportEDA").addEventListener("click", () => STATE.tables.eda?.download("csv", "eda_company_table.csv"));

  $("btnClearThemeFilter").addEventListener("click", () => {
    STATE.filters.theme = "";
    $("fTheme").value = "";
    STATE.ui.currentThemeFilterFromChart = null;
    renderAll();
  });

  // Company PDF quick-open
  $("btnOpenCompanyPDF").addEventListener("click", () => {
    const rid = STATE.filters.company;
    if (!rid) return alert("Select a company first (left sidebar).");
    const row = STATE.raw.company.find(c => c.report_id === rid);
    if (!row) return;
    const url = pdfUrl(row.file_name, 1);
    window.open(url, "_blank");
  });
}

// ------------------------- Tables (Tabulator) -------------------------

function buildTables(){
  // Overview top companies table
  STATE.tables.topCompanies = new Tabulator("#tableTopCompanies", {
    layout: "fitColumns",
    height: 380,
    reactiveData: true,
    placeholder: "Loading…",
    rowClick: (e, row) => {
      const d = row.getData();
      $("fCompany").value = d.report_id;
      STATE.filters.company = d.report_id;
      setTab("company");
      renderAll();
    },
    columns: [
      {title:"report_id", field:"report_id", width: 90},
      {title:"company", field:"company_name_english"},
      {title:"sector", field:"industry_sector"},
      {title:"E", field:"E_score", hozAlign:"center", width: 60},
      {title:"S", field:"S_score", hozAlign:"center", width: 60},
      {title:"G", field:"G_score", hozAlign:"center", width: 60},
      {title:"collab_intensity", field:"collaboration_intensity", hozAlign:"center", width: 130},
      {title:"evidence_density", field:"evidence_density", hozAlign:"center", width: 130},
      {title:"KPIs", field:"quant_metrics_count", hozAlign:"center", width: 70},
    ],
  });

  // Company initiatives table
  STATE.tables.companyInitiatives = new Tabulator("#tableCompanyInitiatives", {
    layout: "fitColumns",
    height: 520,
    reactiveData: true,
    placeholder: "Select a company to view its initiatives…",
    columns: initiativeColumns(),
  });

  // Full initiatives explorer
  STATE.tables.initiatives = new Tabulator("#tableInitiatives", {
    layout: "fitColumns",
    height: 720,
    reactiveData: true,
    pagination: true,
    paginationSize: 20,
    paginationSizeSelector: [10,20,50,100],
    placeholder: "Loading initiatives…",
    columns: initiativeColumns(),
  });

  // EDA table (company level joined)
  STATE.tables.eda = new Tabulator("#tableEDA", {
    layout: "fitColumns",
    height: 520,
    reactiveData: true,
    placeholder: "Loading…",
    columns: [
      {title:"report_id", field:"report_id", width: 90},
      {title:"company", field:"company_name_english"},
      {title:"year", field:"year_of_report", width: 80},
      {title:"sector", field:"industry_sector"},
      {title:"ownership", field:"ownership_type"},
      {title:"E", field:"E_score", hozAlign:"center", width: 60},
      {title:"S", field:"S_score", hozAlign:"center", width: 60},
      {title:"G", field:"G_score", hozAlign:"center", width: 60},
      {title:"collab", field:"collaboration_intensity", hozAlign:"center", width: 70},
      {title:"gov", field:"gov_interaction_score", hozAlign:"center", width: 60},
      {title:"ngo", field:"ngo_interaction_score", hozAlign:"center", width: 60},
      {title:"society", field:"society_interaction_score", hozAlign:"center", width: 70},
      {title:"partners", field:"business_partner_interaction_score", hozAlign:"center", width: 80},
      {title:"evidence_density", field:"evidence_density", hozAlign:"center", width: 120},
      {title:"KPI_count", field:"quant_metrics_count", hozAlign:"center", width: 90},
      {title:"standards", field:"reporting_standard_mentions"},
      {title:"summary", field:"main_business_summary"},
    ],
  });
}

function initiativeColumns(){
  return [
    {title:"initiative_id", field:"initiative_id", width: 120},
    {title:"report_id", field:"report_id", width: 90},
    {title:"company", field:"company_name_english"},
    {title:"block", field:"ESG_block", width: 110},
    {title:"theme_tag", field:"theme_tag", width: 170},
    {title:"collaboration_type", field:"collaboration_type", width: 240},
    {title:"driver_primary", field:"driver_primary", width: 180},
    {title:"model", field:"collaboration_model", width: 220},
    {title:"actors", field:"actors_involved", width: 240},
    {title:"KPI_present", field:"KPI_present", width: 110, hozAlign:"center"},
    {title:"KPI_list", field:"KPI_list", width: 220},
    {title:"geography", field:"geography", width: 140},
    {
      title:"evidence",
      field:"evidence_file_name",
      width: 220,
      formatter: (cell) => {
        const row = cell.getRow().getData();
        const file = row.evidence_file_name;
        const p = row.evidence_page_numbers;
        const url = pdfUrl(file, p);
        const label = `${file} p${p}`;
        return `<a href="${url}" target="_blank" rel="noopener">${escapeHtml(label)}</a>`;
      }
    },
    {title:"excerpt", field:"evidence_excerpt", width: 520},
    {title:"confidence", field:"confidence", width: 110, hozAlign:"center"},
  ];
}

function escapeHtml(s){
  return String(s)
    .replaceAll("&","&amp;")
    .replaceAll("<","&lt;")
    .replaceAll(">","&gt;")
    .replaceAll('"',"&quot;")
    .replaceAll("'","&#039;");
}

function pdfUrl(fileName, page){
  // If PDFs are placed under /pdfs/, this becomes a working link on GitHub Pages.
  // page may be "48" or "48,49" etc. We take the first numeric.
  const p = extractFirstPage(page);
  const safe = encodeURIComponent(fileName).replaceAll("%2F","/");
  return `./pdfs/${safe}#page=${p}`;
}

function extractFirstPage(pageStr){
  const s = String(pageStr || "").trim();
  const m = s.match(/(\d+)/);
  return m ? Number(m[1]) : 1;
}

// ------------------------- Charts -------------------------

function destroyCharts(){
  for (const k of Object.keys(STATE.charts)){
    try { STATE.charts[k]?.destroy(); } catch {}
  }
  STATE.charts = {};
}

function buildCharts(){
  const gridColor = getComputedStyle(document.documentElement).getPropertyValue("--stroke").trim();
  const textColor = getComputedStyle(document.documentElement).getPropertyValue("--text").trim();

  Chart.defaults.color = textColor;
  Chart.defaults.borderColor = gridColor;

  // Radar (overview)
  STATE.charts.radar = new Chart($("chartRadar"), {
    type: "radar",
    data: {
      labels: ["E_score","S_score","G_score"],
      datasets: [{ label: "Mean (0–3)", data: [0,0,0] }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      scales: { r: { suggestedMin:0, suggestedMax:3, grid:{color:gridColor} } },
      plugins: { legend: { display: false } }
    }
  });

  // Interaction bars (overview)
  STATE.charts.interactions = new Chart($("chartInteractions"), {
    type: "bar",
    data: {
      labels: ["Gov","NGO","Society","Partners","Intensity"],
      datasets: [{ label: "Mean (0–3)", data: [0,0,0,0,0] }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      scales: { y: { suggestedMin:0, suggestedMax:3, grid:{color:gridColor} } },
      plugins: { legend: { display: false } }
    }
  });

  // Top themes
  STATE.charts.themes = new Chart($("chartThemes"), {
    type: "bar",
    data: { labels: [], datasets: [{ label:"Count", data: [] }] },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      onClick: (evt, elements) => {
        if (!elements.length) return;
        const i = elements[0].index;
        const theme = STATE.charts.themes.data.labels[i];
        // Apply theme filter quickly
        $("fTheme").value = theme;
        STATE.filters.theme = theme;
        STATE.ui.currentThemeFilterFromChart = theme;
        renderAll();
        setTab("initiatives");
      },
      scales: { y: { beginAtZero:true, grid:{color:gridColor} } },
      plugins: { legend: { display: false } }
    }
  });

  // Drivers
  STATE.charts.drivers = new Chart($("chartDrivers"), {
    type: "bar",
    data: { labels: [], datasets: [{ label:"Count", data: [] }] },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      scales: { y: { beginAtZero:true, grid:{color:gridColor} } },
      plugins: { legend: { display: false } }
    }
  });

  // Collab types (doughnut)
  STATE.charts.collabTypes = new Chart($("chartCollabTypes"), {
    type: "doughnut",
    data: { labels: [], datasets: [{ label:"Count", data: [] }] },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: { legend: { position: "bottom" } }
    }
  });

  // Company charts
  STATE.charts.companyRadar = new Chart($("chartCompanyRadar"), {
    type: "radar",
    data: {
      labels: ["E","S","G","Evidence"],
      datasets: [{ label: "Score (0–3)", data: [0,0,0,0] }]
    },
    options: {
      responsive:true,
      maintainAspectRatio:false,
      scales: { r: { suggestedMin:0, suggestedMax:3, grid:{color:gridColor} } },
      plugins: { legend: { display: false } }
    }
  });

  STATE.charts.companyInteractions = new Chart($("chartCompanyInteractions"), {
    type: "bar",
    data: {
      labels: ["Gov","NGO","Society","Partners","Intensity"],
      datasets: [{ label:"Score (0–3)", data:[0,0,0,0,0] }]
    },
    options: {
      responsive:true,
      maintainAspectRatio:false,
      scales: { y: { suggestedMin:0, suggestedMax:3, grid:{color:gridColor} } },
      plugins: { legend: { display: false } }
    }
  });

  // EDA charts
  STATE.charts.distESG = new Chart($("chartDistESG"), {
    type: "bar",
    data: { labels: ["0","1","2","3"], datasets: [
      { label:"E", data:[0,0,0,0] },
      { label:"S", data:[0,0,0,0] },
      { label:"G", data:[0,0,0,0] },
    ]},
    options: {
      responsive:true,
      maintainAspectRatio:false,
      scales: { y: { beginAtZero:true, grid:{color:gridColor} } },
    }
  });

  STATE.charts.sectorAvg = new Chart($("chartSectorAvg"), {
    type: "bar",
    data: { labels: [], datasets: [
      { label:"E", data: [] },
      { label:"S", data: [] },
      { label:"G", data: [] },
      { label:"Collab", data: [] },
    ]},
    options: {
      responsive:true,
      maintainAspectRatio:false,
      scales: { y: { suggestedMin:0, suggestedMax:3, grid:{color:gridColor} } },
      plugins: { legend: { position:"bottom" } }
    }
  });

  STATE.charts.blocks = new Chart($("chartBlocks"), {
    type: "bar",
    data: { labels: [], datasets: [{ label:"Count", data: [] }] },
    options: {
      responsive:true,
      maintainAspectRatio:false,
      scales: { y: { beginAtZero:true, grid:{color:gridColor} } },
      plugins: { legend: { display:false } }
    }
  });

  STATE.charts.kpiEvidence = new Chart($("chartKPIvsEvidence"), {
    type: "scatter",
    data: { datasets: [{ label:"Companies", data: [] }] },
    options: {
      responsive:true,
      maintainAspectRatio:false,
      scales: {
        x: { title:{display:true, text:"quant_metrics_count"}, grid:{color:gridColor} },
        y: { title:{display:true, text:"evidence_density (0–3)"}, suggestedMin:0, suggestedMax:3, grid:{color:gridColor} },
      },
      plugins: { legend: { display:false } }
    }
  });
}

// ------------------------- Render Everything -------------------------

function renderAll(){
  // Update scope pill
  const ids = currentScopeReportIds();
  $("scopePill").textContent = `Scope: ${ids.length} report(s)`;

  renderOverview();
  renderCompany();
  renderInitiatives();
  renderEDA();
  renderNetworks();

  // Update tables
  renderTables();
}

function renderOverview(){
  const scores = currentScopeScores();
  const inits = currentScopeInitiatives();

  const mE = mean(scores.map(s => s.E_score));
  const mS = mean(scores.map(s => s.S_score));
  const mG = mean(scores.map(s => s.G_score));
  const mED = mean(scores.map(s => s.evidence_density));

  $("mE").textContent = fmt1(mE);
  $("mS").textContent = fmt1(mS);
  $("mG").textContent = fmt1(mG);
  $("mED").textContent = fmt1(mED);

  // Radar
  STATE.charts.radar.data.datasets[0].data = [mE, mS, mG];
  STATE.charts.radar.update();

  // Interaction bars
  const mg = mean(scores.map(s => s.gov_interaction_score));
  const mn = mean(scores.map(s => s.ngo_interaction_score));
  const ms = mean(scores.map(s => s.society_interaction_score));
  const mp = mean(scores.map(s => s.business_partner_interaction_score));
  const mi = mean(scores.map(s => s.collaboration_intensity));

  STATE.charts.interactions.data.datasets[0].data = [mg, mn, ms, mp, mi];
  STATE.charts.interactions.update();

  // Themes top 10
  const themeCounts = topNCountPairs(countBy(inits, "theme_tag"), 10);
  STATE.charts.themes.data.labels = themeCounts.map(x => x[0]);
  STATE.charts.themes.data.datasets[0].data = themeCounts.map(x => x[1]);
  STATE.charts.themes.update();

  // Drivers top 10
  const driverCounts = topNCountPairs(countBy(inits, "driver_primary"), 10);
  STATE.charts.drivers.data.labels = driverCounts.map(x => x[0]);
  STATE.charts.drivers.data.datasets[0].data = driverCounts.map(x => x[1]);
  STATE.charts.drivers.update();

  // Collab types (only where collaboration_present == yes)
  const collabRows = inits.filter(r => String(r.collaboration_present).toLowerCase() === "yes");
  const collabCounts = topNCountPairs(countBy(collabRows, "collaboration_type"), 10);
  STATE.charts.collabTypes.data.labels = collabCounts.map(x => x[0]);
  STATE.charts.collabTypes.data.datasets[0].data = collabCounts.map(x => x[1]);
  STATE.charts.collabTypes.update();

  // Export scope initiatives
  // (button handled via click event)
}

function renderCompany(){
  const rid = STATE.filters.company;
  if (!rid){
    $("companyPill").textContent = "No company selected";
    $("companyProfile").innerHTML = `<div class="profile-empty">Select a company using the left filter (Company).</div>`;
    // reset charts
    STATE.charts.companyRadar.data.datasets[0].data = [0,0,0,0];
    STATE.charts.companyRadar.update();
    STATE.charts.companyInteractions.data.datasets[0].data = [0,0,0,0,0];
    STATE.charts.companyInteractions.update();
    return;
  }

  const c = STATE.joined.companies.find(x => x.report_id === rid);
  if (!c){
    $("companyPill").textContent = `Unknown ${rid}`;
    return;
  }

  $("companyPill").textContent = `${c.report_id} · ${c.company_name_english}`;

  $("companyProfile").innerHTML = `
    <div class="item">
      <div class="label">Report</div>
      <div class="value">${escapeHtml(c.file_name)}</div>
    </div>
    <div class="item">
      <div class="label">Year</div>
      <div class="value">${escapeHtml(c.year_of_report)}</div>
    </div>
    <div class="item">
      <div class="label">Sector</div>
      <div class="value">${escapeHtml(c.industry_sector)}</div>
    </div>
    <div class="item">
      <div class="label">Ownership</div>
      <div class="value">${escapeHtml(c.ownership_type)}</div>
    </div>
    <div class="item">
      <div class="label">Quantitative richness (0–3)</div>
      <div class="value">${escapeHtml(String(c.quantitative_data_richness ?? "not stated"))}</div>
    </div>
    <div class="item">
      <div class="label">Text quality (0–3)</div>
      <div class="value">${escapeHtml(String(c.overall_text_quality ?? "not stated"))}</div>
    </div>
    <div class="item full">
      <div class="label">Main business summary</div>
      <div class="value">${escapeHtml(c.main_business_summary || "not stated")}</div>
    </div>
    <div class="item full">
      <div class="label">Reporting standard mentions</div>
      <div class="value">${escapeHtml(c.reporting_standard_mentions || "not stated")}</div>
    </div>
    <div class="item full">
      <div class="label">Size proxy</div>
      <div class="value">${escapeHtml(c.size_proxy || "not stated")}</div>
    </div>
  `;

  // Charts
  const E = toNum(c.E_score, 0);
  const S = toNum(c.S_score, 0);
  const G = toNum(c.G_score, 0);
  const ED = toNum(c.evidence_density, 0);

  STATE.charts.companyRadar.data.datasets[0].data = [E,S,G,ED];
  STATE.charts.companyRadar.update();

  const gov = toNum(c.gov_interaction_score,0);
  const ngo = toNum(c.ngo_interaction_score,0);
  const soc = toNum(c.society_interaction_score,0);
  const par = toNum(c.business_partner_interaction_score,0);
  const inten = toNum(c.collaboration_intensity,0);

  STATE.charts.companyInteractions.data.datasets[0].data = [gov, ngo, soc, par, inten];
  STATE.charts.companyInteractions.update();
}

function renderInitiatives(){
  // nothing heavy here; table render handles it
}

function renderEDA(){
  const scores = currentScopeScores();
  const inits = currentScopeInitiatives();
  const companies = currentScopeCompanyRows();

  // Distributions E/S/G (0–3)
  const bins = [0,1,2,3];
  const dist = (key) => bins.map(b => scores.filter(s => toNum(s[key],0) === b).length);

  STATE.charts.distESG.data.datasets[0].data = dist("E_score");
  STATE.charts.distESG.data.datasets[1].data = dist("S_score");
  STATE.charts.distESG.data.datasets[2].data = dist("G_score");
  STATE.charts.distESG.update();

  // Sector averages
  const bySector = new Map();
  for (const c of companies){
    const sec = safeStr(c.industry_sector);
    if (!bySector.has(sec)) bySector.set(sec, []);
    bySector.get(sec).push(c);
  }
  const sectorLabels = [...bySector.keys()].sort((a,b)=>a.localeCompare(b));
  const avg = (arr, key) => mean(arr.map(x => toNum(x[key],0)));

  STATE.charts.sectorAvg.data.labels = sectorLabels.slice(0, 12); // keep readable
  STATE.charts.sectorAvg.data.datasets[0].data = sectorLabels.slice(0,12).map(s => avg(bySector.get(s), "E_score"));
  STATE.charts.sectorAvg.data.datasets[1].data = sectorLabels.slice(0,12).map(s => avg(bySector.get(s), "S_score"));
  STATE.charts.sectorAvg.data.datasets[2].data = sectorLabels.slice(0,12).map(s => avg(bySector.get(s), "G_score"));
  STATE.charts.sectorAvg.data.datasets[3].data = sectorLabels.slice(0,12).map(s => avg(bySector.get(s), "collaboration_intensity"));
  STATE.charts.sectorAvg.update();

  // Initiatives by ESG block
  const blockCounts = topNCountPairs(countBy(inits, "ESG_block"), 10);
  STATE.charts.blocks.data.labels = blockCounts.map(x => x[0]);
  STATE.charts.blocks.data.datasets[0].data = blockCounts.map(x => x[1]);
  STATE.charts.blocks.update();

  // KPI count vs evidence density scatter
  STATE.charts.kpiEvidence.data.datasets[0].data = companies.map(c => ({
    x: toNum(c.quant_metrics_count, 0),
    y: toNum(c.evidence_density, 0),
  }));
  STATE.charts.kpiEvidence.update();

  // Correlation heatmap (company-level numeric cols)
  renderCorrelationHeatmap(companies);
}

function renderTables(){
  const companies = currentScopeCompanyRows();
  const scores = currentScopeScores();
  const inits = currentScopeInitiatives();

  // Top companies (collaboration intensity desc, then evidence density desc)
  const rows = companies
    .slice()
    .sort((a,b) => (toNum(b.collaboration_intensity,0) - toNum(a.collaboration_intensity,0)) || (toNum(b.evidence_density,0) - toNum(a.evidence_density,0)))
    .slice(0, 25);
  STATE.tables.topCompanies.setData(rows);

  // Company initiatives table
  if (STATE.filters.company){
    const rid = STATE.filters.company;
    const companyInits = STATE.raw.initiatives.filter(r => r.report_id === rid);
    STATE.tables.companyInitiatives.setData(companyInits);
  } else {
    STATE.tables.companyInitiatives.setData([]);
  }

  // Initiative explorer table
  STATE.tables.initiatives.setData(inits);

  // EDA table
  STATE.tables.eda.setData(companies);
}

// ------------------------- Exports -------------------------

function exportScopeInitiatives(){
  const inits = currentScopeInitiatives();
  downloadCSV(inits, "scope_initiatives.csv");
}

function exportCompanyInitiatives(){
  const rid = STATE.filters.company;
  if (!rid) return alert("Select a company first.");
  const inits = STATE.raw.initiatives.filter(r => r.report_id === rid);
  downloadCSV(inits, `${rid}_initiatives.csv`);
}

function downloadCSV(rows, filename){
  if (!rows.length) return alert("No rows in current scope.");
  const headers = Object.keys(rows[0]);
  const csv = [
    headers.join(","),
    ...rows.map(r => headers.map(h => csvCell(r[h])).join(",")),
  ].join("\n");

  const blob = new Blob([csv], {type:"text/csv;charset=utf-8;"});
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

function csvCell(v){
  const s = (v === null || v === undefined) ? "" : String(v);
  const escaped = s.replaceAll('"', '""');
  return `"${escaped}"`;
}

// ------------------------- Networks (D3) -------------------------

function buildNetworks(){
  // initial build (render uses filters)
  $("netThemeSelect").addEventListener("change", () => renderNetworks());
  $("netActorTypeSelect").addEventListener("change", () => renderNetworks());
  $("btnNetReset").addEventListener("click", () => {
    $("netThemeSelect").value = "";
    renderNetworks();
  });
  $("btnNamedNetReset").addEventListener("click", () => {
    $("netActorTypeSelect").value = "";
    renderNetworks();
  });
}

function renderNetworks(){
  renderCategoryNetwork();
  renderNamedActorNetwork();
}

function renderCategoryNetwork(){
  const svg = d3.select("#svgCategoryNet");
  svg.selectAll("*").remove();

  const width = svg.node().getBoundingClientRect().width;
  const height = svg.node().getBoundingClientRect().height;

  const ids = new Set(currentScopeReportIds());
  const themeFilter = $("netThemeSelect").value;

  const edges = STATE.raw.catEdges
    .filter(e => ids.has(e.report_id))
    .filter(e => !themeFilter || e.theme_tag === themeFilter);

  // Build bipartite graph: company nodes + category nodes
  const categories = ["Government","NGO","Society","Business Partners"];
  const nodesMap = new Map();

  function node(id, group){
    if (!nodesMap.has(id)) nodesMap.set(id, {id, group});
  }

  for (const e of edges){
    node(e.company, "company");
    node(e.actor_category, "category");
  }

  const nodes = [...nodesMap.values()];
  const links = edges.map(e => ({
    source: e.company,
    target: e.actor_category,
    weight: e.weight,
    theme: e.theme_tag,
    block: e.ESG_block
  }));

  if (!nodes.length){
    svg.append("text")
      .attr("x", 14).attr("y", 28)
      .attr("fill", "currentColor")
      .text("No edges in scope (adjust filters).");
    return;
  }

  const color = (d) => d.group === "company" ? "rgba(106,166,255,0.90)" : "rgba(169,139,255,0.90)";

  const sim = d3.forceSimulation(nodes)
    .force("link", d3.forceLink(links).id(d => d.id).distance(110).strength(0.35))
    .force("charge", d3.forceManyBody().strength(-160))
    .force("center", d3.forceCenter(width/2, height/2))
    .force("collide", d3.forceCollide().radius(18));

  const link = svg.append("g")
    .attr("stroke", "rgba(255,255,255,0.20)")
    .selectAll("line")
    .data(links)
    .join("line")
    .attr("stroke-width", d => Math.max(1.2, Math.log2(d.weight + 1)));

  const nodeG = svg.append("g")
    .selectAll("g")
    .data(nodes)
    .join("g")
    .call(d3.drag()
      .on("start", dragstarted)
      .on("drag", dragged)
      .on("end", dragended)
    );

  nodeG.append("circle")
    .attr("r", d => d.group === "company" ? 7 : 10)
    .attr("fill", d => color(d))
    .attr("stroke", "rgba(255,255,255,0.35)")
    .attr("stroke-width", 1);

  nodeG.append("text")
    .text(d => d.id)
    .attr("x", 12)
    .attr("y", 4)
    .attr("font-size", "11px")
    .attr("fill", "currentColor")
    .attr("opacity", 0.85);

  // tooltip
  const tip = d3.select("body").append("div")
    .attr("class", "d3tip")
    .style("position", "fixed")
    .style("pointer-events", "none")
    .style("padding", "10px 12px")
    .style("border-radius", "14px")
    .style("background", "rgba(10,16,36,0.88)")
    .style("border", "1px solid rgba(255,255,255,0.16)")
    .style("color", "white")
    .style("font-size", "12px")
    .style("opacity", 0);

  link.on("mousemove", (evt, d) => {
    tip.style("opacity", 1)
      .style("left", (evt.clientX + 12) + "px")
      .style("top", (evt.clientY + 12) + "px")
      .html(`<div><b>${escapeHtml(d.source.id)}</b> ↔ <b>${escapeHtml(d.target.id)}</b></div>
             <div>weight: ${d.weight}</div>
             <div>theme: ${escapeHtml(d.theme)}</div>
             <div>block: ${escapeHtml(d.block)}</div>`);
  }).on("mouseleave", () => tip.style("opacity", 0));

  sim.on("tick", () => {
    link
      .attr("x1", d => d.source.x).attr("y1", d => d.source.y)
      .attr("x2", d => d.target.x).attr("y2", d => d.target.y);

    nodeG.attr("transform", d => `translate(${d.x},${d.y})`);
  });

  function dragstarted(event){
    if (!event.active) sim.alphaTarget(0.3).restart();
    event.subject.fx = event.subject.x;
    event.subject.fy = event.subject.y;
  }
  function dragged(event){
    event.subject.fx = event.x;
    event.subject.fy = event.y;
  }
  function dragended(event){
    if (!event.active) sim.alphaTarget(0);
    event.subject.fx = null;
    event.subject.fy = null;
  }

  // clean tooltip on rerender
  setTimeout(() => {
    // remove old tips if many
    const tips = document.querySelectorAll(".d3tip");
    if (tips.length > 1) tips[0].remove();
  }, 0);
}

function renderNamedActorNetwork(){
  const svg = d3.select("#svgNamedNet");
  svg.selectAll("*").remove();

  const width = svg.node().getBoundingClientRect().width;
  const height = svg.node().getBoundingClientRect().height;

  const ids = new Set(currentScopeReportIds());
  const actorType = $("netActorTypeSelect").value;

  const edges = STATE.raw.nameEdges
    .filter(e => ids.has(e.report_id))
    .filter(e => !actorType || e.actor_type === actorType);

  // Reduce size: take top N edges by frequency per actor_name in scope
  // (actor_name_edges may have duplicates; we aggregate)
  const agg = new Map(); // key: company|actor_name
  for (const e of edges){
    const key = `${e.company}||${e.actor_name}||${e.actor_type}`;
    agg.set(key, (agg.get(key) || 0) + 1);
  }
  const linksAgg = [...agg.entries()]
    .map(([k, w]) => {
      const [company, actor_name, actor_type] = k.split("||");
      return { company, actor_name, actor_type, weight: w };
    })
    .sort((a,b)=>b.weight-a.weight)
    .slice(0, 160);

  const nodesMap = new Map();
  const node = (id, group, type=null) => {
    if (!nodesMap.has(id)) nodesMap.set(id, {id, group, type});
  };

  for (const l of linksAgg){
    node(l.company, "company");
    node(l.actor_name, "actor", l.actor_type);
  }

  const nodes = [...nodesMap.values()];
  const links = linksAgg.map(l => ({
    source: l.company,
    target: l.actor_name,
    weight: l.weight,
    actor_type: l.actor_type
  }));

  if (!nodes.length){
    svg.append("text")
      .attr("x", 14).attr("y", 28)
      .attr("fill", "currentColor")
      .text("No named actor edges in scope (adjust filters).");
    return;
  }

  const color = (d) => {
    if (d.group === "company") return "rgba(106,166,255,0.90)";
    // actor nodes by type
    const t = (d.type || "").toLowerCase();
    if (t.includes("government")) return "rgba(124,255,177,0.85)";
    if (t.includes("ngo")) return "rgba(255,211,124,0.85)";
    if (t.includes("society")) return "rgba(169,139,255,0.85)";
    return "rgba(236,240,255,0.70)";
  };

  const sim = d3.forceSimulation(nodes)
    .force("link", d3.forceLink(links).id(d => d.id).distance(120).strength(0.28))
    .force("charge", d3.forceManyBody().strength(-170))
    .force("center", d3.forceCenter(width/2, height/2))
    .force("collide", d3.forceCollide().radius(18));

  const link = svg.append("g")
    .attr("stroke", "rgba(255,255,255,0.20)")
    .selectAll("line")
    .data(links)
    .join("line")
    .attr("stroke-width", d => Math.max(1.1, Math.log2(d.weight + 1)));

  const nodeG = svg.append("g")
    .selectAll("g")
    .data(nodes)
    .join("g")
    .call(d3.drag()
      .on("start", (event)=>{ if(!event.active) sim.alphaTarget(0.3).restart(); event.subject.fx=event.subject.x; event.subject.fy=event.subject.y; })
      .on("drag", (event)=>{ event.subject.fx=event.x; event.subject.fy=event.y; })
      .on("end", (event)=>{ if(!event.active) sim.alphaTarget(0); event.subject.fx=null; event.subject.fy=null; })
    );

  nodeG.append("circle")
    .attr("r", d => d.group === "company" ? 7 : 9)
    .attr("fill", d => color(d))
    .attr("stroke", "rgba(255,255,255,0.35)")
    .attr("stroke-width", 1);

  nodeG.append("text")
    .text(d => d.id)
    .attr("x", 12)
    .attr("y", 4)
    .attr("font-size", "11px")
    .attr("fill", "currentColor")
    .attr("opacity", 0.85);

  sim.on("tick", () => {
    link
      .attr("x1", d => d.source.x).attr("y1", d => d.source.y)
      .attr("x2", d => d.target.x).attr("y2", d => d.target.y);

    nodeG.attr("transform", d => `translate(${d.x},${d.y})`);
  });
}

// ------------------------- Correlation Heatmap -------------------------

function corr(xs, ys){
  const n = Math.min(xs.length, ys.length);
  const x = xs.slice(0,n), y = ys.slice(0,n);
  const mx = mean(x), my = mean(y);
  let num = 0, dx = 0, dy = 0;
  for (let i=0;i<n;i++){
    const a = x[i]-mx; const b = y[i]-my;
    num += a*b; dx += a*a; dy += b*b;
  }
  const den = Math.sqrt(dx*dy);
  if (!den) return 0;
  return num/den;
}

function renderCorrelationHeatmap(companies){
  const cols = [
    ["E_score", x=>toNum(x.E_score,0)],
    ["S_score", x=>toNum(x.S_score,0)],
    ["G_score", x=>toNum(x.G_score,0)],
    ["collaboration_intensity", x=>toNum(x.collaboration_intensity,0)],
    ["gov_interaction_score", x=>toNum(x.gov_interaction_score,0)],
    ["ngo_interaction_score", x=>toNum(x.ngo_interaction_score,0)],
    ["society_interaction_score", x=>toNum(x.society_interaction_score,0)],
    ["business_partner_interaction_score", x=>toNum(x.business_partner_interaction_score,0)],
    ["evidence_density", x=>toNum(x.evidence_density,0)],
    ["quant_metrics_count", x=>toNum(x.quant_metrics_count,0)],
  ];

  const values = cols.map(([name, fn]) => companies.map(fn));
  const names = cols.map(([name]) => name);

  const grid = [];
  for (let i=0;i<names.length;i++){
    for (let j=0;j<names.length;j++){
      const c = corr(values[i], values[j]);
      grid.push({i,j,c});
    }
  }

  const el = $("heatmapCorr");
  el.innerHTML = "";

  const table = document.createElement("table");
  table.style.borderCollapse = "separate";
  table.style.borderSpacing = "6px";
  table.style.width = "100%";

  // header
  const trH = document.createElement("tr");
  trH.appendChild(document.createElement("th"));
  for (const n of names){
    const th = document.createElement("th");
    th.textContent = shortName(n);
    th.style.fontSize = "11px";
    th.style.color = "var(--muted)";
    th.style.textAlign = "center";
    trH.appendChild(th);
  }
  table.appendChild(trH);

  for (let i=0;i<names.length;i++){
    const tr = document.createElement("tr");
    const th = document.createElement("th");
    th.textContent = shortName(names[i]);
    th.style.fontSize = "11px";
    th.style.color = "var(--muted)";
    th.style.textAlign = "right";
    th.style.paddingRight = "6px";
    tr.appendChild(th);

    for (let j=0;j<names.length;j++){
      const c = grid.find(x => x.i===i && x.j===j).c;
      const td = document.createElement("td");
      td.textContent = fmt1(c);
      td.title = `${names[i]} vs ${names[j]}: ${c.toFixed(3)}`;
      td.style.textAlign = "center";
      td.style.fontSize = "11px";
      td.style.padding = "8px 6px";
      td.style.borderRadius = "12px";
      td.style.border = "1px solid var(--stroke)";
      td.style.background = heatColor(c);
      tr.appendChild(td);
    }
    table.appendChild(tr);
  }

  el.appendChild(table);
}

function heatColor(v){
  // v in [-1,1] -> blue (neg) to purple (mid) to green (pos)
  const x = Math.max(-1, Math.min(1, v));
  const a = Math.abs(x);
  const base = (x >= 0) ? "rgba(124,255,177," : "rgba(106,166,255,";
  const alpha = 0.15 + 0.35*a;
  return base + alpha.toFixed(3) + ")";
}

function shortName(n){
  // Compact for heatmap
  const map = {
    "business_partner_interaction_score": "partner_score",
    "society_interaction_score": "society_score",
    "ngo_interaction_score": "ngo_score",
    "gov_interaction_score": "gov_score",
    "collaboration_intensity": "collab_int",
    "quant_metrics_count": "kpi_count",
    "evidence_density": "evidence",
  };
  return map[n] || n.replace("_score","").replaceAll("_"," ");
}

// ------------------------- Main Render Hooks -------------------------

function renderCompanyInitiativesTable(){
  // handled via renderTables()
}

// ------------------------- Start -------------------------
(function init(){
  applyTheme("dark");
  loadAll().catch(err => {
    console.error(err);
    alert("Failed to load CSVs. Make sure you are serving via a web server (GitHub Pages or local server).");
  });
})();

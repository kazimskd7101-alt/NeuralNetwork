// app/js/main.js
import { DATA_FILES, DEFAULTS } from "./config.js";
import { loadCsv, normalizeRows, loadBusinessReport } from "./dataLoader.js";
import {
  addKpis, addZeroSalesFlag, filterByRange,
  computeSharesForRange, sumTotals, safeDiv, fmtDateLocal
} from "./metrics.js";
import { buildIssuesAndActions } from "./recommendations.js";
import { renderTrendChart, renderShareChart, renderScatter } from "./charts.js";
import {
  wireNav, toast, setTheme, setRangeLabel, fillCampaignSelect, getSelectedCampaignIds,
  setKpis, renderIssuesTable, renderActions, renderHealth, renderDrillTable, renderRetailSnapshot
} from "./ui.js";

let DATA = null;
let isLight = false;

function parseDateInput(id) {
  const v = document.getElementById(id).value;
  if (!v) return null;
  const d = dayjs(v);
  return d.isValid() ? d.toDate() : null;
}

function setDefaultDates(totalDaily) {
  const rows = [...totalDaily].sort((a,b)=>a.date-b.date);
  const min = rows[0]?.date;
  const max = rows[rows.length-1]?.date;
  document.getElementById("dateStart").value = min ? fmtDateLocal(min) : "";
  document.getElementById("dateEnd").value = max ? fmtDateLocal(max) : "";
}

function selectedCampaignsOrAll(campaigns, selectEl) {
  const all = document.getElementById("allCampaigns").checked;
  if (all) return campaigns.map(c => c.campaign_id);
  const selected = getSelectedCampaignIds(selectEl);
  return selected.length ? selected : campaigns.map(c => c.campaign_id);
}

function filterByCampaign(rows, ids) {
  const set = new Set(ids.map(String));
  return rows.filter(r => set.has(String(r.campaign_id ?? r.campaign_name ?? "")));
}

/* ✅ Fix: chart resize always correct after page switch */
function resizeCharts() {
  ["chartTrend", "chartShare", "chartScatter"].forEach(id => {
    const el = document.getElementById(id);
    if (!el) return;
    const inst = echarts.getInstanceByDom(el);
    if (inst) inst.resize();
  });
}
window.addEventListener("ppc:routechange", () => setTimeout(resizeCharts, 60));
window.addEventListener("resize", () => resizeCharts());

function buildHealthReport(dataObj) {
  const items = [];
  for (const [name, rows] of Object.entries(dataObj)) {
    if (!Array.isArray(rows)) continue;

    const ok = rows.length > 0;
    let detail = ok ? `Rows: ${rows.length}` : "Missing or empty";

    if (ok && rows[0]?.date instanceof Date) {
      const dates = rows.map(r => r.date).filter(Boolean).sort((a,b)=>a-b);
      detail += ` · Range: ${fmtDateLocal(dates[0])} → ${fmtDateLocal(dates[dates.length-1])}`;
    }

    items.push({ name, ok, detail });
  }
  return items;
}

function summarizeBusinessReport(rows) {
  const totals = rows.reduce((a, r) => {
    a.sales += r.sales || 0;
    a.sessions += r.sessions || 0;
    a.units += r.units || 0;
    a.orders += r.orderItems || 0;
    return a;
  }, { sales: 0, sessions: 0, units: 0, orders: 0 });

  const unitSessionPct = safeDiv(totals.units, totals.sessions);
  return { ...totals, unitSessionPct };
}

async function init() {
  wireNav();

  document.getElementById("themeToggle").addEventListener("click", () => {
    isLight = !isLight;
    setTheme(isLight);
    document.getElementById("themeToggle").textContent = isLight ? "Light" : "Dark";
    if (DATA) applyFiltersAndRender(true);
  });

  try {
    toast("Loading datasets…");

    const [
      campaign, total, targeting, searchterm, placement, product,
      businessRows
    ] = await Promise.all([
      loadCsv(DATA_FILES.campaignDaily),
      loadCsv(DATA_FILES.totalDaily),
      loadCsv(DATA_FILES.targetingDaily),
      loadCsv(DATA_FILES.searchtermDaily),
      loadCsv(DATA_FILES.placementDaily),
      loadCsv(DATA_FILES.productDaily),
      loadBusinessReport(DATA_FILES.businessDaily),
    ]);

    const campaignDaily = addZeroSalesFlag(addKpis(normalizeRows(campaign)), DEFAULTS.zeroSalesSpendThreshold);
    const totalDaily = addZeroSalesFlag(addKpis(normalizeRows(total)), DEFAULTS.zeroSalesSpendThreshold);
    const targetingDaily = addZeroSalesFlag(addKpis(normalizeRows(targeting)), DEFAULTS.zeroSalesSpendThreshold);
    const searchtermDaily = addZeroSalesFlag(addKpis(normalizeRows(searchterm)), DEFAULTS.zeroSalesSpendThreshold);
    const placementDaily = addZeroSalesFlag(addKpis(normalizeRows(placement)), DEFAULTS.zeroSalesSpendThreshold);
    const productDaily = addZeroSalesFlag(addKpis(normalizeRows(product)), DEFAULTS.zeroSalesSpendThreshold);

    DATA = {
      campaignDaily, totalDaily, targetingDaily, searchtermDaily, placementDaily, productDaily,
      businessRows
    };

    // campaign dropdown
    const campaigns = Array.from(
      new Map(
        campaignDaily.map(r => [String(r.campaign_id ?? r.campaign_name ?? ""), {
          campaign_id: String(r.campaign_id ?? r.campaign_name ?? ""),
          campaign_name: String(r.campaign_name ?? r.campaign_id ?? ""),
        }])
      ).values()
    ).sort((a,b)=>a.campaign_name.localeCompare(b.campaign_name));

    const selectEl = document.getElementById("campaignSelect");
    fillCampaignSelect(selectEl, campaigns);
    setDefaultDates(totalDaily);

    const allChk = document.getElementById("allCampaigns");
    function syncAll() {
      selectEl.disabled = allChk.checked;
      if (allChk.checked) for (const o of selectEl.options) o.selected = false;
    }
    allChk.addEventListener("change", syncAll);
    syncAll();

    document.getElementById("applyBtn").addEventListener("click", () => applyFiltersAndRender(false));
    document.getElementById("drillLevel").addEventListener("change", () => applyFiltersAndRender(true));
    document.getElementById("onlyZeroSales").addEventListener("change", () => applyFiltersAndRender(true));
    document.getElementById("refreshActions").addEventListener("click", () => applyFiltersAndRender(true));

    const dlO = document.getElementById("downloadOverview");
    if (dlO) dlO.addEventListener("click", () => downloadOverviewCsv());

    const dlD = document.getElementById("downloadDrill");
    if (dlD) dlD.addEventListener("click", () => downloadDrillCsv());

    renderHealth(buildHealthReport({
      campaignDaily, totalDaily, targetingDaily, searchtermDaily, placementDaily, productDaily,
      businessReport: businessRows
    }));

    toast("Loaded. Apply filters to explore.");
    applyFiltersAndRender(true

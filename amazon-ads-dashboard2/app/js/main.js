import { DATA_FILES, DEFAULTS } from "./config.js";
import { loadCsv, normalizeRows } from "./dataLoader.js";
import {
  addKpis, addZeroSalesFlag, filterByRange,
  computeSharesForRange, sumTotals, safeDiv, fmtDateLocal
} from "./metrics.js";
import { buildIssuesAndActions } from "./recommendations.js";
import { renderTrendChart, renderShareChart, renderScatter } from "./charts.js";
import {
  wireNav, toast, setTheme, setRangeLabel, fillCampaignSelect, getSelectedCampaignIds,
  setKpis, renderIssuesTable, renderActions, renderHealth, renderDrillTable
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

/* Optional business report loader */
async function tryLoadBusinessReport() {
  try {
    const br = await loadCsv(DATA_FILES.businessDaily);
    const rows = normalizeRows(br);

    // Try to map common Amazon Business Report columns
    // We compute daily totals only.
    // You can rename columns later; this mapper is safe.
    const mapped = rows.map(r => {
      const out = { ...r };

      // common possible column names
      const totalSales =
        r.total_sales ?? r["Ordered Product Sales"] ?? r["ordered_product_sales"] ?? r["sales"] ?? null;

      out.total_sales = (typeof totalSales === "number") ? totalSales : Number(totalSales ?? 0);

      return out;
    }).filter(r => r.date && Number.isFinite(r.total_sales));

    if (!mapped.length) return null;

    // Aggregate by date
    const byDate = new Map();
    for (const r of mapped) {
      const k = fmtDateLocal(r.date);
      if (!byDate.has(k)) byDate.set(k, { date: r.date, total_sales: 0 });
      byDate.get(k).total_sales += Number(r.total_sales || 0);
    }
    return Array.from(byDate.values()).sort((a,b)=>a.date-b.date);
  } catch {
    return null;
  }
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
      businessDaily
    ] = await Promise.all([
      loadCsv(DATA_FILES.campaignDaily),
      loadCsv(DATA_FILES.totalDaily),
      loadCsv(DATA_FILES.targetingDaily),
      loadCsv(DATA_FILES.searchtermDaily),
      loadCsv(DATA_FILES.placementDaily),
      loadCsv(DATA_FILES.productDaily),
      tryLoadBusinessReport(), // optional
    ]);

    const campaignDaily = addZeroSalesFlag(addKpis(normalizeRows(campaign)), DEFAULTS.zeroSalesSpendThreshold);
    const totalDaily = addZeroSalesFlag(addKpis(normalizeRows(total)), DEFAULTS.zeroSalesSpendThreshold);
    const targetingDaily = addZeroSalesFlag(addKpis(normalizeRows(targeting)), DEFAULTS.zeroSalesSpendThreshold);
    const searchtermDaily = addZeroSalesFlag(addKpis(normalizeRows(searchterm)), DEFAULTS.zeroSalesSpendThreshold);
    const placementDaily = addZeroSalesFlag(addKpis(normalizeRows(placement)), DEFAULTS.zeroSalesSpendThreshold);
    const productDaily = addZeroSalesFlag(addKpis(normalizeRows(product)), DEFAULTS.zeroSalesSpendThreshold);

    DATA = { campaignDaily, totalDaily, targetingDaily, searchtermDaily, placementDaily, productDaily, businessDaily };

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

    // Downloads are in your older build; keep if present
    const dlO = document.getElementById("downloadOverview");
    if (dlO) dlO.addEventListener("click", () => downloadOverviewCsv());

    const dlD = document.getElementById("downloadDrill");
    if (dlD) dlD.addEventListener("click", () => downloadDrillCsv());

    renderHealth(buildHealthReport(DATA));
    toast("Loaded. Apply filters to explore.");
    applyFiltersAndRender(true);
  } catch (err) {
    console.error(err);
    toast(String(err.message || err));
    renderHealth([{ name: "Load error", ok: false, detail: String(err.message || err) }]);
  }
}

function applyFiltersAndRender(silent=false) {
  if (!DATA) return;

  const start = parseDateInput("dateStart");
  const end = parseDateInput("dateEnd");
  const threshold = Number(document.getElementById("zeroSpendThreshold").value || DEFAULTS.zeroSalesSpendThreshold);

  // Re-apply threshold
  const campaignDaily = addZeroSalesFlag([...DATA.campaignDaily], threshold);
  const totalDaily = addZeroSalesFlag([...DATA.totalDaily], threshold);
  const targetingDaily = addZeroSalesFlag([...DATA.targetingDaily], threshold);
  const searchtermDaily = addZeroSalesFlag([...DATA.searchtermDaily], threshold);
  const placementDaily = addZeroSalesFlag([...DATA.placementDaily], threshold);
  const productDaily = addZeroSalesFlag([...DATA.productDaily], threshold);

  // Range
  const campaignR = filterByRange(campaignDaily, start, end);
  const totalR = filterByRange(totalDaily, start, end);
  const targetingR = filterByRange(targetingDaily, start, end);
  const searchtermR = filterByRange(searchtermDaily, start, end);
  const placementR = filterByRange(placementDaily, start, end);
  const productR = filterByRange(productDaily, start, end);

  // Campaign filter
  const campaigns = Array.from(
    new Map(
      campaignDaily.map(r => [String(r.campaign_id ?? r.campaign_name ?? ""), {
        campaign_id: String(r.campaign_id ?? r.campaign_name ?? ""),
        campaign_name: String(r.campaign_name ?? r.campaign_id ?? ""),
      }])
    ).values()
  );

  const selectEl = document.getElementById("campaignSelect");
  const selectedIds = selectedCampaignsOrAll(campaigns, selectEl);

  const campaignRC = filterByCampaign(campaignR, selectedIds);
  const targetingRC = filterByCampaign(targetingR, selectedIds);
  const searchtermRC = filterByCampaign(searchtermR, selectedIds);
  const placementRC = filterByCampaign(placementR, selectedIds);
  const productRC = filterByCampaign(productR, selectedIds);

  // KPIs
  const totals = sumTotals(campaignRC);
  const ctr = totals.impressions ? totals.clicks / totals.impressions : null;
  const cpc = totals.clicks ? totals.cost / totals.clicks : null;
  const cvr = totals.clicks ? totals.orders / totals.clicks : null;
  const acos = totals.sales ? totals.cost / totals.sales : null;
  const roas = totals.cost ? totals.sales / totals.cost : null;

  // Optional business (TACoS + Organic)
  let tacos = null;
  let organicSales = null;
  if (Array.isArray(DATA.businessDaily) && DATA.businessDaily.length) {
    const bR = filterByRange(DATA.businessDaily, start, end);
    const totalSalesAll = bR.reduce((a,r)=>a+(r.total_sales||0),0);
    tacos = safeDiv(totals.cost, totalSalesAll);
    organicSales = totalSalesAll - totals.sales;
  }

  setKpis({
    spend: totals.cost,
    sales: totals.sales,
    roas, acos, ctr, cpc, cvr,
    zeroSalesSpend: totals.zeroSalesSpend,
    tacos, organicSales
  });

  setRangeLabel(start, end, selectedIds.length);

  // Charts
  renderTrendChart(document.getElementById("chartTrend"), totalR);
  const shareRows = computeSharesForRange(campaignRC);
  renderShareChart(document.getElementById("chartShare"), shareRows);
  renderScatter(document.getElementById("chartScatter"), shareRows);

  // Issues + Actions
  const { issues, actions } = buildIssuesAndActions({
    campaignRangeRows: campaignRC,
    targetingRangeRows: targetingRC,
    searchtermRangeRows: searchtermRC,
    placementRangeRows: placementRC,
    productRangeRows: productRC,
    zeroSpendThreshold: threshold,
    maxIssues: DEFAULTS.maxIssuesInOverview,
    maxActions: DEFAULTS.maxActionCards,
  });
  renderIssuesTable(issues);
  renderActions(actions);

  // Drilldown
  const level = document.getElementById("drillLevel").value;
  const onlyZero = document.getElementById("onlyZeroSales").checked;

  let drillRows = [];
  if (level === "targeting") drillRows = targetingRC;
  if (level === "searchterm") drillRows = searchtermRC;
  if (level === "placement") drillRows = placementRC;
  if (level === "product") drillRows = productRC;

  renderDrillTable({ level, rows: drillRows, onlyZeroSales: onlyZero });

  // ✅ Fix: ensure charts are correct size after render
  resizeCharts();

  if (!silent) toast("Applied filters.");
}

/* Downloads (safe, optional) */
function downloadCsv(filename, rows, columns) {
  const header = columns.join(",");
  const lines = rows.map(r => columns.map(c => {
    const v = r[c];
    if (v == null) return "";
    if (v instanceof Date) return fmtDateLocal(v);
    const s = String(v).replaceAll('"','""');
    return `"${s}"`;
  }).join(","));
  const csv = [header, ...lines].join("\n");
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

function downloadOverviewCsv() {
  const start = parseDateInput("dateStart");
  const end = parseDateInput("dateEnd");
  const rows = filterByRange(DATA.totalDaily, start, end).sort((a,b)=>a.date-b.date);
  const cols = ["date","impressions","clicks","cost","orders","sales","ctr","cpc","cvr","acos","roas","cost_spike","sales_spike","roas_spike","acos_spike"];
  downloadCsv("overview_total_daily.csv", rows, cols.filter(c => c in (rows[0]||{})));
}

function downloadDrillCsv() {
  const level = document.getElementById("drillLevel").value;
  const start = parseDateInput("dateStart");
  const end = parseDateInput("dateEnd");

  let rows = [];
  if (level === "targeting") rows = filterByRange(DATA.targetingDaily, start, end);
  if (level === "searchterm") rows = filterByRange(DATA.searchtermDaily, start, end);
  if (level === "placement") rows = filterByRange(DATA.placementDaily, start, end);
  if (level === "product") rows = filterByRange(DATA.productDaily, start, end);

  const colsByLevel = {
    targeting: ["date","campaign_name","target","match_type","targeting_type","cost","sales","orders","clicks","impressions","roas","acos","cpc","cvr","zero_sales_spend_flag"],
    searchterm: ["date","campaign_name","search_term","cost","sales","orders","clicks","impressions","roas","acos","cpc","cvr","zero_sales_spend_flag"],
    placement: ["date","campaign_name","placement","cost","sales","orders","clicks","impressions","roas","acos","cpc","cvr","zero_sales_spend_flag"],
    product: ["date","campaign_name","asin","sku","cost","sales","orders","clicks","impressions","roas","acos","cpc","cvr","zero_sales_spend_flag"],
  };

  downloadCsv(`drill_${level}.csv`, rows, colsByLevel[level].filter(c => c in (rows[0]||{})));
}

init();

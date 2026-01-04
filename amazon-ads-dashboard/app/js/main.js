import { DATA_FILES, DEFAULTS } from "./config.js";
import { loadCsv, normalizeRows } from "./dataLoader.js";
import {
  addKpis, addZeroSalesFlag, filterByRange, groupSum,
  computeSharesForRange
} from "./metrics.js";
import { buildIssuesAndActions } from "./recommendations.js";
import { renderTrendChart, renderShareChart, renderScatter } from "./charts.js";
import {
  wireNav, toast, setTheme, setRangeLabel, fillCampaignSelect, getSelectedCampaignIds,
  setKpis, renderIssuesTable, renderActions, renderHealth, renderDrillTable
} from "./ui.js";

let DATA = null;
let isLight = false;

function setDefaultDates(totalDaily) {
  const rows = [...totalDaily].sort((a,b)=>a.date-b.date);
  const min = rows[0]?.date;
  const max = rows[rows.length-1]?.date;
  const startEl = document.getElementById("dateStart");
  const endEl = document.getElementById("dateEnd");
  startEl.value = min ? min.toISOString().slice(0,10) : "";
  endEl.value = max ? max.toISOString().slice(0,10) : "";
}

function parseDateInput(id) {
  const v = document.getElementById(id).value;
  if (!v) return null;
  const d = dayjs(v);
  return d.isValid() ? d.toDate() : null;
}

function selectedCampaignsOrAll(campaigns, selectEl) {
  const all = document.getElementById("allCampaigns").checked;
  if (all) return campaigns.map(c => c.campaign_id);
  const selected = getSelectedCampaignIds(selectEl);
  return selected.length ? selected : campaigns.map(c => c.campaign_id);
}

function filterByCampaign(rows, ids) {
  const set = new Set(ids);
  return rows.filter(r => set.has(String(r.campaign_id ?? r.campaign_name ?? "")));
}

function sumTotals(rows) {
  return rows.reduce((a,r)=>({
    impressions: a.impressions + (r.impressions||0),
    clicks: a.clicks + (r.clicks||0),
    cost: a.cost + (r.cost||0),
    orders: a.orders + (r.orders||0),
    sales: a.sales + (r.sales||0),
    zeroSalesSpend: a.zeroSalesSpend + ((r.zero_sales_spend_flag===true) ? (r.cost||0) : 0),
  }), { impressions:0, clicks:0, cost:0, orders:0, sales:0, zeroSalesSpend:0 });
}

function buildHealthReport(dataObj) {
  const items = [];
  for (const [name, rows] of Object.entries(dataObj)) {
    const ok = rows && rows.length > 0;
    let detail = ok ? `Rows: ${rows.length}` : "Missing or empty";
    if (ok && rows[0]?.date) {
      const dates = rows.map(r=>r.date).filter(Boolean).sort((a,b)=>a-b);
      detail += ` · Range: ${dates[0].toISOString().slice(0,10)} → ${dates[dates.length-1].toISOString().slice(0,10)}`;
    }
    items.push({ name, ok, detail });
  }
  // Also check required columns in campaign_daily
  const reqCols = ["date","campaign_id","impressions","clicks","cost","sales","orders"];
  const c = dataObj.campaignDaily?.[0] || {};
  const missing = reqCols.filter(k => !(k in c));
  items.push({
    name: "campaign_daily columns",
    ok: missing.length === 0,
    detail: missing.length ? `Missing: ${missing.join(", ")}` : "All required columns present",
  });
  return items;
}

async function init() {
  wireNav();

  // Theme toggle
  document.getElementById("themeToggle").addEventListener("click", () => {
    isLight = !isLight;
    setTheme(isLight);
    document.getElementById("themeToggle").textContent = isLight ? "Light" : "Dark";
    // re-render charts after theme change
    if (DATA) applyFiltersAndRender(true);
  });

  // Load data
  try {
    toast("Loading datasets…");
    const [campaign, total, targeting, searchterm, placement, product] = await Promise.all([
      loadCsv(DATA_FILES.campaignDaily),
      loadCsv(DATA_FILES.totalDaily),
      loadCsv(DATA_FILES.targetingDaily),
      loadCsv(DATA_FILES.searchtermDaily),
      loadCsv(DATA_FILES.placementDaily),
      loadCsv(DATA_FILES.productDaily),
    ]);

    const campaignDaily = addZeroSalesFlag(addKpis(normalizeRows(campaign)), DEFAULTS.zeroSalesSpendThreshold);
    const totalDaily = addZeroSalesFlag(addKpis(normalizeRows(total)), DEFAULTS.zeroSalesSpendThreshold);

    const targetingDaily = addZeroSalesFlag(addKpis(normalizeRows(targeting)), DEFAULTS.zeroSalesSpendThreshold);
    const searchtermDaily = addZeroSalesFlag(addKpis(normalizeRows(searchterm)), DEFAULTS.zeroSalesSpendThreshold);
    const placementDaily = addZeroSalesFlag(addKpis(normalizeRows(placement)), DEFAULTS.zeroSalesSpendThreshold);
    const productDaily = addZeroSalesFlag(addKpis(normalizeRows(product)), DEFAULTS.zeroSalesSpendThreshold);

    DATA = { campaignDaily, totalDaily, targetingDaily, searchtermDaily, placementDaily, productDaily };

    // Populate campaign list from campaign_daily
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

    // Campaign selector UX: if "All" is checked, disable select
    const allChk = document.getElementById("allCampaigns");
    function syncAll() {
      selectEl.disabled = allChk.checked;
      if (allChk.checked) {
        for (const o of selectEl.options) o.selected = false;
      }
    }
    allChk.addEventListener("change", syncAll);
    syncAll();

    // Apply button
    document.getElementById("applyBtn").addEventListener("click", () => applyFiltersAndRender(false));

    // Drilldown interactions
    document.getElementById("drillLevel").addEventListener("change", () => applyFiltersAndRender(true));
    document.getElementById("onlyZeroSales").addEventListener("change", () => applyFiltersAndRender(true));

    // Action refresh
    document.getElementById("refreshActions").addEventListener("click", () => applyFiltersAndRender(true));

    // Downloads
    document.getElementById("downloadOverview").addEventListener("click", () => downloadOverviewCsv());
    document.getElementById("downloadDrill").addEventListener("click", () => downloadDrillCsv());

    // Health
    renderHealth(buildHealthReport(DATA));

    toast("Loaded. Apply filters to explore.");
    applyFiltersAndRender(true);
  } catch (err) {
    console.error(err);
    toast(String(err.message || err), "error");
    renderHealth([{ name: "Load error", ok: false, detail: String(err.message || err) }]);
  }
}

function applyFiltersAndRender(silent=false) {
  if (!DATA) return;

  const start = parseDateInput("dateStart");
  const end = parseDateInput("dateEnd");
  const threshold = Number(document.getElementById("zeroSpendThreshold").value || DEFAULTS.zeroSalesSpendThreshold);

  // Re-apply zero-sales threshold without reloading
  const campaignDaily = addZeroSalesFlag([...DATA.campaignDaily], threshold);
  const totalDaily = addZeroSalesFlag([...DATA.totalDaily], threshold);
  const targetingDaily = addZeroSalesFlag([...DATA.targetingDaily], threshold);
  const searchtermDaily = addZeroSalesFlag([...DATA.searchtermDaily], threshold);
  const placementDaily = addZeroSalesFlag([...DATA.placementDaily], threshold);
  const productDaily = addZeroSalesFlag([...DATA.productDaily], threshold);

  // Date range filter
  const campaignR = filterByRange(campaignDaily, start, end);
  const totalR = filterByRange(totalDaily, start, end);
  const targetingR = filterByRange(targetingDaily, start, end);
  const searchtermR = filterByRange(searchtermDaily, start, end);
  const placementR = filterByRange(placementDaily, start, end);
  const productR = filterByRange(productDaily, start, end);

  // Campaign filter (from campaign list)
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

  // KPI totals (from campaign daily range)
  const totals = sumTotals(campaignRC);
  const ctr = totals.impressions ? totals.clicks / totals.impressions : null;
  const cpc = totals.clicks ? totals.cost / totals.clicks : null;
  const cvr = totals.clicks ? totals.orders / totals.clicks : null;
  const acos = totals.sales ? totals.cost / totals.sales : null;
  const roas = totals.cost ? totals.sales / totals.cost : null;

  setKpis({
    spend: totals.cost,
    sales: totals.sales,
    roas,
    acos,
    ctr,
    cpc,
    cvr,
    zeroSalesSpend: totals.zeroSalesSpend
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

  // Drill table
  const level = document.getElementById("drillLevel").value;
  const onlyZero = document.getElementById("onlyZeroSales").checked;

  let drillRows = [];
  if (level === "targeting") drillRows = targetingRC;
  if (level === "searchterm") drillRows = searchtermRC;
  if (level === "placement") drillRows = placementRC;
  if (level === "product") drillRows = productRC;

  renderDrillTable({ level, rows: drillRows, onlyZeroSales: onlyZero });

  if (!silent) toast("Applied filters.");
}

function downloadCsv(filename, rows, columns) {
  const header = columns.join(",");
  const lines = rows.map(r => columns.map(c => {
    const v = r[c];
    if (v == null) return "";
    if (v instanceof Date) return v.toISOString().slice(0,10);
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
  if (!DATA) return;
  const start = parseDateInput("dateStart");
  const end = parseDateInput("dateEnd");
  const totalR = filterByRange(DATA.totalDaily, start, end).sort((a,b)=>a.date-b.date);
  const cols = ["date","impressions","clicks","cost","orders","sales","ctr","cpc","cvr","acos","roas","cost_spike","sales_spike","roas_spike","acos_spike"];
  downloadCsv("overview_total_daily.csv", totalR, cols.filter(c => c in (totalR[0]||{})));
}

function downloadDrillCsv() {
  const level = document.getElementById("drillLevel").value;
  const tbodyRows = document.querySelectorAll("#tableDrill tbody tr");
  if (!tbodyRows.length) return;

  // Rebuild from currently filtered dataset again for consistency
  const start = parseDateInput("dateStart");
  const end = parseDateInput("dateEnd");

  const getRange = (rows) => filterByRange(rows, start, end);
  let rows = [];
  if (level === "targeting") rows = getRange(DATA.targetingDaily);
  if (level === "searchterm") rows = getRange(DATA.searchtermDaily);
  if (level === "placement") rows = getRange(DATA.placementDaily);
  if (level === "product") rows = getRange(DATA.productDaily);

  // same columns as UI
  const colsByLevel = {
    targeting: ["date","campaign_name","target","match_type","targeting_type","cost","sales","orders","clicks","impressions","roas","acos","cpc","cvr","zero_sales_spend_flag"],
    searchterm: ["date","campaign_name","search_term","cost","sales","orders","clicks","impressions","roas","acos","cpc","cvr","zero_sales_spend_flag"],
    placement: ["date","campaign_name","placement","cost","sales","orders","clicks","impressions","roas","acos","cpc","cvr","zero_sales_spend_flag"],
    product: ["date","campaign_name","asin","sku","cost","sales","orders","clicks","impressions","roas","acos","cpc","cvr","zero_sales_spend_flag"],
  };

  const cols = colsByLevel[level];
  downloadCsv(`drill_${level}.csv`, rows, cols.filter(c => c in (rows[0]||{})));
}

init();

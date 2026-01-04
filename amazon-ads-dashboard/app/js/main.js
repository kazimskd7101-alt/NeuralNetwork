import { CONFIG } from "./config.js";
import { fmt, minMaxDate, sum, safeNumber } from "./utils.js";
import { fetchTotalDaily, fetchCampaignDaily } from "./api.js";

// ---------- Navigation ----------
const pages = {
  overview: document.getElementById("page-overview"),
  drilldown: document.getElementById("page-drilldown"),
  recommendations: document.getElementById("page-recommendations"),
};

const titles = {
  overview: ["Overview", "KPIs • shares • zero-sales spend • spike detection"],
  drilldown: ["Drilldown", "Find waste and winners by targeting/search term/placement/product"],
  recommendations: ["Recommendations", "Model-driven actions (waste risk + scale winners)"],
};

function setActivePage(key) {
  Object.keys(pages).forEach((k) => pages[k].classList.toggle("active", k === key));
  document.querySelectorAll(".nav a").forEach((a) => a.classList.toggle("active", a.dataset.page === key));
  const [t, sub] = titles[key] || ["Dashboard", ""];
  document.getElementById("pageTitle").textContent = t;
  document.getElementById("pageSubtitle").textContent = sub;
  window.location.hash = key;
}

function initNav() {
  document.querySelectorAll(".nav a").forEach((a) => {
    a.addEventListener("click", (e) => {
      e.preventDefault();
      setActivePage(a.dataset.page);
    });
  });

  const initialPage = (window.location.hash || "#overview").replace("#", "");
  setActivePage(["overview", "drilldown", "recommendations"].includes(initialPage) ? initialPage : "overview");
}

// ---------- Rendering ----------
function renderKpis({ spend, sales, roas, acos, ctr, cvr }) {
  const grid = document.getElementById("kpiGrid");
  grid.innerHTML = "";

  const kpis = [
    { label: "Spend", value: spend, hint: "Total cost", type: "money" },
    { label: "Sales", value: sales, hint: "Attributed sales", type: "money" },
    { label: "ROAS", value: roas, hint: "Sales / Spend", type: "num" },
    { label: "ACOS", value: acos, hint: "Spend / Sales", type: "pct" },
    { label: "CTR", value: ctr, hint: "Clicks / Impressions", type: "pct" },
    { label: "CVR", value: cvr, hint: "Orders / Clicks", type: "pct" },
  ];

  for (const k of kpis) {
    const el = document.createElement("div");
    el.className = "card";

    const val =
      k.type === "money" ? fmt.money(k.value, CONFIG.CURRENCY) :
      k.type === "pct" ? fmt.pct(k.value) :
      fmt.num(k.value);

    el.innerHTML = `
      <div class="label">${k.label}</div>
      <div class="value mono">${val}</div>
      <div class="hint">${k.hint}</div>
    `;
    grid.appendChild(el);
  }
}

function renderBadges({ zeroSalesSpendCount, costSpikes, salesSpikes }) {
  const wrap = document.getElementById("overviewBadges");
  wrap.innerHTML = "";

  const badges = [];
  if (zeroSalesSpendCount > 0) badges.push({ kind: "warn", text: `${zeroSalesSpendCount} items: spend with zero sales` });
  if (costSpikes > 0) badges.push({ kind: "warn", text: `${costSpikes} cost spikes detected` });
  if (salesSpikes > 0) badges.push({ kind: "good", text: `${salesSpikes} sales spikes detected` });
  if (badges.length === 0) badges.push({ kind: "good", text: "No major alerts detected" });

  for (const b of badges) {
    const el = document.createElement("div");
    el.className = `badge ${b.kind}`;
    el.innerHTML = `<img src="assets/icons/bolt.svg" alt="" aria-hidden="true" /> ${b.text}`;
    wrap.appendChild(el);
  }
}

function renderAlerts({ zeroSalesSpendCount, costSpikes, salesSpikes }) {
  const body = document.getElementById("alertTableBody");
  body.innerHTML = "";

  const rows = [
    { type: "Zero-sales spend", what: "Spend happened but no sales", count: zeroSalesSpendCount },
    { type: "Spend spike", what: "Cost jumped vs last 7 days", count: costSpikes },
    { type: "Sales spike", what: "Sales jumped vs last 7 days", count: salesSpikes },
  ];

  for (const a of rows) {
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>${a.type}</td>
      <td style="color: var(--muted);">${a.what}</td>
      <td class="right mono">${fmt.num(a.count)}</td>
    `;
    body.appendChild(tr);
  }
}

// ---------- Data -> UI ----------
function computeOverview(totalDailyRows, campaignDailyRows) {
  // totalDaily rows already aggregated per day (from backend)
  const spend = sum(totalDailyRows, "cost");
  const sales = sum(totalDailyRows, "sales");
  const clicks = sum(totalDailyRows, "clicks");
  const impressions = sum(totalDailyRows, "impressions");
  const orders = sum(totalDailyRows, "orders");

  const roas = spend === 0 ? null : (sales / spend);
  const acos = sales === 0 ? null : (spend / sales);
  const ctr = impressions === 0 ? null : (clicks / impressions);
  const cvr = clicks === 0 ? null : (orders / clicks);

  // Alerts:
  // zero-sales spend flag exists in campaign_daily export (boolean)
  const zeroSalesSpendCount = campaignDailyRows.reduce((acc, r) => acc + (r.zero_sales_spend_flag ? 1 : 0), 0);

  // spikes exist on campaign_daily export: cost_spike / sales_spike
  const costSpikes = campaignDailyRows.reduce((acc, r) => acc + (r.cost_spike ? 1 : 0), 0);
  const salesSpikes = campaignDailyRows.reduce((acc, r) => acc + (r.sales_spike ? 1 : 0), 0);

  return {
    kpis: { spend, sales, roas, acos, ctr, cvr },
    alerts: { zeroSalesSpendCount, costSpikes, salesSpikes },
  };
}

async function loadAndRender() {
  // status UI
  const statusEl = document.getElementById("dataStatus");
  const rangeEl = document.getElementById("dateRange");

  try {
    statusEl.textContent = "Loading...";
    rangeEl.textContent = "—";

    const [totalDaily, campaignDaily] = await Promise.all([
      fetchTotalDaily(),
      fetchCampaignDaily(),
    ]);

    const range = minMaxDate(totalDaily, "date");
    rangeEl.textContent = (range.min && range.max) ? `${range.min} → ${range.max}` : "—";
    statusEl.textContent = "API";

    const { kpis, alerts } = computeOverview(totalDaily, campaignDaily);
    renderKpis(kpis);
    renderBadges(alerts);
    renderAlerts(alerts);

    // Trend chart placeholder stays for now (we'll add ECharts next)
    const chart = document.getElementById("trendChart");
    chart.textContent = "Chart connected next (ECharts)";

  } catch (err) {
    statusEl.textContent = "Error";
    rangeEl.textContent = "—";
    console.error(err);

    // basic fallback UI
    document.getElementById("kpiGrid").innerHTML = `
      <div class="card">
        <div class="label">Backend not running</div>
        <div class="value mono">—</div>
        <div class="hint">Start FastAPI server to load real data.</div>
      </div>
    `;
    document.getElementById("overviewBadges").innerHTML = "";
    document.getElementById("alertTableBody").innerHTML = `
      <tr>
        <td>API error</td>
        <td style="color: var(--muted);">Check server and CORS settings</td>
        <td class="right mono">—</td>
      </tr>
    `;
    const chart = document.getElementById("trendChart");
    chart.textContent = "Waiting for backend...";
  }
}

// ---------- Boot ----------
function init() {
  initNav();
  document.getElementById("btnRefresh").addEventListener("click", loadAndRender);
  loadAndRender();
}

document.addEventListener("DOMContentLoaded", init);

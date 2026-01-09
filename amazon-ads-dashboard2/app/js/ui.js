import { formatMoney, formatNum, formatPct, fmtDateLocal } from "./metrics.js";

/* -----------------------------
   Small safe DOM helpers
-------------------------------- */
function $(id) {
  return document.getElementById(id);
}
function setText(id, text) {
  const el = $(id);
  if (!el) return false;
  el.textContent = text;
  return true;
}

/* -----------------------------
   Business formatting helpers
-------------------------------- */
function fmtMoney(x) {
  if (x == null || !Number.isFinite(x)) return "—";
  return Number(x).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function fmtPct01(x) {
  if (x == null || !Number.isFinite(x)) return "—";
  return (Number(x) * 100).toFixed(2) + "%";
}

/**
 * ✅ Retail Snapshot renderer
 * Expects:
 *  retail = { sales, sessions, units, orders OR orderItems, unitSessionPct }
 *  tacos = number (0..1) or null
 *  adSalesShare = number (0..1) or null
 *  businessRows = [{ asin, sku, sales, sessions, units, orderItems }, ...]
 */
export function renderRetailSnapshot(retail, tacos, adSalesShare, businessRows) {
  if (!retail || typeof retail !== "object") return;

  // If section doesn't exist in HTML, do nothing (no crash)
  const hasRetailSection =
    $( "kpiRetailSales") || $( "retailTableBody") ||
    $( "kpiRetailOrders") || $( "kpiRetailUnits") || $( "kpiRetailSessions");
  if (!hasRetailSection) return;

  const ordersVal = Number(retail.orders ?? retail.orderItems ?? 0);

  setText("kpiRetailSales", fmtMoney(Number(retail.sales || 0)));
  setText("kpiRetailOrders", ordersVal.toLocaleString());
  setText("kpiRetailUnits", Number(retail.units || 0).toLocaleString());
  setText("kpiRetailSessions", Number(retail.sessions || 0).toLocaleString());
  setText("kpiUnitSessionPct", fmtPct01(retail.unitSessionPct));
  setText("kpiTacos", fmtPct01(tacos));
  setText("kpiAdSalesShare", fmtPct01(adSalesShare));

  // Table: top ASINs by retail sales
  const tbody = $("retailTableBody");
  if (!tbody) return;

  const rows = Array.isArray(businessRows) ? businessRows : [];
  const totalSessions = Number(retail.sessions || 0);

  const top = [...rows]
    .sort((a, b) => (Number(b.sales || 0) - Number(a.sales || 0)))
    .slice(0, 15);

  tbody.innerHTML = "";

  for (const r of top) {
    const rSessions = Number(r.sessions || 0);
    const rUnits = Number(r.units || 0);
    const rSales = Number(r.sales || 0);

    const sessionShare = totalSessions > 0 ? (rSessions / totalSessions) : null;
    const unitSession = rSessions > 0 ? (rUnits / rSessions) : null;

    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>${escapeHtml(r.asin || "—")}</td>
      <td>${escapeHtml(r.sku || "—")}</td>
      <td>${fmtMoney(rSales)}</td>
      <td>${rSessions.toLocaleString()}</td>
      <td>${fmtPct01(sessionShare)}</td>
      <td>${rUnits.toLocaleString()}</td>
      <td>${fmtPct01(unitSession)}</td>
    `;
    tbody.appendChild(tr);
  }
}

/* -----------------------------
   Theme + UI basics
-------------------------------- */
export function setTheme(isLight) {
  if (isLight) document.documentElement.setAttribute("data-theme","light");
  else document.documentElement.removeAttribute("data-theme");
}

export function toast(msg) {
  const el = $("toast");
  if (!el) return;
  el.classList.remove("hidden");
  el.textContent = msg;
  setTimeout(() => el.classList.add("hidden"), 2800);
}

export function setRangeLabel(start, end, campaignsCount) {
  const el = $("rangeLabel");
  if (!el) return;
  const s = start ? fmtDateLocal(start) : "—";
  const e = end ? fmtDateLocal(end) : "—";
  el.textContent = `Range: ${s} → ${e} · Campaigns: ${campaignsCount}`;
}

export function fillCampaignSelect(selectEl, campaigns) {
  selectEl.innerHTML = "";
  for (const c of campaigns) {
    const opt = document.createElement("option");
    opt.value = c.campaign_id;
    opt.textContent = c.campaign_name || c.campaign_id;
    selectEl.appendChild(opt);
  }
}

export function getSelectedCampaignIds(selectEl) {
  return Array.from(selectEl.selectedOptions).map(o => o.value);
}

/**
 * ✅ Upgraded setKpis
 * Works with your existing KPI cards, AND supports retail metrics if HTML IDs exist.
 */
export function setKpis({
  // Ads KPIs (existing)
  spend, sales, roas, acos, ctr, cpc, cvr, zeroSalesSpend,

  // Business KPIs (new, optional)
  retailSales = null,
  retailOrderItems = null,
  retailUnits = null,
  retailSessions = null,
  unitSessionPct = null,
  tacos = null,
  adSalesShare = null,
  organicSales = null,
  cpa = null,

  // Optional: full business rows for top-ASIN table
  businessRows = null
}) {
  setText("kpiSpend", formatMoney(spend));
  setText("kpiSales", formatMoney(sales));
  setText("kpiRoas", formatNum(roas));
  setText("kpiAcos", formatPct(acos));
  setText("kpiCtr",  formatPct(ctr));
  setText("kpiCpc",  formatMoney(cpc));
  setText("kpiCvr",  formatPct(cvr));
  setText("kpiZeroSpend", formatMoney(zeroSalesSpend));

  setText("kpiSpendSub", "Total spend in selected range");
  setText("kpiSalesSub", "Attributed sales in selected range");
  setText("kpiRoasSub", "Sales / Spend");
  setText("kpiAcosSub", "Spend / Sales");
  setText("kpiCtrSub", "Clicks / Impressions");
  setText("kpiCpcSub", "Spend / Clicks");
  setText("kpiCvrSub", "Orders / Clicks");
  setText("kpiZeroSpendSub", "Spend where sales = 0");

  // ✅ Render Retail Snapshot if section exists
  const hasRetail = $("kpiRetailSales") || $("retailTableBody");
  if (hasRetail) {
    const retail = {
      sales: Number(retailSales || 0),
      sessions: Number(retailSessions || 0),
      units: Number(retailUnits || 0),
      orders: Number(retailOrderItems || 0),
      unitSessionPct: unitSessionPct
    };
    renderRetailSnapshot(retail, tacos, adSalesShare, businessRows || []);
  }

  // ✅ Optional extra retail KPIs if you add cards for these IDs:
  // (safe: won’t crash if not present)
  setText("kpiOrganicSales", organicSales == null ? "—" : formatMoney(organicSales));
  setText("kpiCpa", cpa == null ? "—" : formatMoney(cpa));
  setText("kpiTacosCard", tacos == null ? "—" : fmtPct01(tacos));
  setText("kpiAdSalesShareCard", adSalesShare == null ? "—" : fmtPct01(adSalesShare));
}

/* -----------------------------
   Navigation
-------------------------------- */
export function wireNav() {
  const items = document.querySelectorAll(".nav-item");
  const pages = {
    overview: document.getElementById("page-overview"),
    drilldowns: document.getElementById("page-drilldowns"),
    actions: document.getElementById("page-actions"),
    health: document.getElementById("page-health"),
  };

  items.forEach(btn => {
    btn.addEventListener("click", () => {
      items.forEach(b => b.classList.remove("active"));
      btn.classList.add("active");
      const route = btn.dataset.route;

      Object.values(pages).forEach(p => p.classList.remove("active"));
      pages[route].classList.add("active");

      // ✅ Fix: tell main.js to resize charts after route change
      window.dispatchEvent(new Event("ppc:routechange"));
      window.scrollTo({ top: 0, behavior: "smooth" });
    });
  });
}

/* -----------------------------
   Tables + panels
-------------------------------- */
export function renderIssuesTable(issues) {
  const tbody = document.querySelector("#tableIssues tbody");
  if (!tbody) return;
  tbody.innerHTML = "";

  for (const it of issues) {
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td><span class="badge ${it.type==="Waste"?"bad":"warn"}">${escapeHtml(it.type)}</span></td>
      <td>${escapeHtml(it.entity)}</td>
      <td><span class="code">${escapeHtml(it.impact)}</span></td>
      <td class="muted">${escapeHtml(it.why)}</td>
      <td>${escapeHtml(it.next)}</td>
    `;
    tbody.appendChild(tr);
  }
}

export function renderActions(actions) {
  const grid = $("actionsGrid");
  if (!grid) return;
  grid.innerHTML = "";

  for (const a of actions) {
    const pr = a.priority || "warn";
    const el = document.createElement("div");
    el.className = "action-card";
    el.innerHTML = `
      <div class="action-top">
        <div>
          <div class="badge ${pr}">${escapeHtml(a.badge)}</div>
          <div class="action-title">${escapeHtml(a.title)}</div>
          <div class="action-meta">${escapeHtml(a.meta)}</div>
        </div>
      </div>
      <div class="action-why">${escapeHtml(a.why)}</div>
      <div class="action-next"><b>Next:</b> ${escapeHtml(a.next)}</div>
    `;
    grid.appendChild(el);
  }
}

export function renderHealth(health) {
  const el = $("healthPanel");
  if (!el) return;
  el.innerHTML = "";

  for (const h of health) {
    const div = document.createElement("div");
    div.className = "health-item";
    div.innerHTML = `
      <div style="display:flex;justify-content:space-between;gap:10px;align-items:flex-start">
        <div>
          <div style="font-weight:900">${escapeHtml(h.name)}</div>
          <div class="muted" style="margin-top:4px">${escapeHtml(h.detail)}</div>
        </div>
        <div class="badge ${h.ok ? "good" : "bad"}">${h.ok ? "OK" : "Fix"}</div>
      </div>
    `;
    el.appendChild(div);
  }
}

export function renderDrillTable({ level, rows, onlyZeroSales }) {
  const headerRow = $("drillHeaderRow");
  const tbody = document.querySelector("#tableDrill tbody");
  if (!headerRow || !tbody) return;

  headerRow.innerHTML = "";
  tbody.innerHTML = "";

  const colsByLevel = {
    targeting: ["target","match_type","targeting_type","cost","sales","orders","clicks","impressions","roas","acos","cpc","cvr"],
    searchterm: ["search_term","cost","sales","orders","clicks","impressions","roas","acos","cpc","cvr"],
    placement: ["placement","cost","sales","orders","clicks","impressions","roas","acos","cpc","cvr"],
    product: ["asin","sku","cost","sales","orders","clicks","impressions","roas","acos","cpc","cvr"],
  };
  const cols = colsByLevel[level] || [];

  for (const c of cols) {
    const th = document.createElement("th");
    th.textContent = c;
    headerRow.appendChild(th);
  }

  const filtered = onlyZeroSales ? rows.filter(r => r.zero_sales_spend_flag === true) : rows;
  const sorted = [...filtered].sort((a, b) => (Number(b.cost || 0) - Number(a.cost || 0))).slice(0, 250);

  for (const r of sorted) {
    const tr = document.createElement("tr");
    tr.innerHTML = cols.map(c => `<td>${cell(c, r[c])}</td>`).join("");
    tbody.appendChild(tr);
  }
}

function cell(col, val) {
  if (col === "acos") return formatPct(val);
  if (col === "roas") return formatNum(val);
  if (col === "cvr") return formatPct(val);
  if (col === "ctr") return formatPct(val);
  if (col === "cpc" || col === "cost" || col === "sales") return formatMoney(val);
  if (typeof val === "number") return formatNum(val);
  return escapeHtml(String(val ?? ""));
}

function escapeHtml(s) {
  return String(s)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

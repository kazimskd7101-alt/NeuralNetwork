import { formatMoney, formatNum, formatPct, fmtDateLocal } from "./metrics.js";

export function setTheme(isLight) {
  if (isLight) document.documentElement.setAttribute("data-theme","light");
  else document.documentElement.removeAttribute("data-theme");
}

export function toast(msg) {
  const el = document.getElementById("toast");
  el.classList.remove("hidden");
  el.textContent = msg;
  setTimeout(() => el.classList.add("hidden"), 2800);
}

export function setRangeLabel(start, end, campaignsCount) {
  const el = document.getElementById("rangeLabel");
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

export function setKpis({
  spend, sales, roas, acos, ctr, cpc, cvr, zeroSalesSpend,
  tacos=null, organicSales=null
}) {
  document.getElementById("kpiSpend").textContent = formatMoney(spend);
  document.getElementById("kpiSales").textContent = formatMoney(sales);
  document.getElementById("kpiRoas").textContent = formatNum(roas);
  document.getElementById("kpiAcos").textContent = formatPct(acos);
  document.getElementById("kpiCtr").textContent  = formatPct(ctr);
  document.getElementById("kpiCpc").textContent  = formatMoney(cpc);
  document.getElementById("kpiCvr").textContent  = formatPct(cvr);
  document.getElementById("kpiZeroSpend").textContent = formatMoney(zeroSalesSpend);

  document.getElementById("kpiSpendSub").textContent = "Total spend in selected range";
  document.getElementById("kpiSalesSub").textContent = "Attributed sales in selected range";
  document.getElementById("kpiRoasSub").textContent = "Sales / Spend";
  document.getElementById("kpiAcosSub").textContent = "Spend / Sales";
  document.getElementById("kpiCtrSub").textContent = "Clicks / Impressions";
  document.getElementById("kpiCpcSub").textContent = "Spend / Clicks";
  document.getElementById("kpiCvrSub").textContent = "Orders / Clicks";
  document.getElementById("kpiZeroSpendSub").textContent = "Spend where sales = 0";

  // Optional business KPIs (if you later add UI placeholders)
  if (tacos != null || organicSales != null) {
    // No UI slots in your current index.html for these.
    // If you add cards later, we can wire them here.
  }
}

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

export function renderIssuesTable(issues) {
  const tbody = document.querySelector("#tableIssues tbody");
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
  const grid = document.getElementById("actionsGrid");
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
  const el = document.getElementById("healthPanel");
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
  const headerRow = document.getElementById("drillHeaderRow");
  const tbody = document.querySelector("#tableDrill tbody");
  headerRow.innerHTML = "";
  tbody.innerHTML = "";

  const colsByLevel = {
    targeting: ["target","match_type","targeting_type","cost","sales","orders","clicks","impressions","roas","acos","cpc","cvr"],
    searchterm: ["search_term","cost","sales","orders","clicks","impressions","roas","acos","cpc","cvr"],
    placement: ["placement","cost","sales","orders","clicks","impressions","roas","acos","cpc","cvr"],
    product: ["asin","sku","cost","sales","orders","clicks","impressions","roas","acos","cpc","cvr"],
  };
  const cols = colsByLevel[level];

  for (const c of cols) {
    const th = document.createElement("th");
    th.textContent = c;
    headerRow.appendChild(th);
  }

  const filtered = onlyZeroSales ? rows.filter(r => r.zero_sales_spend_flag === true) : rows;
  const sorted = [...filtered].sort((a,b)=> (b.cost||0)-(a.cost||0)).slice(0, 250);

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

function escapeHtml(s){
  return String(s)
    .replaceAll("&","&amp;")
    .replaceAll("<","&lt;")
    .replaceAll(">","&gt;")
    .replaceAll('"',"&quot;")
    .replaceAll("'","&#039;");
}

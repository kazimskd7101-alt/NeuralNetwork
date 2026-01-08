export function safeDiv(n, d) {
  if (!d) return null;
  return n / d;
}

// Local date formatter (fixes timezone off-by-one)
export function fmtDateLocal(d) {
  if (!(d instanceof Date)) return "";
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export function addKpisRow(r) {
  const impressions = r.impressions ?? 0;
  const clicks = r.clicks ?? 0;
  const cost = r.cost ?? 0;
  const orders = r.orders ?? 0;
  const sales = r.sales ?? 0;

  if (r.ctr == null) r.ctr = impressions ? clicks / impressions : null;
  if (r.cpc == null) r.cpc = clicks ? cost / clicks : null;
  if (r.cvr == null) r.cvr = clicks ? orders / clicks : null;
  if (r.acos == null) r.acos = sales ? cost / sales : null;
  if (r.roas == null) r.roas = cost ? sales / cost : null;

  return r;
}

export function addKpis(rows) {
  return rows.map((r) => addKpisRow({ ...r }));
}

export function addZeroSalesFlag(rows, threshold) {
  const th = Number(threshold ?? 1.0);
  return rows.map((r) => ({
    ...r,
    zero_sales_spend_flag: (Number(r.cost ?? 0) >= th) && (Number(r.sales ?? 0) <= 0),
  }));
}

export function filterByRange(rows, startDate, endDate) {
  const start = startDate ? startDate.getTime() : null;
  const end = endDate ? endDate.getTime() : null;
  return rows.filter((r) => {
    const t = r.date.getTime();
    if (start !== null && t < start) return false;
    if (end !== null && t > end) return false;
    return true;
  });
}

export function groupSum(rows, keys) {
  const map = new Map();
  for (const r of rows) {
    const k = keys.map((kk) => String(r[kk] ?? "")).join("||");
    if (!map.has(k)) {
      const base = {};
      keys.forEach((kk) => (base[kk] = r[kk] ?? ""));
      base.impressions = 0; base.clicks = 0; base.cost = 0; base.orders = 0; base.sales = 0;
      map.set(k, base);
    }
    const agg = map.get(k);
    agg.impressions += Number(r.impressions ?? 0);
    agg.clicks += Number(r.clicks ?? 0);
    agg.cost += Number(r.cost ?? 0);
    agg.orders += Number(r.orders ?? 0);
    agg.sales += Number(r.sales ?? 0);
  }
  return Array.from(map.values());
}

export function computeSharesForRange(campaignRows) {
  const grouped = groupSum(campaignRows, ["campaign_id","campaign_name"]);
  const totalCost = grouped.reduce((a, r) => a + (r.cost || 0), 0);
  const totalSales = grouped.reduce((a, r) => a + (r.sales || 0), 0);

  return grouped.map((r) => {
    const spendShare = totalCost ? r.cost / totalCost : null;
    const salesShare = totalSales ? r.sales / totalSales : null;
    return {
      ...addKpisRow(r),
      spend_share: spendShare,
      sales_share: salesShare,
      share_gap: (spendShare == null || salesShare == null) ? null : (spendShare - salesShare),
    };
  });
}

export function sumTotals(rows) {
  return rows.reduce((a, r) => ({
    impressions: a.impressions + (r.impressions || 0),
    clicks: a.clicks + (r.clicks || 0),
    cost: a.cost + (r.cost || 0),
    orders: a.orders + (r.orders || 0),
    sales: a.sales + (r.sales || 0),
    zeroSalesSpend: a.zeroSalesSpend + ((r.zero_sales_spend_flag === true) ? (r.cost || 0) : 0),
  }), { impressions:0, clicks:0, cost:0, orders:0, sales:0, zeroSalesSpend:0 });
}

/* Formatting */
export function formatPct(x) {
  if (x == null || !Number.isFinite(x)) return "—";
  return (x * 100).toFixed(2) + "%";
}
export function formatMoney(x) {
  if (x == null || !Number.isFinite(x)) return "—";
  return x.toLocaleString(undefined, { maximumFractionDigits: 2 });
}
export function formatNum(x) {
  if (x == null || !Number.isFinite(x)) return "—";
  return x.toLocaleString(undefined, { maximumFractionDigits: 2 });
}

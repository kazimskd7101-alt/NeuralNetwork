import { topN, computeSharesForRange, addKpisRow } from "./metrics.js";

export function buildIssuesAndActions({
  campaignRangeRows,
  targetingRangeRows,
  searchtermRangeRows,
  placementRangeRows,
  productRangeRows,
  zeroSpendThreshold,
  maxIssues = 12,
  maxActions = 18,
}) {
  const th = Number(zeroSpendThreshold);

  // 1) Waste: highest cost with zero sales by level
  function topZeroSales(rows, levelName, entityLabelFn, max=6) {
    const filtered = rows
      .filter(r => (r.cost ?? 0) >= th && ((r.sales ?? 0) <= 0))
      .map(r => addKpisRow({ ...r }));
    filtered.sort((a,b)=> (b.cost||0) - (a.cost||0));
    return filtered.slice(0, max).map(r => ({
      type: "Waste",
      entity: entityLabelFn(r),
      impact: `Spend ${r.cost.toFixed(2)} with 0 sales`,
      why: `${levelName} is spending but not converting.`,
      next: (levelName === "Search term")
        ? "Add as negative keyword (or move to exact if relevant)."
        : (levelName === "Targeting")
          ? "Lower bid or pause; check search terms for leakage."
          : (levelName === "Placement")
            ? "Reduce placement multiplier / bid adjustments."
            : (levelName === "Product")
              ? "Improve listing/conversion (price, images, reviews) or pause ads."
              : "Reduce bid/budget and inspect targets + search terms.",
      route: "drilldowns",
    }));
  }

  const issues = [
    ...topZeroSales(campaignRangeRows, "Campaign", r => r.campaign_name || r.campaign_id, 4),
    ...topZeroSales(searchtermRangeRows, "Search term", r => r.search_term || "(blank)", 4),
    ...topZeroSales(targetingRangeRows, "Targeting", r => r.target || "(blank)", 4),
  ].slice(0, maxIssues);

  // 2) Share Gap (under/over funding)
  const shares = computeSharesForRange(campaignRangeRows);
  const overFunded = [...shares].filter(r => r.share_gap != null && r.share_gap > 0.03).sort((a,b)=>b.share_gap-a.share_gap).slice(0, 4);
  const underFunded = [...shares].filter(r => r.share_gap != null && r.share_gap < -0.03).sort((a,b)=>a.share_gap-b.share_gap).slice(0, 4);

  // 3) Scale winners (high ROAS, meaningful spend)
  const winners = shares
    .filter(r => (r.cost ?? 0) >= 50 && (r.roas ?? 0) >= 3)
    .sort((a,b)=> (b.roas||0) - (a.roas||0))
    .slice(0, 6);

  // 4) Spikes (from daily campaign rows): cost_spike without sales_spike = investigate
  const spikes = [...campaignRangeRows]
    .filter(r => r.cost_spike === true && r.sales_spike !== true)
    .sort((a,b)=> (b.cost||0) - (a.cost||0))
    .slice(0, 6)
    .map(r => ({
      type: "Spike",
      entity: `${r.campaign_name || r.campaign_id} (${r.date.toISOString().slice(0,10)})`,
      impact: `Spend spike ${Number(r.cost||0).toFixed(2)}`,
      why: "Spend jumped without sales jumping. Usually bids/placements/search terms.",
      next: "Check placement + search terms; add negatives; cap bids temporarily.",
      route: "overview",
    }));

  const actionCards = [];

  for (const r of overFunded) {
    actionCards.push({
      badge: "Rebalance",
      title: "Reduce over-funded campaign",
      meta: r.campaign_name || r.campaign_id,
      why: `Spend share is higher than sales share (gap ${(r.share_gap*100).toFixed(1)}%).`,
      next: "Reduce budget/bid slightly and move spend to under-funded winners.",
      priority: "warn",
    });
  }

  for (const r of underFunded) {
    actionCards.push({
      badge: "Rebalance",
      title: "Boost under-funded winner",
      meta: r.campaign_name || r.campaign_id,
      why: `Sales share is higher than spend share (gap ${(-r.share_gap*100).toFixed(1)}%).`,
      next: "Increase budget gradually + protect with exact match & negatives.",
      priority: "good",
    });
  }

  for (const r of winners) {
    actionCards.push({
      badge: "Scale",
      title: "Scale a winner",
      meta: r.campaign_name || r.campaign_id,
      why: `ROAS ${Number(r.roas).toFixed(2)} with spend ${Number(r.cost).toFixed(2)}.`,
      next: "Increase daily budget 10–20% + ensure top search terms are in exact match.",
      priority: "good",
    });
  }

  for (const s of spikes) {
    actionCards.push({
      badge: "Investigate",
      title: "Investigate spend spike",
      meta: s.entity,
      why: s.why,
      next: s.next,
      priority: "warn",
    });
  }

  // Add waste actions (most painful)
  const wasteActions = topZeroSales(campaignRangeRows, "Campaign", r => r.campaign_name || r.campaign_id, 6)
    .map(x => ({
      badge: "Stop waste",
      title: "Stop spend with zero sales",
      meta: x.entity,
      why: x.why,
      next: x.next,
      priority: "bad",
    }));

  const finalActions = [...wasteActions, ...actionCards].slice(0, maxActions);

  return { issues, actions: finalActions };
}

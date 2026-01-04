import { formatMoney, formatPct, formatNum } from "./metrics.js";

function ensureChart(el) {
  const chart = echarts.getInstanceByDom(el) || echarts.init(el);
  return chart;
}

export function renderTrendChart(el, totalDailyRows) {
  const chart = ensureChart(el);

  const rows = [...totalDailyRows].sort((a,b)=>a.date-b.date);
  const x = rows.map(r => r.date.toISOString().slice(0,10));
  const spend = rows.map(r => r.cost || 0);
  const sales = rows.map(r => r.sales || 0);
  const roas = rows.map(r => r.roas ?? null);
  const spikes = rows.map(r => (r.cost_spike === true || r.sales_spike === true) ? 1 : 0);

  const option = {
    backgroundColor: "transparent",
    tooltip: { trigger: "axis" },
    grid: { left: 46, right: 18, top: 28, bottom: 36 },
    legend: { top: 0, textStyle: { color: "rgba(255,255,255,0.78)" } },
    xAxis: { type: "category", data: x, axisLabel: { color: "rgba(255,255,255,0.65)" } },
    yAxis: [
      { type: "value", axisLabel: { color: "rgba(255,255,255,0.65)" } },
      { type: "value", axisLabel: { color: "rgba(255,255,255,0.65)" } },
    ],
    series: [
      { name: "Spend", type: "line", smooth: true, data: spend, yAxisIndex: 0, showSymbol: false },
      { name: "Sales", type: "line", smooth: true, data: sales, yAxisIndex: 0, showSymbol: false },
      { name: "ROAS", type: "line", smooth: true, data: roas, yAxisIndex: 1, showSymbol: false },
      {
        name: "Spike",
        type: "scatter",
        yAxisIndex: 0,
        data: spikes.map((v,i)=> v ? [x[i], Math.max(spend[i], sales[i])] : null).filter(Boolean),
        symbolSize: 12,
      }
    ]
  };

  chart.setOption(option, true);
  window.addEventListener("resize", () => chart.resize());
}

export function renderShareChart(el, shareRows) {
  const chart = ensureChart(el);

  const rows = [...shareRows].sort((a,b)=>(b.cost||0)-(a.cost||0)).slice(0, 12);
  const names = rows.map(r => (r.campaign_name || r.campaign_id).slice(0, 36));
  const spendShare = rows.map(r => (r.spend_share ?? 0) * 100);
  const salesShare = rows.map(r => (r.sales_share ?? 0) * 100);
  const gap = rows.map(r => ((r.share_gap ?? 0) * 100));

  const option = {
    backgroundColor: "transparent",
    tooltip: { trigger: "axis", axisPointer: { type: "shadow" } },
    grid: { left: 140, right: 18, top: 20, bottom: 24 },
    xAxis: { type: "value", axisLabel: { color: "rgba(255,255,255,0.65)", formatter: v => v + "%" } },
    yAxis: { type: "category", data: names, axisLabel: { color: "rgba(255,255,255,0.75)" } },
    series: [
      { name:"Spend share", type:"bar", data: spendShare },
      { name:"Sales share", type:"bar", data: salesShare },
      { name:"Share gap", type:"line", data: gap, smooth:true }
    ],
    legend: { bottom: 0, textStyle: { color: "rgba(255,255,255,0.72)" } }
  };

  chart.setOption(option, true);
  window.addEventListener("resize", () => chart.resize());
}

export function renderScatter(el, shareRows) {
  const chart = ensureChart(el);

  const rows = [...shareRows].filter(r => (r.cost ?? 0) > 0).slice(0, 80);

  const data = rows.map(r => {
    const cpc = r.cpc ?? 0;
    const cvr = r.cvr ?? 0;
    const spend = r.cost ?? 0;
    return [cpc, cvr, spend, r.campaign_name || r.campaign_id, r.roas ?? null, r.acos ?? null];
  });

  const option = {
    backgroundColor: "transparent",
    tooltip: {
      formatter: (p) => {
        const [cpc, cvr, spend, name, roas, acos] = p.data;
        return `
          <div style="font-weight:800;margin-bottom:6px">${name}</div>
          <div>CPC: ${formatNum(cpc)}</div>
          <div>CVR: ${formatPct(cvr)}</div>
          <div>Spend: ${formatMoney(spend)}</div>
          <div>ROAS: ${formatNum(roas)}</div>
          <div>ACOS: ${formatPct(acos)}</div>
        `;
      }
    },
    grid: { left: 46, right: 18, top: 20, bottom: 36 },
    xAxis: { type: "value", name: "CPC", axisLabel: { color: "rgba(255,255,255,0.65)" } },
    yAxis: { type: "value", name: "CVR", axisLabel: { color: "rgba(255,255,255,0.65)", formatter: v => (v*100).toFixed(0)+"%" } },
    series: [{
      type: "scatter",
      symbolSize: (val) => Math.max(8, Math.min(28, Math.sqrt(val[2]) )),
      data
    }]
  };

  chart.setOption(option, true);
  window.addEventListener("resize", () => chart.resize());
}

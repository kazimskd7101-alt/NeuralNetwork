import { fmtDateLocal, formatMoney, formatPct, formatNum } from "./metrics.js";

function ensureChart(el) {
  return echarts.getInstanceByDom(el) || echarts.init(el);
}

function themeText() {
  const isLight = document.documentElement.getAttribute("data-theme") === "light";
  return {
    text: isLight ? "rgba(11,18,32,0.78)" : "rgba(255,255,255,0.78)",
    axis: isLight ? "rgba(11,18,32,0.62)" : "rgba(255,255,255,0.65)",
    gridStroke: isLight ? "rgba(0,0,0,0.08)" : "rgba(255,255,255,0.10)",
  };
}

export function renderTrendChart(el, totalDailyRows) {
  const chart = ensureChart(el);
  const t = themeText();

  const rows = [...totalDailyRows].sort((a,b)=>a.date-b.date);
  const x = rows.map(r => fmtDateLocal(r.date));
  const spend = rows.map(r => r.cost || 0);
  const sales = rows.map(r => r.sales || 0);
  const roas = rows.map(r => (r.roas ?? null));
  const spikes = rows.map(r => (r.cost_spike === true || r.sales_spike === true) ? 1 : 0);

  chart.setOption({
    backgroundColor: "transparent",
    tooltip: { trigger: "axis" },
    grid: { left: 52, right: 18, top: 30, bottom: 34 },
    legend: { top: 0, textStyle: { color: t.text } },
    xAxis: {
      type: "category",
      data: x,
      axisLabel: { color: t.axis },
      axisLine: { lineStyle: { color: t.gridStroke } },
      axisTick: { lineStyle: { color: t.gridStroke } }
    },
    yAxis: [
      {
        type: "value",
        axisLabel: { color: t.axis },
        splitLine: { lineStyle: { color: t.gridStroke } }
      },
      {
        type: "value",
        axisLabel: { color: t.axis },
        splitLine: { show:false }
      },
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
  }, true);

  chart.resize();
}

export function renderShareChart(el, shareRows) {
  const chart = ensureChart(el);
  const t = themeText();

  const rows = [...shareRows].sort((a,b)=>(b.cost||0)-(a.cost||0)).slice(0, 12);
  const names = rows.map(r => (r.campaign_name || r.campaign_id).slice(0, 36));
  const spendShare = rows.map(r => (r.spend_share ?? 0) * 100);
  const salesShare = rows.map(r => (r.sales_share ?? 0) * 100);
  const gap = rows.map(r => ((r.share_gap ?? 0) * 100));

  chart.setOption({
    backgroundColor: "transparent",
    tooltip: { trigger: "axis", axisPointer: { type: "shadow" } },
    grid: { left: 160, right: 18, top: 22, bottom: 30 },
    legend: { bottom: 0, textStyle: { color: t.text } },
    xAxis: {
      type: "value",
      axisLabel: { color: t.axis, formatter: v => v + "%" },
      splitLine: { lineStyle: { color: t.gridStroke } },
      axisLine: { lineStyle: { color: t.gridStroke } },
    },
    yAxis: {
      type: "category",
      data: names,
      axisLabel: { color: t.text },
      axisLine: { lineStyle: { color: t.gridStroke } },
    },
    series: [
      { name:"Spend share", type:"bar", data: spendShare },
      { name:"Sales share", type:"bar", data: salesShare },
      { name:"Share gap", type:"line", data: gap, smooth:true }
    ]
  }, true);

  chart.resize();
}

export function renderScatter(el, shareRows) {
  const chart = ensureChart(el);
  const t = themeText();

  const rows = [...shareRows].filter(r => (r.cost ?? 0) > 0).slice(0, 90);
  const data = rows.map(r => {
    const cpc = r.cpc ?? 0;
    const cvr = r.cvr ?? 0;
    const spend = r.cost ?? 0;
    return [cpc, cvr, spend, r.campaign_name || r.campaign_id, r.roas ?? null, r.acos ?? null];
  });

  chart.setOption({
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
    grid: { left: 56, right: 18, top: 22, bottom: 34 },
    xAxis: {
      type: "value",
      name: "CPC",
      nameTextStyle: { color: t.text },
      axisLabel: { color: t.axis },
      splitLine: { lineStyle: { color: t.gridStroke } },
      axisLine: { lineStyle: { color: t.gridStroke } },
    },
    yAxis: {
      type: "value",
      name: "CVR",
      nameTextStyle: { color: t.text },
      axisLabel: { color: t.axis, formatter: v => (v*100).toFixed(0)+"%" },
      splitLine: { lineStyle: { color: t.gridStroke } },
      axisLine: { lineStyle: { color: t.gridStroke } },
    },
    series: [{
      type: "scatter",
      symbolSize: (val) => Math.max(8, Math.min(28, Math.sqrt(val[2]))),
      data
    }]
  }, true);

  chart.resize();
}

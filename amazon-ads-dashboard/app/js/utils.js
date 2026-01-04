export const fmt = {
  num: (v) => {
    const n = Number(v);
    if (!Number.isFinite(n)) return "—";
    return n.toLocaleString(undefined, { maximumFractionDigits: 2 });
  },
  money: (v, currency = "INR") => {
    const n = Number(v);
    if (!Number.isFinite(n)) return "—";
    return n.toLocaleString(undefined, {
      style: "currency",
      currency,
      maximumFractionDigits: 2,
    });
  },
  pct: (v) => {
    const n = Number(v);
    if (!Number.isFinite(n)) return "—";
    return (n * 100).toFixed(2) + "%";
  },
};

export function safeNumber(x, fallback = 0) {
  const n = Number(x);
  return Number.isFinite(n) ? n : fallback;
}

export function isoDateOnly(s) {
  // Expecting "YYYY-MM-DD" or ISO string
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString().slice(0, 10);
}

export function minMaxDate(rows, dateKey = "date") {
  if (!Array.isArray(rows) || rows.length === 0) return { min: null, max: null };
  let min = null;
  let max = null;
  for (const r of rows) {
    const d = isoDateOnly(r[dateKey]);
    if (!d) continue;
    if (min === null || d < min) min = d;
    if (max === null || d > max) max = d;
  }
  return { min, max };
}

export function sum(rows, key) {
  let total = 0;
  for (const r of rows) total += safeNumber(r[key], 0);
  return total;
}

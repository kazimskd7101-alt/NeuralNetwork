// app/js/dataLoader.js
// CSV loader + row normalizer + Business Report mapper

export async function loadCsv(path) {
  const res = await fetch(path);
  if (!res.ok) throw new Error(`Failed to load ${path} (${res.status})`);
  const text = await res.text();

  const parsed = Papa.parse(text, {
    header: true,
    skipEmptyLines: true,
  });

  if (parsed.errors?.length) {
    console.warn("PapaParse warnings:", parsed.errors.slice(0, 3));
  }
  return parsed.data || [];
}

function toNum(v) {
  if (v == null) return null;
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  const s = String(v).trim();
  if (!s) return null;
  const n = Number(s.replaceAll(",", ""));
  return Number.isFinite(n) ? n : null;
}

function toDate(v) {
  if (!v) return null;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? null : d;
}

export function normalizeRows(rows) {
  // your processed daily CSVs already have clean column names:
  // date, impressions, clicks, cost, orders, sales, campaign_id, campaign_name, etc.
  return (rows || []).map(r => {
    const out = { ...r };

    // date -> Date
    if (out.date != null) out.date = toDate(out.date);

    // numeric metrics -> number
    for (const k of ["impressions","clicks","cost","orders","sales"]) {
      if (out[k] != null) {
        const n = toNum(out[k]);
        out[k] = n == null ? 0 : n;
      }
    }

    // normalize some strings (optional)
    if (out.match_type != null) out.match_type = String(out.match_type).toLowerCase();
    if (out.targeting_type != null) out.targeting_type = String(out.targeting_type).toLowerCase();

    return out;
  }).filter(r => r.date instanceof Date || r.date == null);
}

/* ---------------- BUSINESS REPORT ---------------- */

function parseMoney(v) {
  if (v == null) return null;
  const s = String(v).trim();
  if (!s) return null;
  // "$41,025.16" -> 41025.16
  const cleaned = s.replaceAll("$", "").replaceAll(",", "");
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : null;
}

function parseIntLoose(v) {
  if (v == null) return null;
  const s = String(v).trim();
  if (!s) return null;
  const cleaned = s.replaceAll(",", "");
  const n = Number(cleaned);
  return Number.isFinite(n) ? Math.trunc(n) : null;
}

function parsePct(v) {
  if (v == null) return null;
  const s = String(v).trim();
  if (!s) return null;
  // "26.89%" -> 0.2689
  const cleaned = s.replaceAll("%", "").replaceAll(",", "");
  const n = Number(cleaned);
  return Number.isFinite(n) ? (n / 100) : null;
}

export async function loadBusinessReport(path) {
  // This file is NOT daily; it’s a “range report” by ASIN/SKU.
  // We still load it and use it for totals + top ASINs table.
  const raw = await loadCsv(path);

  const rows = raw.map(r => {
    const asin = r["(Child) ASIN"] ?? r["Child ASIN"] ?? r["ASIN"] ?? null;
    const sku = r["SKU"] ?? null;

    const sales = parseMoney(r["Ordered Product Sales"] ?? r["Sales"] ?? r["Ordered Product Sales - B2B"]);
    const sessions = parseIntLoose(r["Sessions - Total"] ?? r["Sessions"]);
    const units = parseIntLoose(r["Units Ordered"] ?? r["Units"]);
    const orderItems = parseIntLoose(r["Total Order Items"] ?? r["Orders"]);

    const sessionPct = parsePct(r["Session Percentage - Total"]);
    const unitSessionPct = parsePct(r["Unit Session Percentage"]);

    return {
      asin: asin ? String(asin).trim() : null,
      sku: sku ? String(sku).trim() : null,
      sales: sales ?? 0,
      sessions: sessions ?? 0,
      units: units ?? 0,
      orderItems: orderItems ?? 0,
      sessionPct: sessionPct,         // fraction 0..1
      unitSessionPct: unitSessionPct, // fraction 0..1
    };
  }).filter(r => (r.asin || r.sku) && Number.isFinite(r.sales));

  return rows;
}

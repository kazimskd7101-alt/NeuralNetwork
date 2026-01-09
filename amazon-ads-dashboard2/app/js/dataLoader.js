// CSV loader + light normalization.
// Uses PapaParse (global Papa) + dayjs (global dayjs).

export function parseDate(val) {
  if (val === null || val === undefined) return null;
  const s = String(val).trim();
  if (!s) return null;

  // Supports "YYYY-MM-DD" or "YYYY-MM-DD HH:mm:ss"
  const d = dayjs(s);
  return d.isValid() ? d.toDate() : null;
}

export function toNum(v) {
  if (v === null || v === undefined) return 0;
  const s = String(v).trim();
  if (s === "") return 0;
  const cleaned = s.replace(/[^0-9.\-]/g, "");
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : 0;
}

export async function loadCsv(url) {
  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) throw new Error(`Failed to fetch ${url}: ${res.status} ${res.statusText}`);
  const text = await res.text();

  return new Promise((resolve, reject) => {
    Papa.parse(text, {
      header: true,
      skipEmptyLines: true,
      dynamicTyping: false,
      complete: (results) => {
        if (results.errors && results.errors.length) {
          reject(new Error(`CSV parse error in ${url}: ${results.errors[0].message}`));
          return;
        }
        resolve(results.data);
      },
      error: (err) => reject(err),
    });
  });
}

export function normalizeRows(rows) {
  return rows
    .map((r) => {
      const out = { ...r };

      if ("date" in out) out.date = parseDate(out.date);

      // common numeric fields
      [
        "impressions","clicks","cost","orders","sales",
        "ctr","cpc","cvr","acos","roas",
        "spend_share","sales_share","share_gap",
        "total_sales","ad_sales","ad_spend","tacos","organic_sales"
      ].forEach((k) => {
        if (k in out) out[k] = toNum(out[k]);
      });

      // spikes can be "True"/"False"/1/0
      Object.keys(out).forEach((k) => {
        if (k.endsWith("_spike")) {
          const v = out[k];
          out[k] = (v === true || v === "True" || v === "true" || v === 1 || v === "1");
        }
      });

      return out;
    })
    .filter((r) => r.date instanceof Date && !Number.isNaN(r.date.getTime()));
}
import { DATA_FILES } from "./config.js";

/* Robust CSV parser (handles commas inside quotes) */
function parseCSV(text) {
  text = text.replace(/^\uFEFF/, ""); // remove BOM if present
  const rows = [];
  let row = [];
  let field = "";
  let inQuotes = false;

  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    const next = text[i + 1];

    if (c === '"' && inQuotes && next === '"') { field += '"'; i++; continue; }
    if (c === '"') { inQuotes = !inQuotes; continue; }

    if (c === "," && !inQuotes) { row.push(field); field = ""; continue; }
    if ((c === "\n" || c === "\r") && !inQuotes) {
      if (c === "\r" && next === "\n") i++;
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
      continue;
    }
    field += c;
  }
  if (field.length || row.length) { row.push(field); rows.push(row); }
  return rows;
}

function csvToObjects(text) {
  const rows = parseCSV(text);
  if (!rows.length) return [];
  const headers = rows[0].map(h => h.trim());
  const out = [];
  for (let i = 1; i < rows.length; i++) {
    const obj = {};
    const r = rows[i];
    for (let j = 0; j < headers.length; j++) obj[headers[j]] = (r[j] ?? "").trim();
    out.push(obj);
  }
  return out;
}

function toInt(v) {
  if (v == null) return 0;
  const s = String(v).replace(/,/g, "").replace(/[^\d.-]/g, "").trim();
  const n = Number(s);
  return Number.isFinite(n) ? Math.round(n) : 0;
}

function toMoney(v) {
  if (v == null) return 0;
  const s = String(v).replace(/,/g, "").replace(/[$]/g, "").trim();
  const n = Number(s);
  return Number.isFinite(n) ? n : 0;
}

function toPct(v) {
  if (v == null) return null;
  const s = String(v).replace("%", "").trim();
  const n = Number(s);
  return Number.isFinite(n) ? (n / 100) : null; // return 0..1
}

export async function loadBusinessReport() {
  const res = await fetch(DATA_FILES.businessReport);
  if (!res.ok) throw new Error(`Failed to load ${DATA_FILES.businessReport} (${res.status})`);
  const text = await res.text();
  const raw = csvToObjects(text);

  // Standardize rows
  return raw.map(r => ({
    asin: (r["(Child) ASIN"] || "").trim(),
    sku: (r["SKU"] || "").trim(),
    title: (r["Title"] || "").trim(),
    sessions: toInt(r["Sessions - Total"]),
    units: toInt(r["Units Ordered"]),
    orderItems: toInt(r["Total Order Items"]),
    sales: toMoney(r["Ordered Product Sales"]),
    unitSessionPct_raw: toPct(r["Unit Session Percentage"]) // optional
  })).filter(x => x.asin || x.sku || x.title);
}

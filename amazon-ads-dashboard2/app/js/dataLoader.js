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

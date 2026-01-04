// Loads CSV files from app/data/ using PapaParse (global Papa)

export function parseDate(val) {
  // Handles "2020-02-01" or "2020-02-01 00:00:00"
  const d = dayjs(String(val));
  return d.isValid() ? d.toDate() : null;
}

export function toNum(v) {
  if (v === null || v === undefined) return 0;
  const s = String(v).trim();
  if (s === "") return 0;
  // remove currency symbols and commas if present
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
  // Normalize common columns
  return rows.map(r => {
    const out = { ...r };
    if ("date" in out) out.date = parseDate(out.date);
    // numeric columns we care about
    ["impressions","clicks","cost","orders","sales","ctr","cpc","cvr","acos","roas"].forEach(k => {
      if (k in out) out[k] = toNum(out[k]);
    });
    // spikes may be "True"/"False" strings; normalize
    Object.keys(out).forEach(k => {
      if (k.endsWith("_spike")) {
        const v = out[k];
        out[k] = (v === true || v === "True" || v === "true" || v === 1 || v === "1");
      }
    });
    return out;
  }).filter(r => r.date); // keep rows with valid date
}

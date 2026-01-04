import { CONFIG } from "./config.js";

async function requestJson(path) {
  const url = `${CONFIG.API_BASE_URL}${path}`;
  const res = await fetch(url, { method: "GET" });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`API ${res.status} ${res.statusText} for ${url}. ${text}`);
  }
  return await res.json();
}

export async function fetchTotalDaily() {
  return await requestJson(CONFIG.ENDPOINTS.totalDaily);
}

export async function fetchCampaignDaily() {
  return await requestJson(CONFIG.ENDPOINTS.campaignDaily);
}

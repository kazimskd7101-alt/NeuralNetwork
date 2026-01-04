export const CONFIG = {
  // Backend base URL (FastAPI). For local dev: http://127.0.0.1:8000
  API_BASE_URL: "http://127.0.0.1:8000",

  // Currency used in your exports (your data shows INR-style Rs/₹)
  CURRENCY: "INR",

  // Threshold used for "spend with zero sales"
  ZERO_SALES_SPEND_THRESHOLD: 1.0,

  // Which processed tables we will load from backend
  ENDPOINTS: {
    totalDaily: "/data/total_daily",
    campaignDaily: "/data/campaign_daily",
  },
};

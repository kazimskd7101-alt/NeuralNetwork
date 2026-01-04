import streamlit as st
import pandas as pd
import numpy as np

from utils.io import load_parquet
from utils.model import predict_with_models
from utils.metrics import format_currency, format_percent, format_number

st.title("Recommendations")
st.caption("Model-driven suggestions (CatBoost) using your latest processed campaign-level features.")

campaign_daily = load_parquet("campaign_daily")
campaign_daily["date"] = pd.to_datetime(campaign_daily["date"])

min_date = campaign_daily["date"].min().date()
max_date = campaign_daily["date"].max().date()

with st.sidebar:
    st.header("Controls")
    selected_date = st.date_input("Score date", value=max_date, min_value=min_date, max_value=max_date)
    currency_symbol = st.selectbox("Currency symbol", ["₹", "$", "€", "£"], index=0)

    waste_prob_cutoff = st.slider("Waste risk probability cutoff", 0.0, 1.0, 0.60, 0.05)
    min_spend = st.number_input("Minimum spend to consider", min_value=0.0, value=50.0, step=10.0)

# Filter to the selected day
day_df = campaign_daily[campaign_daily["date"].dt.date == selected_date].copy()
if day_df.empty:
    st.warning("No campaign rows for this date. Pick another date.")
    st.stop()

# Score with models
scored = predict_with_models(day_df)

# Clean numbers
for c in ["cost", "sales", "orders", "clicks", "impressions", "roas", "acos"]:
    if c in scored.columns:
        scored[c] = pd.to_numeric(scored[c], errors="coerce").fillna(0)

scored["waste_risk_prob"] = pd.to_numeric(scored["waste_risk_prob"], errors="coerce")
scored["pred_future7_roas"] = pd.to_numeric(scored["pred_future7_roas"], errors="coerce")

# Priority buckets
waste = scored[
    (scored["cost"] >= float(min_spend)) &
    (
        (scored.get("zero_sales_spend_flag", False) == True) |
        (scored["waste_risk_prob"] >= float(waste_prob_cutoff))
    )
].copy()

scale = scored[
    (scored["cost"] >= float(min_spend)) &
    (scored["pred_future7_roas"].notna()) &
    (scored["pred_future7_roas"] >= np.nanpercentile(scored["pred_future7_roas"].dropna(), 75))
].copy()

spikes = scored[
    (scored.get("cost_spike", False) == True) |
    (scored.get("acos_spike", False) == True) |
    (scored.get("sales_spike", False) == True)
].copy()

# Headline counts
c1, c2, c3, c4 = st.columns(4)
c1.metric("Campaigns scored", format_number(len(scored)))
c2.metric("Waste candidates", format_number(len(waste)))
c3.metric("Scale candidates", format_number(len(scale)))
c4.metric("Spike alerts", format_number(len(spikes)))

st.divider()

# -----------------------
# Waste prevention
# -----------------------
st.subheader("1) Stop waste (spend without sales)")
if waste.empty:
    st.success("No high-risk waste campaigns found using your current thresholds.")
else:
    waste = waste.sort_values(["waste_risk_prob", "cost"], ascending=[False, False])
    w = waste[[
        "campaign_name", "cost", "sales", "orders", "roas", "acos",
        "waste_risk_prob",
        "zero_sales_spend_flag",
    ]].copy()

    w["cost"] = w["cost"].round(2)
    w["sales"] = w["sales"].round(2)
    w["waste_risk_prob"] = (w["waste_risk_prob"] * 100).round(1)
    w["acos"] = (w["acos"] * 100).round(2)

    st.dataframe(w, use_container_width=True, height=340)

    st.info(
        "Suggested actions:\n"
        "- Add negative keywords for irrelevant traffic (check Search Terms tab)\n"
        "- Lower bids on poor targets (check Targeting tab)\n"
        "- Consider pausing if repeated zero-sales spend\n"
    )

    st.download_button(
        "Download waste recommendations (CSV)",
        data=waste.to_csv(index=False).encode("utf-8"),
        file_name=f"waste_recommendations_{selected_date}.csv",
        mime="text/csv",
    )

st.divider()

# -----------------------
# Scale winners
# -----------------------
st.subheader("2) Scale winners (high predicted ROAS)")
if scale.empty:
    st.info("No strong scale candidates found (try lowering min spend or check if model has enough history).")
else:
    scale = scale.sort_values(["pred_future7_roas", "sales"], ascending=[False, False])
    s = scale[[
        "campaign_name", "cost", "sales", "orders", "roas", "acos",
        "pred_future7_roas",
        "spend_share_total", "sales_share_total",
    ]].copy()

    s["cost"] = s["cost"].round(2)
    s["sales"] = s["sales"].round(2)
    s["acos"] = (s["acos"] * 100).round(2)
    s["pred_future7_roas"] = s["pred_future7_roas"].round(2)
    if "spend_share_total" in s.columns:
        s["spend_share_total"] = (pd.to_numeric(s["spend_share_total"], errors="coerce") * 100).round(2)
    if "sales_share_total" in s.columns:
        s["sales_share_total"] = (pd.to_numeric(s["sales_share_total"], errors="coerce") * 100).round(2)

    st.dataframe(s, use_container_width=True, height=340)

    st.info(
        "Suggested actions:\n"
        "- Increase budgets gradually (watch ACOS/ROAS)\n"
        "- Move strong search terms into exact match (Search Terms tab)\n"
        "- Consider placement boosts if Top of Search is efficient\n"
    )

    st.download_button(
        "Download scale recommendations (CSV)",
        data=scale.to_csv(index=False).encode("utf-8"),
        file_name=f"scale_recommendations_{selected_date}.csv",
        mime="text/csv",
    )

st.divider()

# -----------------------
# Spikes / anomalies
# -----------------------
st.subheader("3) Spike alerts (check changes)")
if spikes.empty:
    st.success("No spike alerts for this date.")
else:
    spikes = spikes.sort_values("cost", ascending=False)
    cols = ["campaign_name", "cost", "sales", "roas", "acos", "cost_spike", "sales_spike", "roas_spike", "acos_spike"]
    cols = [c for c in cols if c in spikes.columns]
    sp = spikes[cols].copy()
    sp["cost"] = sp["cost"].round(2)
    sp["sales"] = sp["sales"].round(2)
    if "acos" in sp.columns:
        sp["acos"] = (pd.to_numeric(sp["acos"], errors="coerce") * 100).round(2)
    st.dataframe(sp, use_container_width=True, height=260)

    st.info(
        "Suggested checks:\n"
        "- Bid changes or budget caps hit?\n"
        "- New keywords/targets added?\n"
        "- Listing price/inventory changes affecting conversion?\n"
    )

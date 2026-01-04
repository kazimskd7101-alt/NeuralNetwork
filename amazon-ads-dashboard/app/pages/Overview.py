import streamlit as st
import pandas as pd
import numpy as np
import plotly.express as px

from utils.io import load_parquet
from utils.metrics import (
    compute_kpis_from_totals,
    format_currency,
    format_percent,
    format_number,
)

st.title("Overview")
st.caption("Sponsored Products (SP) — KPIs, spend/sales share, waste flags, and spike detection.")

# -----------------------
# Load data
# -----------------------
total_daily = load_parquet("total_daily")
campaign_daily = load_parquet("campaign_daily")

# Ensure datetime
total_daily["date"] = pd.to_datetime(total_daily["date"])
campaign_daily["date"] = pd.to_datetime(campaign_daily["date"])

min_date = total_daily["date"].min().date()
max_date = total_daily["date"].max().date()

with st.sidebar:
    st.header("Filters")

    date_range = st.date_input(
        "Date range",
        value=(min_date, max_date),
        min_value=min_date,
        max_value=max_date,
    )
    if isinstance(date_range, tuple) and len(date_range) == 2:
        start_date, end_date = date_range
    else:
        start_date, end_date = min_date, max_date

    currency_symbol = st.selectbox("Currency symbol", ["₹", "$", "€", "£"], index=0)
    zero_sales_threshold = st.number_input(
        "Zero-sales spend threshold",
        min_value=0.0,
        value=1.0,
        step=1.0,
        help="Rows with cost >= threshold AND sales == 0 are flagged.",
    )

# Filter
td = total_daily[(total_daily["date"].dt.date >= start_date) & (total_daily["date"].dt.date <= end_date)].copy()
cd = campaign_daily[(campaign_daily["date"].dt.date >= start_date) & (campaign_daily["date"].dt.date <= end_date)].copy()

if td.empty or cd.empty:
    st.warning("No data found for the selected date range.")
    st.stop()

# -----------------------
# Headline KPIs
# -----------------------
totals = td[["impressions", "clicks", "cost", "orders", "sales"]].sum(numeric_only=True)
kpis = compute_kpis_from_totals(totals)

c1, c2, c3, c4, c5 = st.columns(5)
c1.metric("Sales", format_currency(totals["sales"], currency_symbol))
c2.metric("Spend", format_currency(totals["cost"], currency_symbol))
c3.metric("ROAS", f"{kpis['roas']:.2f}" if np.isfinite(kpis["roas"]) else "—")
c4.metric("ACOS", format_percent(kpis["acos"]) if np.isfinite(kpis["acos"]) else "—")
c5.metric("Orders", format_number(totals["orders"]))

c6, c7, c8, c9, c10 = st.columns(5)
c6.metric("Impressions", format_number(totals["impressions"]))
c7.metric("Clicks", format_number(totals["clicks"]))
c8.metric("CTR", format_percent(kpis["ctr"]) if np.isfinite(kpis["ctr"]) else "—")
c9.metric("CPC", format_currency(kpis["cpc"], currency_symbol) if np.isfinite(kpis["cpc"]) else "—")
c10.metric("CVR", format_percent(kpis["cvr"]) if np.isfinite(kpis["cvr"]) else "—")

st.divider()

# -----------------------
# Spikes (Total)
# -----------------------
st.subheader("Performance over time (Total)")
metric_choice = st.selectbox("Primary metric", ["cost", "sales", "roas", "acos"], index=0)
spike_col = f"{metric_choice}_spike"

plot_df = td.sort_values("date").copy()
plot_df["metric"] = plot_df[metric_choice]
plot_df["spike"] = plot_df[spike_col] if spike_col in plot_df.columns else False

fig = px.line(plot_df, x="date", y="metric", title=f"Total {metric_choice.upper()} over time")
if "spike" in plot_df.columns:
    spikes = plot_df[plot_df["spike"] == True]
    if not spikes.empty:
        fig.add_scatter(
            x=spikes["date"],
            y=spikes["metric"],
            mode="markers",
            name="Spike",
        )
st.plotly_chart(fig, use_container_width=True)

st.divider()

# -----------------------
# Campaign table for selected period (recompute shares correctly for the chosen range)
# -----------------------
st.subheader("Campaigns (selected period)")

camp_agg = (
    cd.groupby(["campaign_id", "campaign_name"], as_index=False)
      .agg(
          impressions=("impressions", "sum"),
          clicks=("clicks", "sum"),
          cost=("cost", "sum"),
          orders=("orders", "sum"),
          sales=("sales", "sum"),
      )
)

# Add KPIs after aggregation (correct)
k = compute_kpis_from_totals(camp_agg[["impressions", "clicks", "cost", "orders", "sales"]])
# compute_kpis_from_totals expects totals dict/series; here we do vectorized:
camp_agg["ctr"] = np.where(camp_agg["impressions"] == 0, np.nan, camp_agg["clicks"] / camp_agg["impressions"])
camp_agg["cpc"] = np.where(camp_agg["clicks"] == 0, np.nan, camp_agg["cost"] / camp_agg["clicks"])
camp_agg["cvr"] = np.where(camp_agg["clicks"] == 0, np.nan, camp_agg["orders"] / camp_agg["clicks"])
camp_agg["acos"] = np.where(camp_agg["sales"] == 0, np.nan, camp_agg["cost"] / camp_agg["sales"])
camp_agg["roas"] = np.where(camp_agg["cost"] == 0, np.nan, camp_agg["sales"] / camp_agg["cost"])

total_cost = camp_agg["cost"].sum()
total_sales = camp_agg["sales"].sum()
camp_agg["spend_share"] = np.nan if total_cost == 0 else camp_agg["cost"] / total_cost
camp_agg["sales_share"] = np.nan if total_sales == 0 else camp_agg["sales"] / total_sales
camp_agg["share_gap"] = camp_agg["spend_share"] - camp_agg["sales_share"]

camp_agg["zero_sales_spend_flag"] = (camp_agg["cost"] >= float(zero_sales_threshold)) & (camp_agg["sales"] <= 0)

# Sort helper
sort_by = st.selectbox(
    "Sort by",
    ["sales", "cost", "roas", "acos", "share_gap", "zero_sales_spend_flag"],
    index=0,
)

ascending = sort_by in ["acos", "share_gap"]
camp_view = camp_agg.sort_values(sort_by, ascending=ascending).copy()

# Display friendly columns
display = camp_view.copy()
display["cost"] = display["cost"].round(2)
display["sales"] = display["sales"].round(2)
display["ctr"] = (display["ctr"] * 100).round(2)
display["cvr"] = (display["cvr"] * 100).round(2)
display["acos"] = (display["acos"] * 100).round(2)
display["spend_share"] = (display["spend_share"] * 100).round(2)
display["sales_share"] = (display["sales_share"] * 100).round(2)
display["share_gap"] = (display["share_gap"] * 100).round(2)

st.dataframe(
    display[[
        "campaign_name",
        "sales", "cost", "orders",
        "roas", "acos",
        "spend_share", "sales_share", "share_gap",
        "zero_sales_spend_flag",
    ]],
    use_container_width=True,
    height=380,
)

# -----------------------
# Share scatter (spend share vs sales share)
# -----------------------
st.subheader("Spend share vs Sales share")
scatter_df = camp_agg.copy()
scatter_df["label"] = scatter_df["campaign_name"].fillna(scatter_df["campaign_id"].astype(str))

fig2 = px.scatter(
    scatter_df,
    x="spend_share",
    y="sales_share",
    size="cost",
    hover_name="label",
    color="roas",
    title="Campaign efficiency map (size = spend, color = ROAS)",
)
fig2.update_xaxes(tickformat=".0%")
fig2.update_yaxes(tickformat=".0%")
st.plotly_chart(fig2, use_container_width=True)

# -----------------------
# Waste list
# -----------------------
st.subheader("Spend with zero sales (selected period)")
waste = camp_agg[camp_agg["zero_sales_spend_flag"]].copy()
waste = waste.sort_values("cost", ascending=False)

if waste.empty:
    st.success("No zero-sales spend campaigns above the selected threshold in this period.")
else:
    waste_disp = waste[["campaign_name", "cost", "clicks", "orders", "sales"]].copy()
    waste_disp["cost"] = waste_disp["cost"].round(2)
    waste_disp["sales"] = waste_disp["sales"].round(2)
    st.dataframe(waste_disp, use_container_width=True, height=260)

    st.download_button(
        "Download waste list (CSV)",
        data=waste.to_csv(index=False).encode("utf-8"),
        file_name="zero_sales_spend_campaigns.csv",
        mime="text/csv",
    )

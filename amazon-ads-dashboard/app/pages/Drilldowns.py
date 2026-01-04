import streamlit as st
import pandas as pd
import numpy as np
import plotly.express as px

from utils.io import load_parquet
from utils.metrics import compute_kpis_from_totals, format_currency, format_percent, format_number

st.title("Drilldowns")
st.caption("Deep dive by Targeting, Search Terms, Placement, and Products (Advertised ASIN).")

# Load
campaign_daily = load_parquet("campaign_daily")
targeting_daily = load_parquet("targeting_daily")
searchterm_daily = load_parquet("searchterm_daily")
placement_daily = load_parquet("placement_daily")
ad_product_daily = load_parquet("ad_product_daily")

for df in [campaign_daily, targeting_daily, searchterm_daily, placement_daily, ad_product_daily]:
    df["date"] = pd.to_datetime(df["date"])

min_date = campaign_daily["date"].min().date()
max_date = campaign_daily["date"].max().date()

with st.sidebar:
    st.header("Filters")
    date_range = st.date_input("Date range", value=(min_date, max_date), min_value=min_date, max_value=max_date)
    if isinstance(date_range, tuple) and len(date_range) == 2:
        start_date, end_date = date_range
    else:
        start_date, end_date = min_date, max_date

    currency_symbol = st.selectbox("Currency symbol", ["₹", "$", "€", "£"], index=0)

# Filter helper
def filter_date(df: pd.DataFrame) -> pd.DataFrame:
    return df[(df["date"].dt.date >= start_date) & (df["date"].dt.date <= end_date)].copy()

cd = filter_date(campaign_daily)
if cd.empty:
    st.warning("No data in selected range.")
    st.stop()

campaigns = cd[["campaign_id", "campaign_name"]].drop_duplicates()
campaign_options = ["(All campaigns)"] + sorted(campaigns["campaign_name"].fillna("").unique().tolist())

selected_campaign_name = st.selectbox("Campaign", campaign_options, index=0)

if selected_campaign_name != "(All campaigns)":
    selected_campaign_ids = campaigns[campaigns["campaign_name"] == selected_campaign_name]["campaign_id"].unique().tolist()
else:
    selected_campaign_ids = campaigns["campaign_id"].unique().tolist()

def filter_campaign(df: pd.DataFrame) -> pd.DataFrame:
    df2 = filter_date(df)
    return df2[df2["campaign_id"].isin(selected_campaign_ids)].copy()

# Tabs
tab1, tab2, tab3, tab4 = st.tabs(["Targeting", "Search Terms", "Placement", "Products (Advertised ASIN)"])

def aggregate_period(df: pd.DataFrame, group_cols: list[str]) -> pd.DataFrame:
    agg = (
        df.groupby(group_cols, as_index=False)
          .agg(
              impressions=("impressions", "sum"),
              clicks=("clicks", "sum"),
              cost=("cost", "sum"),
              orders=("orders", "sum"),
              sales=("sales", "sum"),
          )
    )
    agg["ctr"] = np.where(agg["impressions"] == 0, np.nan, agg["clicks"] / agg["impressions"])
    agg["cpc"] = np.where(agg["clicks"] == 0, np.nan, agg["cost"] / agg["clicks"])
    agg["cvr"] = np.where(agg["clicks"] == 0, np.nan, agg["orders"] / agg["clicks"])
    agg["acos"] = np.where(agg["sales"] == 0, np.nan, agg["cost"] / agg["sales"])
    agg["roas"] = np.where(agg["cost"] == 0, np.nan, agg["sales"] / agg["cost"])
    return agg

def show_entity_timeseries(df: pd.DataFrame, entity_filter: dict, title: str):
    d = df.copy()
    for k, v in entity_filter.items():
        d = d[d[k] == v]
    if d.empty:
        st.info("No rows for the selected entity.")
        return

    daily = (
        d.groupby("date", as_index=False)
         .agg(cost=("cost","sum"), sales=("sales","sum"), clicks=("clicks","sum"), orders=("orders","sum"), impressions=("impressions","sum"))
    )
    daily["roas"] = np.where(daily["cost"] == 0, np.nan, daily["sales"] / daily["cost"])
    daily["acos"] = np.where(daily["sales"] == 0, np.nan, daily["cost"] / daily["sales"])

    metric = st.selectbox(f"{title} chart metric", ["cost", "sales", "roas", "acos"], key=f"{title}_metric")
    fig = px.line(daily.sort_values("date"), x="date", y=metric, title=f"{title} — {metric.upper()} over time")
    st.plotly_chart(fig, use_container_width=True)

with tab1:
    st.subheader("Targeting")
    df = filter_campaign(targeting_daily)

    if df.empty:
        st.info("No targeting rows for this selection.")
    else:
        agg = aggregate_period(df, ["target", "match_type", "targeting_type"])
        agg = agg.sort_values("cost", ascending=False)

        st.write("Top targets (sorted by spend)")
        view = agg.copy()
        view["cost"] = view["cost"].round(2)
        view["sales"] = view["sales"].round(2)
        view["ctr"] = (view["ctr"]*100).round(2)
        view["cvr"] = (view["cvr"]*100).round(2)
        view["acos"] = (view["acos"]*100).round(2)
        st.dataframe(view.head(200), use_container_width=True, height=380)

        # entity selector
        target_pick = st.selectbox("Pick a target to view trend", agg["target"].fillna("").unique().tolist())
        match_pick = st.selectbox("Match type", agg[agg["target"] == target_pick]["match_type"].fillna("").unique().tolist())
        type_pick = st.selectbox("Targeting type", agg[(agg["target"] == target_pick) & (agg["match_type"] == match_pick)]["targeting_type"].fillna("").unique().tolist())

        show_entity_timeseries(df, {"target": target_pick, "match_type": match_pick, "targeting_type": type_pick}, "Targeting")

with tab2:
    st.subheader("Search Terms")
    df = filter_campaign(searchterm_daily)

    if df.empty:
        st.info("No search term rows for this selection.")
    else:
        agg = aggregate_period(df, ["search_term"])
        agg = agg.sort_values("cost", ascending=False)

        st.write("Top search terms (sorted by spend)")
        view = agg.copy()
        view["cost"] = view["cost"].round(2)
        view["sales"] = view["sales"].round(2)
        view["ctr"] = (view["ctr"]*100).round(2)
        view["cvr"] = (view["cvr"]*100).round(2)
        view["acos"] = (view["acos"]*100).round(2)
        st.dataframe(view.head(200), use_container_width=True, height=380)

        term_pick = st.selectbox("Pick a search term to view trend", agg["search_term"].fillna("").unique().tolist())
        show_entity_timeseries(df, {"search_term": term_pick}, "Search Terms")

with tab3:
    st.subheader("Placement")
    df = filter_campaign(placement_daily)

    if df.empty:
        st.info("No placement rows for this selection.")
    else:
        agg = aggregate_period(df, ["placement"]).sort_values("cost", ascending=False)

        st.write("Placement summary")
        view = agg.copy()
        view["cost"] = view["cost"].round(2)
        view["sales"] = view["sales"].round(2)
        view["acos"] = (view["acos"]*100).round(2)
        st.dataframe(view, use_container_width=True, height=260)

        fig = px.bar(agg, x="placement", y="cost", title="Spend by placement")
        st.plotly_chart(fig, use_container_width=True)

        place_pick = st.selectbox("Pick a placement to view trend", agg["placement"].fillna("").unique().tolist())
        show_entity_timeseries(df, {"placement": place_pick}, "Placement")

with tab4:
    st.subheader("Products (Advertised ASIN)")
    df = filter_campaign(ad_product_daily)

    if df.empty:
        st.info("No product rows for this selection.")
    else:
        agg = aggregate_period(df, ["asin", "sku"]).sort_values("cost", ascending=False)

        st.write("Top advertised products (sorted by spend)")
        view = agg.copy()
        view["cost"] = view["cost"].round(2)
        view["sales"] = view["sales"].round(2)
        view["acos"] = (view["acos"]*100).round(2)
        st.dataframe(view.head(200), use_container_width=True, height=380)

        asin_pick = st.selectbox("Pick an ASIN to view trend", agg["asin"].fillna("").unique().tolist())
        show_entity_timeseries(df, {"asin": asin_pick}, "Products")

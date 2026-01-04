import numpy as np
import pandas as pd

def compute_kpis_from_totals(totals) -> dict:
    """
    totals: dict/Series with impressions, clicks, cost, orders, sales
    """
    imp = float(totals.get("impressions", 0) or 0)
    clk = float(totals.get("clicks", 0) or 0)
    cost = float(totals.get("cost", 0) or 0)
    ords = float(totals.get("orders", 0) or 0)
    sales = float(totals.get("sales", 0) or 0)

    ctr = np.nan if imp == 0 else clk / imp
    cpc = np.nan if clk == 0 else cost / clk
    cvr = np.nan if clk == 0 else ords / clk
    acos = np.nan if sales == 0 else cost / sales
    roas = np.nan if cost == 0 else sales / cost

    return {"ctr": ctr, "cpc": cpc, "cvr": cvr, "acos": acos, "roas": roas}

def format_currency(x, symbol="₹") -> str:
    try:
        if x is None or (isinstance(x, float) and np.isnan(x)):
            return "—"
        return f"{symbol}{float(x):,.2f}"
    except Exception:
        return "—"

def format_number(x) -> str:
    try:
        if x is None or (isinstance(x, float) and np.isnan(x)):
            return "—"
        return f"{float(x):,.0f}"
    except Exception:
        return "—"

def format_percent(x) -> str:
    try:
        if x is None or (isinstance(x, float) and np.isnan(x)):
            return "—"
        return f"{float(x)*100:.2f}%"
    except Exception:
        return "—"

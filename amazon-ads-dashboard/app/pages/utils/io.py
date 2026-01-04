from pathlib import Path
import pandas as pd
import streamlit as st

APP_DIR = Path(__file__).resolve().parents[1]
REPO_ROOT = APP_DIR.parent
PROCESSED_DIR = REPO_ROOT / "artifacts" / "processed"

@st.cache_data(show_spinner=False)
def load_parquet(name: str) -> pd.DataFrame:
    path = PROCESSED_DIR / f"{name}.parquet"
    if not path.exists():
        raise FileNotFoundError(f"Missing artifact: {path}")
    return pd.read_parquet(path)

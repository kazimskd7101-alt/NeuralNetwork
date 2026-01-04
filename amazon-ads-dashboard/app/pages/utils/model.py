from pathlib import Path
import json
import pandas as pd
import streamlit as st
from catboost import CatBoostClassifier, CatBoostRegressor

APP_DIR = Path(__file__).resolve().parents[1]
REPO_ROOT = APP_DIR.parent
MODELS_DIR = REPO_ROOT / "artifacts" / "models"
SCHEMA_DIR = REPO_ROOT / "artifacts" / "schema"

@st.cache_data(show_spinner=False)
def load_model_schema() -> dict:
    path = SCHEMA_DIR / "model_schema.json"
    if not path.exists():
        raise FileNotFoundError(f"Missing schema: {path}")
    with open(path, "r") as f:
        return json.load(f)

@st.cache_resource(show_spinner=False)
def load_models():
    clf = CatBoostClassifier()
    reg = CatBoostRegressor()

    clf_path = MODELS_DIR / "cb_waste_risk.cbm"
    reg_path = MODELS_DIR / "cb_future7_roas.cbm"

    if not clf_path.exists() or not reg_path.exists():
        raise FileNotFoundError("Missing model files in artifacts/models/")

    clf.load_model(str(clf_path))
    reg.load_model(str(reg_path))
    return clf, reg

def predict_with_models(df_features: pd.DataFrame) -> pd.DataFrame:
    schema = load_model_schema()
    features = schema["features"]

    X = df_features.copy()
    for col in features:
        if col not in X.columns:
            X[col] = 0

    X = X[features]

    clf, reg = load_models()

    waste_prob = clf.predict_proba(X)[:, 1]
    future_roas = reg.predict(X)

    out = df_features.copy()
    out["waste_risk_prob"] = waste_prob
    out["pred_future7_roas"] = future_roas
    return out

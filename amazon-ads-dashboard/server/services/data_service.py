from __future__ import annotations

from pathlib import Path
from typing import Dict, Optional

import pandas as pd


class DataService:
    """
    Loads processed tables from:
      repo_root/artifacts/processed/*.parquet (preferred)
      repo_root/artifacts/processed/*.csv     (fallback)

    Caches in memory after first load.
    """

    def __init__(self) -> None:
        # server/ is one level below repo root
        self.repo_root = Path(__file__).resolve().parents[2]
        self.processed_dir = self.repo_root / "artifacts" / "processed"
        self._cache: Dict[str, pd.DataFrame] = {}

    def _read_table(self, name: str) -> pd.DataFrame:
        parquet_path = self.processed_dir / f"{name}.parquet"
        csv_path = self.processed_dir / f"{name}.csv"

        if parquet_path.exists():
            df = pd.read_parquet(parquet_path)
            return df

        if csv_path.exists():
            df = pd.read_csv(csv_path)
            return df

        raise FileNotFoundError(
            f"Missing dataset '{name}'. Expected {parquet_path} or {csv_path}"
        )

    def get_table(self, name: str) -> pd.DataFrame:
        if name not in self._cache:
            df = self._read_table(name)

            # normalize date column if present
            if "date" in df.columns:
                df["date"] = pd.to_datetime(df["date"], errors="coerce")

            self._cache[name] = df

        return self._cache[name]

    def get_records(
        self,
        name: str,
        start_date: Optional[str] = None,
        end_date: Optional[str] = None,
        campaign_id: Optional[str] = None,
        limit: Optional[int] = None,
    ):
        df = self.get_table(name).copy()

        # Filter by date range (if date exists)
        if "date" in df.columns and (start_date or end_date):
            if start_date:
                sd = pd.to_datetime(start_date, errors="coerce")
                if pd.notna(sd):
                    df = df[df["date"] >= sd]
            if end_date:
                ed = pd.to_datetime(end_date, errors="coerce")
                if pd.notna(ed):
                    df = df[df["date"] <= ed]

        # Filter by campaign_id if requested and available
        if campaign_id and "campaign_id" in df.columns:
            df = df[df["campaign_id"].astype(str) == str(campaign_id)]

        # Apply limit
        if isinstance(limit, int) and limit > 0:
            df = df.head(limit)

        # Convert datetime to ISO string for JSON
        if "date" in df.columns:
            df["date"] = df["date"].dt.strftime("%Y-%m-%d")

        # Replace NaN with None for clean JSON
        df = df.where(pd.notnull(df), None)

        return df.to_dict(orient="records")


data_service = DataService()

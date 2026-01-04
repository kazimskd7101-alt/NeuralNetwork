from typing import Optional
from fastapi import APIRouter, Query

from services.data_service import data_service

router = APIRouter(prefix="/data", tags=["data"])


@router.get("/total_daily")
def total_daily(
    start_date: Optional[str] = Query(default=None, description="YYYY-MM-DD"),
    end_date: Optional[str] = Query(default=None, description="YYYY-MM-DD"),
    limit: Optional[int] = Query(default=None, ge=1, le=200000),
):
    return data_service.get_records(
        name="total_daily",
        start_date=start_date,
        end_date=end_date,
        limit=limit,
    )


@router.get("/campaign_daily")
def campaign_daily(
    start_date: Optional[str] = Query(default=None, description="YYYY-MM-DD"),
    end_date: Optional[str] = Query(default=None, description="YYYY-MM-DD"),
    campaign_id: Optional[str] = Query(default=None, description="Exact campaign_id"),
    limit: Optional[int] = Query(default=None, ge=1, le=200000),
):
    return data_service.get_records(
        name="campaign_daily",
        start_date=start_date,
        end_date=end_date,
        campaign_id=campaign_id,
        limit=limit,
    )

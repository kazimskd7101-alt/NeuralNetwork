from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from routes.health import router as health_router
from routes.data import router as data_router

app = FastAPI(title="Amazon Ads Dashboard API", version="1.0.0")

# CORS for local dev (frontend running from file:// or local server)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # for dev; lock this down for production
    allow_credentials=False,
    allow_methods=["GET"],
    allow_headers=["*"],
)

app.include_router(health_router)
app.include_router(data_router)


@app.get("/")
def root():
    return {"ok": True, "service": "amazon-ads-dashboard-api"}

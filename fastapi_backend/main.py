
from fastapi import FastAPI, HTTPException

from fastapi_backend.database import get_connection
from fastapi_backend.visitor_routes import router as visitor_router
from fastapi_backend.maintenance_routes import router as maintenance_router
from fastapi_backend.room_change_routes import router as room_change_router
app = FastAPI(
    title="Hostel Management System API",
    description="Backend API for the Hostel Management System",
    version="1.0.0"
)

app.include_router(visitor_router)
app.include_router(maintenance_router)
app.include_router(room_change_router)


@app.get("/", tags=["Home"])
def home():
    return {
        "message": "Hostel Management System API is running"
    }


@app.get("/health/db", tags=["Database"])
def check_database():
    try:
        with get_connection() as conn:
            with conn.cursor() as cur:
                cur.execute(
                    "SELECT current_database() AS database_name"
                )
                result = cur.fetchone()

        return {
            "status": "connected",
            "database": result["database_name"]
        }

    except Exception as exc:
        raise HTTPException(
            status_code=503,
            detail=f"Database connection failed: {exc}"
        )

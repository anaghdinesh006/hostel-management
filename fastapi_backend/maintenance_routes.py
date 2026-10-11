
from datetime import date
from typing import Optional

from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel, Field

from fastapi_backend.database import get_connection

router = APIRouter(
    prefix="/api/maintenance",
    tags=["Maintenance Requests"]
)

VALID_STATUSES = {"Pending", "In Progress", "Resolved", "Rejected"}
VALID_PRIORITIES = {"Low", "Medium", "High", "Urgent"}


class MaintenanceCreate(BaseModel):
    student_id: int = Field(gt=0)
    room_id: int = Field(gt=0)
    description: str = Field(min_length=1)
    priority: str = "Medium"


class MaintenanceStatusUpdate(BaseModel):
    status: str
    resolution_date: Optional[date] = None
    resolution_notes: Optional[str] = None


class MaintenanceUpdate(BaseModel):
    description: Optional[str] = Field(default=None, min_length=1)
    room_id: Optional[int] = Field(default=None, gt=0)
    priority: Optional[str] = None
    assigned_staff: Optional[str] = None


def validate_priority(priority: str):
    if priority not in VALID_PRIORITIES:
        raise HTTPException(
            status_code=400,
            detail="Priority must be Low, Medium, High, or Urgent"
        )



@router.post("/", status_code=201)
def create_request(request: MaintenanceCreate):
    validate_priority(request.priority)

    if not request.description.strip():
        raise HTTPException(
            status_code=400,
            detail="Description cannot be empty",
        )

    try:
        with get_connection() as conn:
            with conn.cursor() as cur:
                cur.execute(
                    """
                    INSERT INTO maintenance_request
                        (
                            student_id,
                            room_id,
                            issue_title,
                            issue_description,
                            priority
                        )
                    VALUES (%s, %s, %s, %s, %s)
                    RETURNING *
                    """,
                    (
                        request.student_id,
                        request.room_id,
                        "Maintenance Request",
                        request.description.strip(),
                        request.priority,
                    ),
                )
                return cur.fetchone()

    except Exception as exc:
        print("MAINTENANCE CREATE ERROR:", repr(exc))

        if "ForeignKeyViolation" in type(exc).__name__:
            raise HTTPException(
                status_code=404,
                detail="Student or room not found",
            )

        raise HTTPException(
            status_code=500,
            detail="Could not create maintenance request. Check the server terminal.",
        )



@router.get("/")
def list_requests(
    student_id: Optional[int] = Query(default=None, gt=0),
    room_id: Optional[int] = Query(default=None, gt=0),
    status: Optional[str] = None,
    priority: Optional[str] = None,
    search: Optional[str] = None,
    start_date: Optional[date] = None,
    end_date: Optional[date] = None,
):
    if start_date and end_date and start_date > end_date:
        raise HTTPException(
            status_code=400,
            detail="start_date must be before end_date",
        )

    conditions = []
    params = []

    if student_id is not None:
        conditions.append("m.student_id = %s")
        params.append(student_id)

    if room_id is not None:
        conditions.append("m.room_id = %s")
        params.append(room_id)

    if status:
        conditions.append("m.request_status = %s")
        params.append(status)

    if priority:
        conditions.append("m.priority = %s")
        params.append(priority)

    if search:
        conditions.append(
            "(m.issue_description ILIKE %s OR m.issue_title ILIKE %s "
            "OR s.full_name ILIKE %s)"
        )
        term = f"%{search}%"
        params.extend([term, term, term])

    if start_date:
        conditions.append("m.reported_at::date >= %s")
        params.append(start_date)

    if end_date:
        conditions.append("m.reported_at::date <= %s")
        params.append(end_date)

    where_clause = (
        " WHERE " + " AND ".join(conditions)
        if conditions else ""
    )

    with get_connection() as conn:
        with conn.cursor() as cur:
            cur.execute(
                f"""
                SELECT
                    m.*,
                    s.full_name AS student_name
                FROM maintenance_request m
                JOIN students s
                    ON s.student_id = m.student_id
                {where_clause}
                ORDER BY m.reported_at DESC, m.request_id DESC
                """,
                params,
            )
            return cur.fetchall()


@router.get("/reports/summary")
def maintenance_report():
    try:
        with get_connection() as conn:
            with conn.cursor() as cur:
                cur.execute("""
                    SELECT
                        COUNT(*) AS active_requests,
                        0 AS cancelled_requests,
                        COUNT(*) FILTER (
                            WHERE request_status = 'Open'
                        ) AS pending_requests,
                        COUNT(*) FILTER (
                            WHERE request_status = 'In Progress'
                        ) AS in_progress_requests,
                        COUNT(*) FILTER (
                            WHERE request_status = 'Resolved'
                        ) AS resolved_requests,
                        COUNT(*) FILTER (
                            WHERE request_status = 'Rejected'
                        ) AS rejected_requests
                    FROM maintenance_request
                """)
                totals = cur.fetchone()

                cur.execute("""
                    SELECT priority, COUNT(*) AS total_requests
                    FROM maintenance_request
                    GROUP BY priority
                    ORDER BY priority
                """)
                priority_summary = cur.fetchall()

        return {
            "totals": totals,
            "priority_summary": priority_summary
        }

    except Exception as exc:
        print("MAINTENANCE REPORT ERROR:", repr(exc))
        raise HTTPException(
            status_code=500,
            detail="Could not generate maintenance report. Check the server terminal."
        )


@router.get("/{request_id}")
def get_request(request_id: int):
    with get_connection() as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                SELECT
                    m.*,
                    s.full_name AS student_name
                FROM maintenance_request m
                JOIN students s
                    ON s.student_id = m.student_id
                WHERE m.request_id = %s
                """,
                (request_id,),
            )
            request = cur.fetchone()

    if not request:
        raise HTTPException(
            status_code=404,
            detail="Maintenance request not found",
        )

    return request


@router.patch("/{request_id}/status")
def update_request_status(request_id: int, update: MaintenanceStatusUpdate):
    valid_statuses = {"Open", "In Progress", "Resolved"}

    if update.status not in valid_statuses:
        raise HTTPException(
            status_code=400,
            detail="Status must be Open, In Progress, or Resolved"
        )

    with get_connection() as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                UPDATE maintenance_request
                SET request_status = %s,
                    resolved_at = CASE
                        WHEN %s = 'Resolved'
                        THEN CURRENT_TIMESTAMP
                        ELSE NULL
                    END
                WHERE request_id = %s
                RETURNING *
                """,
                (update.status, update.status, request_id),
            )
            updated = cur.fetchone()

    if not updated:
        raise HTTPException(
            status_code=404,
            detail="Maintenance request not found"
        )

    return updated


@router.put("/{request_id}")
def edit_request(request_id: int, update: MaintenanceUpdate):
    changes = update.model_dump(exclude_unset=True)

    if not changes:
        raise HTTPException(
            status_code=400,
            detail="Provide at least one field to update"
        )

    if "priority" in changes and changes["priority"] is not None:
        validate_priority(changes["priority"])

    if "description" in changes and changes["description"] is not None:
        changes["description"] = changes["description"].strip()
        if not changes["description"]:
            raise HTTPException(
                status_code=400,
                detail="Description cannot be empty"
            )

    allowed_fields = {
        "description": "issue_description",
        "room_id": "room_id",
        "priority": "priority"
    }

    assignments = []
    values = []

    for field, column in allowed_fields.items():
        if field in changes:
            assignments.append(f"{column} = %s")
            values.append(changes[field])

    if not assignments:
        raise HTTPException(
            status_code=400,
            detail="No supported fields provided to update"
        )

    with get_connection() as conn:
        with conn.cursor() as cur:
            cur.execute(
                f"""
                UPDATE maintenance_request
                SET {", ".join(assignments)}
                WHERE request_id = %s
                RETURNING *
                """,
                values + [request_id],
            )
            updated = cur.fetchone()

    if not updated:
        raise HTTPException(
            status_code=404,
            detail="Maintenance request not found"
        )

    return updated


@router.delete("/{request_id}")
def cancel_request(request_id: int):
    with get_connection() as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                DELETE FROM maintenance_request
                WHERE request_id = %s
                  AND request_status = 'Open'
                RETURNING request_id
                """,
                (request_id,),
            )
            deleted = cur.fetchone()

    if deleted:
        return {
            "message": "Maintenance request deleted",
            "request_id": deleted["request_id"]
        }

    with get_connection() as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                SELECT request_id, request_status
                FROM maintenance_request
                WHERE request_id = %s
                """,
                (request_id,),
            )
            existing = cur.fetchone()

    if not existing:
        raise HTTPException(
            status_code=404,
            detail="Maintenance request not found"
        )

    raise HTTPException(
        status_code=409,
        detail="Only Open maintenance requests can be deleted"
    )

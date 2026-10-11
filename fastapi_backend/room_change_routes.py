
from datetime import date
from typing import Optional
import httpx
from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel, Field

from fastapi_backend.database import get_connection

router = APIRouter(
    prefix="/api/room-changes",
    tags=["Room Change Requests"]
)

VALID_STATUSES = {"Pending", "Approved", "Rejected"}


class RoomChangeCreate(BaseModel):
    student_id: int = Field(gt=0)
    current_room_id: int = Field(gt=0)
    requested_room_id: int = Field(gt=0)
    reason: str = Field(min_length=1)


class RoomChangeDecision(BaseModel):
    status: str
    admin_id: Optional[int] = Field(default=None, gt=0)
    admin_remarks: Optional[str] = None



@router.post("/", status_code=201)
def create_room_change(request: RoomChangeCreate):
    reason = request.reason.strip()

    if not reason:
        raise HTTPException(
            status_code=400,
            detail="Reason cannot be empty"
        )

    if request.current_room_id == request.requested_room_id:
        raise HTTPException(
            status_code=400,
            detail="Current and requested rooms must be different"
        )

    with get_connection() as conn:
        with conn.cursor() as cur:
            cur.execute(
                "SELECT 1 FROM students WHERE student_id = %s",
                (request.student_id,)
            )
            if not cur.fetchone():
                raise HTTPException(
                    status_code=404,
                    detail="Student not found"
                )

            cur.execute(
                "SELECT 1 FROM rooms WHERE room_id = %s",
                (request.current_room_id,)
            )
            if not cur.fetchone():
                raise HTTPException(
                    status_code=404,
                    detail="Current room not found"
                )

            cur.execute(
                "SELECT 1 FROM rooms WHERE room_id = %s",
                (request.requested_room_id,)
            )
            if not cur.fetchone():
                raise HTTPException(
                    status_code=404,
                    detail="Requested room not found"
                )

            cur.execute(
                """
                INSERT INTO room_change_request
                    (student_id, current_room_id, requested_room_id, reason)
                VALUES (%s, %s, %s, %s)
                RETURNING *
                """,
                (
                    request.student_id,
                    request.current_room_id,
                    request.requested_room_id,
                    reason
                )
            )
            return cur.fetchone()


@router.get("/")
def list_room_changes(
    student_id: Optional[int] = Query(default=None, gt=0),
    status: Optional[str] = None,
    search: Optional[str] = None,
    start_date: Optional[date] = None,
    end_date: Optional[date] = None
):
    if start_date and end_date and start_date > end_date:
        raise HTTPException(
            status_code=400,
            detail="start_date must be on or before end_date"
        )

    conditions = []
    params = []

    if student_id is not None:
        conditions.append("r.student_id = %s")
        params.append(student_id)

    if status:
        conditions.append("r.request_status = %s")
        params.append(status)

    if search:
        conditions.append(
            "(r.reason ILIKE %s OR s.full_name ILIKE %s)"
        )
        term = f"%{search}%"
        params.extend([term, term])

    if start_date:
        conditions.append("r.requested_at::date >= %s")
        params.append(start_date)

    if end_date:
        conditions.append("r.requested_at::date <= %s")
        params.append(end_date)

    where_clause = (
        "WHERE " + " AND ".join(conditions)
        if conditions else ""
    )

    with get_connection() as conn:
        with conn.cursor() as cur:
            cur.execute(
                f"""
                SELECT
                    r.*,
                    s.full_name AS student_name,
                    cr.room_number AS current_room_number,
                    rr.room_number AS requested_room_number
                FROM room_change_request r
                JOIN students s ON s.student_id = r.student_id
                JOIN rooms cr ON cr.room_id = r.current_room_id
                JOIN rooms rr ON rr.room_id = r.requested_room_id
                {where_clause}
                ORDER BY r.requested_at DESC, r.change_request_id DESC
                """,
                params
            )
            return cur.fetchall()


@router.get("/rooms/{room_id}/availability")
def check_room_availability(room_id: int):
    try:
        with get_connection() as conn:
            with conn.cursor() as cur:
                cur.execute(
                    """
                    SELECT
                        r.room_id,
                        r.room_number,
                        r.capacity,
                        (
                            SELECT COUNT(*)::int
                            FROM room_allocations ra
                            WHERE ra.room_id = r.room_id
                              AND ra.status = 'Active'
                              AND ra.vacate_date IS NULL
                        ) AS occupied
                    FROM rooms r
                    WHERE r.room_id = %s
                    """,
                    (room_id,)
                )
                room = cur.fetchone()

        if not room:
            raise HTTPException(
                status_code=404,
                detail="Room not found"
            )

        occupied = room["occupied"]
        available_beds = max(room["capacity"] - occupied, 0)

        return {
            "room_id": room["room_id"],
            "room_number": room["room_number"],
            "capacity": room["capacity"],
            "occupied": occupied,
            "available_beds": available_beds,
            "is_available": available_beds > 0,
            "message": "Room availability calculated successfully."
        }

    except HTTPException:
        raise
    except Exception as exc:
        print("ROOM AVAILABILITY ERROR:", repr(exc))
        raise HTTPException(
            status_code=500,
            detail="Could not retrieve room availability. Check the server terminal."
        )



@router.get("/reports/summary")
def room_change_report():
    try:
        with get_connection() as conn:
            with conn.cursor() as cur:
                cur.execute("""
                    SELECT
                        COUNT(*) AS total_requests,
                        COUNT(*) FILTER (
                            WHERE request_status = 'Pending'
                        ) AS pending_requests,
                        COUNT(*) FILTER (
                            WHERE request_status = 'Approved'
                        ) AS approved_requests,
                        COUNT(*) FILTER (
                            WHERE request_status = 'Rejected'
                        ) AS rejected_requests
                    FROM room_change_request
                """)
                totals = cur.fetchone()

        return {"totals": totals}

    except Exception as exc:
        print("ROOM CHANGE REPORT ERROR:", repr(exc))
        raise HTTPException(
            status_code=500,
            detail="Could not generate room-change report. Check the server terminal."
        )


@router.get("/{request_id}")
def get_room_change(request_id: int):
    with get_connection() as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                SELECT
                    r.*,
                    s.full_name AS student_name,
                    cr.room_number AS current_room_number,
                    rr.room_number AS requested_room_number
                FROM room_change_request r
                JOIN students s
                    ON s.student_id = r.student_id
                JOIN rooms cr
                    ON cr.room_id = r.current_room_id
                JOIN rooms rr
                    ON rr.room_id = r.requested_room_id
                WHERE r.change_request_id = %s
                """,
                (request_id,)
            )
            request = cur.fetchone()

    if not request:
        raise HTTPException(
            status_code=404,
            detail="Room change request not found"
        )

    return request



@router.patch("/{request_id}/decision")
def decide_room_change(request_id: int, decision: RoomChangeDecision):
    if decision.status not in {"Approved", "Rejected"}:
        raise HTTPException(
            status_code=400,
            detail="Decision must be Approved or Rejected"
        )

    try:
        with get_connection() as conn:
            with conn.cursor() as cur:
                cur.execute("""
                    SELECT *
                    FROM room_change_request
                    WHERE change_request_id = %s
                    FOR UPDATE
                """, (request_id,))
                request = cur.fetchone()

                if not request:
                    raise HTTPException(
                        status_code=404,
                        detail="Room-change request not found"
                    )

                if request["request_status"] != "Pending":
                    raise HTTPException(
                        status_code=409,
                        detail="Request is not Pending"
                    )

                if decision.admin_id is not None:
                    cur.execute(
                        "SELECT 1 FROM admins WHERE admin_id = %s",
                        (decision.admin_id,)
                    )
                    if not cur.fetchone():
                        raise HTTPException(
                            status_code=404,
                            detail="Admin not found"
                        )

                if decision.status == "Approved":
                    try:
                        response = httpx.post(
                            "http://localhost:5001/api/allocations/transfer",
                            json={
                                "student_id": request["student_id"],
                                "current_room_id": request["current_room_id"],
                                "requested_room_id": request["requested_room_id"]
                            },
                            timeout=10.0
                        )
                    except httpx.RequestError:
                        raise HTTPException(
                            status_code=503,
                            detail="Room allocation service is unavailable"
                        )

                    if response.status_code >= 400:
                        try:
                            detail = response.json().get(
                                "message",
                                "Room transfer failed"
                            )
                        except ValueError:
                            detail = "Room transfer failed"

                        raise HTTPException(
                            status_code=response.status_code,
                            detail=detail
                        )

                cur.execute("""
                    UPDATE room_change_request
                    SET request_status = %s,
                        admin_id = %s,
                        reviewed_at = CURRENT_TIMESTAMP
                    WHERE change_request_id = %s
                    RETURNING *
                """, (
                    decision.status,
                    decision.admin_id,
                    request_id
                ))
                updated = cur.fetchone()

        return {
            **updated,
            "allocation_updated": decision.status == "Approved",
            "message": (
                "Decision recorded and room allocation transferred."
                if decision.status == "Approved"
                else "Room-change request rejected."
            )
        }

    except HTTPException:
        raise
    except Exception as exc:
        print("ROOM CHANGE DECISION ERROR:", repr(exc))
        raise HTTPException(
            status_code=500,
            detail="Could not process room-change decision. Check the server terminal."
        )

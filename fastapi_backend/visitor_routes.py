
from datetime import date
from typing import Optional

from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel, Field

from fastapi_backend.database import get_connection

router = APIRouter(prefix="/api/visitors", tags=["Visitor Management"])


class VisitorCreate(BaseModel):
    student_id: int = Field(gt=0)
    visitor_name: str = Field(min_length=1, max_length=100)
    contact_number: Optional[str] = Field(default=None, max_length=15)
    visit_date: date
    purpose: str = Field(min_length=1, max_length=255)


class VisitorUpdate(BaseModel):
    student_id: Optional[int] = Field(default=None, gt=0)
    visitor_name: Optional[str] = Field(default=None, min_length=1, max_length=100)
    contact_number: Optional[str] = Field(default=None, max_length=15)
    visit_date: Optional[date] = None
    purpose: Optional[str] = Field(default=None, min_length=1, max_length=255)



@router.post("/", status_code=201)
def create_visitor(visitor: VisitorCreate):
    try:
        with get_connection() as conn:
            with conn.cursor() as cur:
                cur.execute(
                    """
                    INSERT INTO visitor
                        (student_id, visitor_name, visitor_phone, visit_date, purpose)
                    VALUES (%s, %s, %s, %s, %s)
                    RETURNING
                        visitor_id,
                        student_id,
                        visitor_name,
                        visitor_phone,
                        visit_date,
                        purpose,
                        check_out_time
                    """,
                    (
                        visitor.student_id,
                        visitor.visitor_name.strip(),
                        visitor.contact_number,
                        visitor.visit_date,
                        visitor.purpose.strip(),
                    ),
                )
                return cur.fetchone()

    except Exception as exc:
        print("VISITOR CREATE ERROR:", repr(exc))
        raise HTTPException(
            status_code=500,
            detail="Could not create visitor record. Check the server terminal."
        )

@router.get("/")
def list_visitors(
    search: Optional[str] = Query(default=None),
    student_id: Optional[int] = Query(default=None, gt=0),
    visit_date: Optional[date] = Query(default=None),
    start_date: Optional[date] = Query(default=None),
    end_date: Optional[date] = Query(default=None),
):
    if start_date and end_date and start_date > end_date:
        raise HTTPException(status_code=400, detail="start_date must be before end_date")

    conditions = []
    params = []

    if search:
        conditions.append(
            "(v.visitor_name ILIKE %s OR v.purpose ILIKE %s OR s.student_name ILIKE %s)"
        )
        term = f"%{search}%"
        params.extend([term, term, term])

    if student_id is not None:
        conditions.append("v.student_id = %s")
        params.append(student_id)

    if visit_date:
        conditions.append("v.visit_date = %s")
        params.append(visit_date)

    if start_date:
        conditions.append("v.visit_date >= %s")
        params.append(start_date)

    if end_date:
        conditions.append("v.visit_date <= %s")
        params.append(end_date)

    where_clause = " WHERE " + " AND ".join(conditions) if conditions else ""

    with get_connection() as conn:
        with conn.cursor() as cur:
            cur.execute(
                f"""
                SELECT
                    v.visitor_id,
                    v.student_id,
                    s.full_name AS student_name,
                    v.visitor_name,
                    v.visitor_phone,
                    v.visit_date,
                    v.purpose,
                    v.check_in_time,
                    v.check_out_time
                FROM visitor v
                JOIN students s ON s.student_id = v.student_id
                {where_clause}
                ORDER BY v.visit_date DESC, v.visitor_id DESC
                """,
                params,
            )
            return cur.fetchall()



@router.get("/{visitor_id}")
def get_visitor(visitor_id: int):
    with get_connection() as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                SELECT
                    v.visitor_id,
                    v.student_id,
                    s.full_name AS student_name,
                    v.visitor_name,
                    v.visitor_phone,
                    v.visit_date,
                    v.purpose,
                    v.check_in_time,
                    v.check_out_time
                FROM visitor v
                JOIN students s
                    ON s.student_id = v.student_id
                WHERE v.visitor_id = %s
                """,
                (visitor_id,),
            )
            visitor = cur.fetchone()

    if not visitor:
        raise HTTPException(
            status_code=404,
            detail="Visitor not found",
        )

    return visitor



@router.put("/{visitor_id}")
def update_visitor(visitor_id: int, visitor: VisitorUpdate):
    updates = visitor.model_dump(exclude_unset=True)

    if not updates:
        raise HTTPException(
            status_code=400,
            detail="Provide at least one field to update",
        )

    allowed_fields = {
        "student_id",
        "visitor_name",
        "contact_number",
        "visit_date",
        "purpose",
    }

    for field in ("visitor_name", "purpose"):
        if field in updates and updates[field] is not None:
            updates[field] = updates[field].strip()

    column_mapping = {
        "student_id": "student_id",
        "visitor_name": "visitor_name",
        "contact_number": "visitor_phone",
        "visit_date": "visit_date",
        "purpose": "purpose",
    }

    assignments = ", ".join(
        f"{column_mapping[field]} = %s"
        for field in updates
        if field in allowed_fields
    )
    values = [
        updates[field]
        for field in updates
        if field in allowed_fields
    ]

    try:
        with get_connection() as conn:
            with conn.cursor() as cur:
                cur.execute(
                    f"""
                    UPDATE visitor
                    SET {assignments}
                    WHERE visitor_id = %s
                    RETURNING
                        visitor_id,
                        student_id,
                        visitor_name,
                        visitor_phone,
                        visit_date,
                        purpose,
                        check_out_time
                    """,
                    values + [visitor_id],
                )
                updated = cur.fetchone()

    except Exception as exc:
        print("UPDATE VISITOR ERROR:", repr(exc))
        raise HTTPException(
            status_code=400,
            detail="Update failed; check the server terminal for the exact error",
        )

    if not updated:
        raise HTTPException(
            status_code=404,
            detail="Visitor not found",
        )

    return updated





@router.patch("/{visitor_id}/check-in")
def check_in_visitor(visitor_id: int):
    try:
        with get_connection() as conn:
            with conn.cursor() as cur:
                cur.execute(
                    """
                    UPDATE visitor
                    SET check_in_time = CURRENT_TIMESTAMP,
                        check_out_time = NULL
                    WHERE visitor_id = %s
                      AND check_in_time IS NULL
                    RETURNING *
                    """,
                    (visitor_id,)
                )
                visitor = cur.fetchone()

                if not visitor:
                    cur.execute(
                        "SELECT visitor_id, check_in_time FROM visitor WHERE visitor_id = %s",
                        (visitor_id,)
                    )
                    existing = cur.fetchone()

                    if not existing:
                        raise HTTPException(
                            status_code=404,
                            detail="Visitor not found"
                        )

                    raise HTTPException(
                        status_code=409,
                        detail="Visitor is already checked in"
                    )

        return visitor

    except HTTPException:
        raise
    except Exception as exc:
        print(f"Visitor check-in error: {exc}")
        raise HTTPException(
            status_code=500,
            detail="Failed to check in visitor"
        )



@router.patch("/{visitor_id}/check-out")
def check_out_visitor(visitor_id: int):
    try:
        with get_connection() as conn:
            with conn.cursor() as cur:
                cur.execute(
                    """
                    UPDATE visitor
                    SET check_out_time = CURRENT_TIMESTAMP
                    WHERE visitor_id = %s
                      AND check_out_time IS NULL
                    RETURNING
                        visitor_id,
                        visitor_name,
                        check_out_time
                    """,
                    (visitor_id,),
                )
                visitor = cur.fetchone()

                if visitor:
                    return visitor

                cur.execute(
                    """
                    SELECT visitor_id, check_out_time
                    FROM visitor
                    WHERE visitor_id = %s
                    """,
                    (visitor_id,),
                )
                existing = cur.fetchone()

    except Exception as exc:
        print("VISITOR CHECK-OUT ERROR:", repr(exc))
        raise HTTPException(
            status_code=500,
            detail="Could not check out visitor. Check the server terminal.",
        )

    if not existing:
        raise HTTPException(
            status_code=404,
            detail="Visitor not found",
        )

    raise HTTPException(
        status_code=409,
        detail="Visitor has already checked out",
    )


@router.delete("/{visitor_id}")
def delete_visitor(visitor_id: int):
    with get_connection() as conn:
        with conn.cursor() as cur:
            cur.execute(
                "DELETE FROM visitor WHERE visitor_id = %s RETURNING visitor_id",
                (visitor_id,),
            )
            deleted = cur.fetchone()

    if not deleted:
        raise HTTPException(status_code=404, detail="Visitor not found")

    return {"message": "Visitor record deleted", "visitor_id": visitor_id}


@router.get("/reports/summary")
def visitor_report():
    try:
        with get_connection() as conn:
            with conn.cursor() as cur:
                cur.execute(
                    """
                    SELECT
                        COUNT(*) AS total_visitors,
                        0 AS checked_in_visitors,
                        COUNT(check_out_time) AS completed_visits,
                        0 AS currently_inside
                    FROM visitor
                    """
                )
                summary = cur.fetchone()

                cur.execute(
                    """
                    SELECT
                        visit_date::date AS visit_date,
                        COUNT(*) AS total_visitors
                    FROM visitor
                    GROUP BY visit_date::date
                    ORDER BY visit_date::date DESC
                    """
                )
                daily_visits = cur.fetchall()

        return {
            "summary": summary,
            "daily_visits": daily_visits,
        }

    except Exception as exc:
        print("VISITOR REPORT ERROR:", repr(exc))
        raise HTTPException(
            status_code=500,
            detail="Could not generate visitor report. Check the server terminal.",
        )

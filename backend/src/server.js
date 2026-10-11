
require("dotenv").config();

const express = require("express");
const cors = require("cors");
const pool = require("./db");
const axios = require("axios");

const app = express();
const PORT = process.env.PORT || 5000;
app.use(cors({ origin: "http://localhost:5173" }));
app.use(express.json());

app.get("/", (req, res) => {
  res.json({
    message: "Hostel Management API is running",
  });
});

app.get("/api/hostels", async (req, res) => {
  try {
    const result = await pool.query(
      "SELECT * FROM hostel ORDER BY hostel_id"
    );

    res.json(result.rows);
  } catch (error) {
    console.error("Error fetching hostels:", error.message);
    res.status(500).json({
      message: "Failed to fetch hostels",
    });
  }
});

app.post("/api/hostels", async (req, res) => {
  try {
    const {
      hostel_name,
      address,
      warden_name,
      contact_number,
    } = req.body;

    if (!hostel_name || !address || !warden_name || !contact_number) {
      return res.status(400).json({
        message: "Please fill in all hostel fields.",
      });
    }

    const result = await pool.query(
      `INSERT INTO hostel
        (hostel_name, address, warden_name, contact_number)
       VALUES ($1, $2, $3, $4)
       RETURNING *`,
      [hostel_name, address, warden_name, contact_number]
    );

    res.status(201).json(result.rows[0]);
  } catch (error) {
    console.error("Error adding hostel:", error.message);
    res.status(500).json({
      message: "Failed to add hostel.",
    });
  }
});
app.get("/api/health", async (req, res) => {
  try {
    const result = await pool.query(
      "SELECT current_database() AS database"
    );

    res.json({
      status: "connected",
      database: result.rows[0].database,
    });
  } catch (error) {
    console.error("Database check failed:", error.message);
    res.status(500).json({
      status: "error",
      message: "Could not connect to PostgreSQL",
    });
  }
});

app.get("/api/rooms", async (req, res) => {
  try {
    const result = await pool.query(
      "SELECT * FROM rooms ORDER BY room_id"
    );

    res.json(result.rows);
  } catch (error) {
    console.error("Error fetching rooms:", error.message);
    res.status(500).json({
      message: "Failed to fetch rooms",
    });
  }
});

app.get("/api/allocations", async (req, res) => {
  try {
    const result = await pool.query(
      "SELECT * FROM room_allocations ORDER BY allocation_id"
    );

    res.json(result.rows);
  } catch (error) {
    console.error("Error fetching allocations:", error.message);
    res.status(500).json({
      message: "Failed to fetch room allocations",
    });
  }
});


app.get("/api/allocations/student", async (req, res) => {
  const search = String(req.query.search || "").trim();

  if (!search) {
    return res.status(400).json({
      error: "Enter a student ID, roll number, or name.",
    });
  }

  try {
    const result = await pool.query(
      `SELECT
         s.student_id,
         s.roll_number,
         s.full_name,
         s.email,
         s.phone,
         ra.allocation_id,
         ra.allocation_date,
         ra.vacate_date,
         ra.status,
         r.room_number,
         r.room_type,
         r.capacity,
         r.monthly_fee,
         h.hostel_name
       FROM students s
       LEFT JOIN room_allocations ra
         ON ra.student_id = s.student_id
         AND ra.status = 'Active'
       LEFT JOIN rooms r ON r.room_id = ra.room_id
       LEFT JOIN hostel h ON h.hostel_id = r.hostel_id
       WHERE
         CASE
           WHEN $1 ~ '^[0-9]+$'
             THEN s.student_id = $1::integer
           ELSE
             s.roll_number ILIKE $1
             OR s.full_name ILIKE $1
         END
       ORDER BY ra.allocation_date DESC NULLS LAST
       LIMIT 20`,
      [/^\d+$/.test(search) ? search : `%${search}%`]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({
        error: "No student found. Check the student ID, roll number, or name.",
      });
    }

    res.json(result.rows);
  } catch (error) {
    console.error("Room allocation search error:", error.message);
    res.status(500).json({
      error: "Could not search room allocations.",
    });
  }
});

app.post("/api/allocations/transfer", async (req, res) => {
  const { student_id, current_room_id, requested_room_id } = req.body;

  if (
    !Number.isInteger(student_id) ||
    !Number.isInteger(current_room_id) ||
    !Number.isInteger(requested_room_id) ||
    current_room_id === requested_room_id
  ) {
    return res.status(400).json({
      message: "Provide valid student, current room, and requested room IDs."
    });
  }

  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    const allocationResult = await client.query(
      `SELECT allocation_id, room_id
       FROM room_allocations
       WHERE student_id = $1
         AND status = 'Active'
         AND vacate_date IS NULL
       FOR UPDATE`,
      [student_id]
    );

    if (
      allocationResult.rows.length === 0 ||
      allocationResult.rows[0].room_id !== current_room_id
    ) {
      await client.query("ROLLBACK");
      return res.status(409).json({
        message: "Active allocation not found for the current room."
      });
    }

    const roomResult = await client.query(
      `SELECT room_id, capacity
       FROM rooms
       WHERE room_id = $1
       FOR UPDATE`,
      [requested_room_id]
    );

    if (roomResult.rows.length === 0) {
      await client.query("ROLLBACK");
      return res.status(404).json({
        message: "Requested room not found."
      });
    }

    const occupiedResult = await client.query(
      `SELECT COUNT(*)::int AS occupied
       FROM room_allocations
       WHERE room_id = $1
         AND status = 'Active'
         AND vacate_date IS NULL`,
      [requested_room_id]
    );

    if (occupiedResult.rows[0].occupied >= roomResult.rows[0].capacity) {
      await client.query("ROLLBACK");
      return res.status(409).json({
        message: "Requested room has no available beds."
      });
    }

    await client.query(
      `UPDATE room_allocations
       SET status = 'Completed', vacate_date = CURRENT_DATE
       WHERE allocation_id = $1`,
      [allocationResult.rows[0].allocation_id]
    );

    const newAllocation = await client.query(
      `INSERT INTO room_allocations
         (student_id, room_id, allocation_date, status)
       VALUES ($1, $2, CURRENT_DATE, 'Active')
       RETURNING *`,
      [student_id, requested_room_id]
    );

    await client.query("COMMIT");

    return res.json({
      message: "Room allocation transferred successfully.",
      allocation: newAllocation.rows[0]
    });
  } catch (error) {
    await client.query("ROLLBACK");
    console.error("Room transfer error:", error.message);
    return res.status(500).json({
      message: "Room transfer failed."
    });
  } finally {
    client.release();
  }
});

const FASTAPI_URL = process.env.FASTAPI_URL || "http://127.0.0.1:8000";

app.use(
  ["/api/visitors", "/api/maintenance"],
  async (req, res) => {
    try {
      const response = await axios({
        method: req.method,
        url: `${FASTAPI_URL}${req.originalUrl}`,
        params: req.query,
        data: req.body,
        headers: {
          "Content-Type": req.headers["content-type"] || "application/json"
        },
        validateStatus: () => true,
        timeout: 15000
      });

      res.status(response.status).json(response.data);
    } catch (error) {
      console.error("FastAPI forwarding error:", error.message);

      res.status(502).json({
        detail: "Visitor or maintenance service is unavailable."
      });
    }
  }
);


app.listen(PORT, () => {
  console.log(`Backend running at http://localhost:${PORT}`);
});
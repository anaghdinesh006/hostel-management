
import os
import psycopg
from psycopg.rows import dict_row

DATABASE_URL = os.getenv(
    "DATABASE_URL",
    "postgresql://dinesanraghavanpillai@localhost:5432/hostel_team_restore"
)

def get_connection():
    return psycopg.connect(
        DATABASE_URL,
        row_factory=dict_row
    )

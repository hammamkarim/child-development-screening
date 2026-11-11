from pathlib import Path

from src.denver_age_line import (
    age_to_decimal_months,
    calculate_task_position,
    calculate_all_task_positions,
    load_denver_tasks
)


# ============================================================
# PATH
# ============================================================

PROJECT_ROOT = Path(__file__).resolve().parents[1]

JSON_PATH = (
    PROJECT_ROOT
    / "data"
    / "denver"
    / "denver_tasks.json"
)


# ============================================================
# TEST 1 — KONVERSI USIA
# ============================================================

age = {
    "years": 1,
    "months": 2,
    "days": 14
}

age_months = age_to_decimal_months(age)

print("TEST 1")
print("Usia:", age)
print("Usia bulan:", age_months)

assert round(age_months, 4) == 14.4667


# ============================================================
# TEST 2 — POSISI LEFT
# ============================================================

task = {
    "id": "TEST_LEFT",
    "p25_month": 10,
    "p90_month": 12
}

position = calculate_task_position(
    14.4667,
    task
)

print("\nTEST 2")
print("Position:", position)

assert position == "LEFT"


# ============================================================
# TEST 3 — POSISI RIGHT
# ============================================================

task = {
    "id": "TEST_RIGHT",
    "p25_month": 16,
    "p90_month": 20
}

position = calculate_task_position(
    14.4667,
    task
)

print("\nTEST 3")
print("Position:", position)

assert position == "RIGHT"


# ============================================================
# TEST 4 — POSISI INTERSECT
# ============================================================

task = {
    "id": "TEST_INTERSECT",
    "p25_month": 13,
    "p90_month": 18
}

position = calculate_task_position(
    14.4667,
    task
)

print("\nTEST 4")
print("Position:", position)

assert position == "INTERSECT"


# ============================================================
# TEST 5 — BATAS P25
# ============================================================

task = {
    "id": "TEST_BOUNDARY_P25",
    "p25_month": 14.4667,
    "p90_month": 20
}

position = calculate_task_position(
    14.4667,
    task
)

print("\nTEST 5")
print("Position:", position)

assert position == "INTERSECT"


# ============================================================
# TEST 6 — BATAS P90
# ============================================================

task = {
    "id": "TEST_BOUNDARY_P90",
    "p25_month": 10,
    "p90_month": 14.4667
}

position = calculate_task_position(
    14.4667,
    task
)

print("\nTEST 6")
print("Position:", position)

assert position == "INTERSECT"


# ============================================================
# TEST 7 — MASTER DENVER II
# ============================================================

tasks = load_denver_tasks(JSON_PATH)

print("\nTEST 7")
print("Jumlah tugas:", len(tasks))

assert len(tasks) == 125


# ============================================================
# TEST 8 — POSISI 125 TUGAS
# ============================================================

results = calculate_all_task_positions(
    14.4667,
    tasks
)

print("\nTEST 8")
print("Jumlah hasil:", len(results))

assert len(results) == 125


# ============================================================
# RINGKASAN
# ============================================================

from collections import Counter

counter = Counter(
    item["position"]
    for item in results
)

print("\nHASIL POSISI")
print("LEFT      :", counter["LEFT"])
print("INTERSECT :", counter["INTERSECT"])
print("RIGHT     :", counter["RIGHT"])

print("\nSEMUA TEST 11.3C BERHASIL.")
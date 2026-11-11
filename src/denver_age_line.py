from pathlib import Path
import json


# ============================================================
# KONSTANTA
# ============================================================

DAYS_PER_MONTH = 30


# ============================================================
# KONVERSI USIA FINAL → BULAN DESIMAL
# ============================================================

def age_to_decimal_months(age: dict) -> float:
    """
    Mengubah usia final Denver II menjadi bulan desimal.

    Contoh:
    1 Tahun 2 Bulan 14 Hari
    = 12 + 2 + (14 / 30)
    = 14.4667 bulan
    """

    years = age["years"]
    months = age["months"]
    days = age["days"]

    return (
        years * 12
        + months
        + (days / DAYS_PER_MONTH)
    )


# ============================================================
# MENENTUKAN POSISI SATU TUGAS
# ============================================================

def calculate_task_position(
    age_months: float,
    task: dict
) -> str:
    """
    Menentukan posisi tugas terhadap garis umur.

    LEFT: usia sudah melewati P90.
    RIGHT: usia masih sebelum persentil valid paling awal.
    INTERSECT: usia berada dalam rentang persentil yang tersedia.
    UNAVAILABLE: tidak ada satu pun nilai persentil yang tersedia.

    Null tidak dianggap sebagai Birth. Tugas Birth dikenali melalui nilai
    persentil eksplisit 0.0, misalnya p90_month = 0.0.
    """
    p90 = task.get("p90_month")

    if p90 is not None and age_months > float(p90):
        return "LEFT"

    earliest = None
    for key in ("p25_month", "p50_month", "p75_month", "p90_month"):
        value = task.get(key)
        if value is not None:
            earliest = float(value)
            break

    if earliest is None:
        return "UNAVAILABLE"

    if age_months < earliest:
        return "RIGHT"

    return "INTERSECT"


# ============================================================
# MENENTUKAN POSISI SELURUH TUGAS
# ============================================================

def calculate_all_task_positions(
    age_months: float,
    tasks: list
) -> list:
    """
    Menghitung posisi seluruh tugas Denver II.
    """

    results = []

    for task in tasks:

        position = calculate_task_position(
            age_months,
            task
        )

        results.append({
            "id": task["id"],
            "domain": task["domain"],
            "name": task["name"],
            "reportable": task.get("reportable"),
            "footnote": task.get("footnote"),
            "p25_month": task.get("p25_month"),
            "p50_month": task.get("p50_month"),
            "p75_month": task.get("p75_month"),
            "p90_month": task.get("p90_month"),
            "position": position
        })

    return results


# ============================================================
# MEMBACA MASTER DENVER II
# ============================================================

def load_denver_tasks(json_path: str | Path) -> list:
    """
    Membaca master tugas Denver II dari JSON.
    """

    json_path = Path(json_path)

    with open(json_path, "r", encoding="utf-8") as file:
        tasks = json.load(file)

    if not isinstance(tasks, list):
        raise ValueError(
            "Format denver_tasks.json harus berupa list."
        )

    if len(tasks) != 125:
        raise ValueError(
            f"Jumlah tugas harus 125, "
            f"tetapi ditemukan {len(tasks)}."
        )

    return tasks


# ============================================================
# FUNGSI UTAMA
# ============================================================

def calculate_age_line(
    age: dict,
    json_path: str | Path
) -> dict:
    """
    Menghasilkan posisi garis umur terhadap
    seluruh tugas Denver II.
    """

    age_months = age_to_decimal_months(age)

    tasks = load_denver_tasks(json_path)

    positions = calculate_all_task_positions(
        age_months,
        tasks
    )

    return {
        "age": age,
        "age_months": age_months,
        "tasks": positions
    }
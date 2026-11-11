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

    LEFT:
        seluruh rentang tugas sudah berada di kiri
        garis umur → usia > P90

    RIGHT:
        tugas berada di kanan garis umur
        → usia < P25

    INTERSECT:
        garis umur berada di dalam / menyentuh
        rentang tugas.
    """

    p25 = task.get("p25_month")
    p90 = task.get("p90_month")

    # P90 wajib tersedia untuk menentukan
    # apakah tugas sudah seluruhnya berada di kiri.
    if p90 is None:
        raise ValueError(
            f"P90 tidak tersedia untuk tugas {task['id']}"
        )

    p90 = float(p90)

    # Seluruh tugas berada di kiri garis umur
    if age_months > p90:
        return "LEFT"

    # Jika P25 tersedia dan usia masih sebelum P25,
    # tugas berada di kanan garis umur.
    if p25 is not None:
        p25 = float(p25)

        if age_months < p25:
            return "RIGHT"

    # Selain kondisi di atas:
    # garis umur berpotongan / berada pada rentang tugas.
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
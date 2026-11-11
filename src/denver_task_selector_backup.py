from pathlib import Path
import json


DOMAINS = [
    "personal_social",
    "fine_motor_adaptive",
    "language",
    "gross_motor",
]


def load_denver_tasks(json_path: str | Path) -> list:
    """Membaca master tugas Denver II."""
    json_path = Path(json_path)

    with open(json_path, "r", encoding="utf-8") as file:
        tasks = json.load(file)

    if not isinstance(tasks, list):
        raise ValueError("Format denver_tasks.json harus berupa list.")

    if len(tasks) != 125:
        raise ValueError(
            f"Jumlah tugas harus 125, ditemukan {len(tasks)}."
        )

    return tasks


def get_task_position(age_months: float, task: dict) -> str:
    """
    Menentukan posisi tugas terhadap garis umur berdasarkan aturan 11.3C:
    LEFT = tugas seluruhnya di kiri garis umur (usia > P90)
    RIGHT = tugas seluruhnya di kanan garis umur (usia < P25)
    INTERSECT = garis umur memotong rentang tugas.
    """
    p25 = task.get("p25_month")
    p90 = task.get("p90_month")

    if p90 is None:
        raise ValueError(f"P90 tidak tersedia untuk tugas {task['id']}")

    p90 = float(p90)

    if age_months > p90:
        return "LEFT"

    if p25 is not None and age_months < float(p25):
        return "RIGHT"

    return "INTERSECT"


def select_initial_tasks_for_domain(age_months: float, tasks: list) -> list:
    """
    Memilih tugas awal untuk satu domain:
    1. Ambil 3 tugas yang seluruhnya berada di kiri garis umur dan paling dekat.
    2. Tambahkan SEMUA tugas yang dipotong garis umur.
    3. Tugas di kanan garis umur tidak dimasukkan.
    4. Hasil ditampilkan kembali menurut urutan master/chart.
    """
    indexed_tasks = list(enumerate(tasks))
    left_tasks = []
    intersecting_tasks = []

    for original_index, task in indexed_tasks:
        position = get_task_position(age_months, task)

        if position == "LEFT":
            p90 = float(task["p90_month"])
            distance = age_months - p90
            left_tasks.append((distance, original_index, task))

        elif position == "INTERSECT":
            intersecting_tasks.append((original_index, task))

    # Tiga item paling dekat dari sebelah kiri garis umur.
    left_tasks.sort(key=lambda item: (item[0], item[1]))
    selected_left = left_tasks[:3]

    # Semua item yang ditembus garis umur wajib disertakan.
    selected = [
        (index, task)
        for _, index, task in selected_left
    ]
    selected.extend(intersecting_tasks)

    # Urutan tampilan mengikuti urutan pada master Denver II.
    selected.sort(key=lambda item: item[0])

    results = []
    for _, task in selected:
        results.append({
            "id": task["id"],
            "domain": task["domain"],
            "name": task["name"],
            "reportable": task.get("reportable"),
            "footnote": task.get("footnote"),
            "has_detail": bool(task.get("footnote")),
            "p25_month": task.get("p25_month"),
            "p50_month": task.get("p50_month"),
            "p75_month": task.get("p75_month"),
            "p90_month": task.get("p90_month"),
            "position": get_task_position(age_months, task),
        })

    return results


def select_initial_tasks(age_months: float, tasks: list) -> dict:
    """Menghasilkan tugas awal untuk keempat domain Denver II."""
    if not tasks:
        raise ValueError("Daftar tugas Denver II tidak boleh kosong.")

    results = {}

    for domain in DOMAINS:
        domain_tasks = [
            task for task in tasks
            if task["domain"] == domain
        ]

        if not domain_tasks:
            raise ValueError(f"Domain {domain} tidak memiliki tugas.")

        results[domain] = select_initial_tasks_for_domain(
            age_months=age_months,
            tasks=domain_tasks,
        )

    return results


def get_initial_tasks(age_months: float, json_path: str | Path) -> dict:
    """Fungsi utama 11.3D: memilih tugas berdasarkan usia dan master JSON."""
    tasks = load_denver_tasks(json_path)
    return select_initial_tasks(age_months=age_months, tasks=tasks)


def get_next_task(
    age_months: float,
    domain: str,
    direction: str,
    excluded_ids: list[str] | set[str],
    json_path: str | Path,
) -> dict | None:
    """Mengambil satu tugas tambahan terdekat ke kiri/kanan yang belum dipakai."""
    if domain not in DOMAINS:
        raise ValueError(f"Domain tidak dikenal: {domain}")
    if direction not in {"LEFT", "RIGHT"}:
        raise ValueError("direction harus LEFT atau RIGHT.")

    excluded = set(excluded_ids or [])
    tasks = load_denver_tasks(json_path)
    candidates = []

    for index, task in enumerate(tasks):
        if task.get("domain") != domain or task.get("id") in excluded:
            continue
        position = get_task_position(age_months, task)
        if position != direction:
            continue

        if direction == "LEFT":
            distance = age_months - float(task["p90_month"])
        else:
            p25 = task.get("p25_month")
            if p25 is None:
                continue
            distance = float(p25) - age_months

        candidates.append((distance, index, task))

    if not candidates:
        return None

    candidates.sort(key=lambda item: (item[0], item[1]))
    task = candidates[0][2]
    return {
        "id": task["id"],
        "domain": task["domain"],
        "name": task["name"],
        "reportable": bool(task.get("reportable", False)),
        "footnote": task.get("footnote"),
        "has_detail": bool(task.get("footnote")),
        "p25_month": task.get("p25_month"),
        "p50_month": task.get("p50_month"),
        "p75_month": task.get("p75_month"),
        "p90_month": task.get("p90_month"),
        "position": direction,
    }

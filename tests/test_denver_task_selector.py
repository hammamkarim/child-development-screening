from pathlib import Path

from src.denver_task_selector import (
    DOMAINS,
    get_initial_tasks,
    get_task_position,
    load_denver_tasks,
    get_next_task,
)


ROOT_DIR = Path(__file__).resolve().parents[1]
JSON_PATH = ROOT_DIR / "data" / "denver" / "denver_tasks.json"

# Contoh usia dari pengujian sebelumnya: 1 tahun 2 bulan 14 hari.
AGE_MONTHS = 14 + (14 / 30)

tasks = load_denver_tasks(JSON_PATH)
print("TEST 1 — Master Denver II:", len(tasks), "tugas")
assert len(tasks) == 125

result = get_initial_tasks(AGE_MONTHS, JSON_PATH)
print("\nTEST 2 — Usia:", round(AGE_MONTHS, 4), "bulan")
assert set(result) == set(DOMAINS)

all_ids = []
for domain, selected in result.items():
    domain_master = [task for task in tasks if task["domain"] == domain]
    expected_intersect = {
        task["id"] for task in domain_master
        if get_task_position(AGE_MONTHS, task) == "INTERSECT"
    }
    selected_intersect = {
        task["id"] for task in selected
        if task["position"] == "INTERSECT"
    }
    selected_left = [
        task for task in selected
        if task["position"] == "LEFT"
    ]

    # Semua tugas yang ditembus garis umur harus dipilih.
    assert selected_intersect == expected_intersect
    # Maksimal 3 tugas di kiri, yaitu 3 terdekat yang tersedia.
    assert len(selected_left) == min(
        3,
        sum(get_task_position(AGE_MONTHS, task) == "LEFT"
            for task in domain_master)
    )

    for task in selected:
        assert "footnote" in task
        assert "has_detail" in task
        assert "reportable" in task
        all_ids.append(task["id"])

    print(f"\n[{domain}] total tugas awal: {len(selected)}")
    for i, task in enumerate(selected, 1):
        print(f"{i}. {task['id']} - {task['name']} [{task['position']}]")

assert len(all_ids) == len(set(all_ids)), "Ada ID tugas duplikat."
print("\nSEMUA TEST PEMILIHAN TUGAS AWAL BERHASIL.")


# Test 3 — tugas tambahan selalu berbeda dan sesuai arah yang diminta.
for domain in DOMAINS:
    initial = result[domain]
    excluded = [task["id"] for task in initial]
    left_next = get_next_task(AGE_MONTHS, domain, "LEFT", excluded, JSON_PATH)
    right_next = get_next_task(AGE_MONTHS, domain, "RIGHT", excluded, JSON_PATH)
    if left_next is not None:
        assert left_next["id"] not in excluded
        assert left_next["position"] == "LEFT"
    if right_next is not None:
        assert right_next["id"] not in excluded
        assert right_next["position"] == "RIGHT"
print("TEST 3 — pemilihan tugas tambahan kiri/kanan berhasil.")

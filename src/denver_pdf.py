"""Pembuatan PDF diagram Denver II dari master data yang sama dengan diagram web."""
from __future__ import annotations

import html
import re
from datetime import datetime
from pathlib import Path
from typing import Any

from flask import render_template
from weasyprint import HTML

DOMAIN_ORDER = [
    ("personal_social", "PERSONAL SOSIAL", "#39a96b"),
    ("fine_motor_adaptive", "ADAPTIF-MOTORIK HALUS", "#4f8ee8"),
    ("language", "BAHASA", "#f39a21"),
    ("gross_motor", "MOTORIK KASAR", "#8a65d6"),
]
SVG_WIDTH = 1800
LEFT = 205
RIGHT = 25
TOP = 72
ROW_HEIGHT = 18.2
DOMAIN_GAP = 6
AXIS_UNITS = 40  # 24 bulan pertama + 16 interval tiga bulanan hingga 72 bulan
SCALE = (SVG_WIDTH - LEFT - RIGHT) / AXIS_UNITS


def _esc(value: Any) -> str:
    return html.escape(str(value if value is not None else ""), quote=True)


def _num(value: Any) -> float | None:
    if value is None or value == "":
        return None
    try:
        number = float(value)
        return number if number == number and abs(number) != float("inf") else None
    except (TypeError, ValueError):
        return None


def _age_x_units(month: float) -> float:
    value = max(0.0, min(72.0, month))
    return value if value <= 24 else 24 + (value - 24) / 3


def _x(month: float) -> float:
    return LEFT + _age_x_units(month) * SCALE


def _date_id(value: Any) -> str:
    if not value:
        return ""
    try:
        date = datetime.strptime(str(value), "%Y-%m-%d")
        # Format tanggal numerik agar konsisten pada label garis umur dan metadata PDF.
        return date.strftime("%d-%m-%Y")
    except ValueError:
        return str(value)


def _task_id_number(task: dict) -> int:
    match = re.search(r"(\d+)$", str(task.get("id", "")))
    return int(match.group(1)) if match else 0


def _wrap_label(text: str, max_chars: int, max_lines: int = 2) -> list[str]:
    words = text.split()
    lines: list[str] = []
    current = ""
    for word in words:
        candidate = f"{current} {word}".strip()
        if current and len(candidate) > max_chars:
            lines.append(current)
            current = word
        else:
            current = candidate
    if current:
        lines.append(current)
    if len(lines) > max_lines:
        lines = lines[:max_lines]
        lines[-1] = lines[-1].rstrip(".,;:") + "…"
    return lines or [""]


def _text(x: float, y: float, value: str, *, size: float = 10, fill: str = "#263b2b", weight: int = 400, anchor: str | None = None) -> str:
    anchor_attr = f' text-anchor="{anchor}"' if anchor else ""
    return f'<text x="{x:.2f}" y="{y:.2f}" font-family="Arial, Helvetica, sans-serif" font-size="{size}" font-weight="{weight}" fill="{fill}"{anchor_attr}>{_esc(value)}</text>'


def _axis_markup(y: float, bottom: bool = False) -> str:
    end_x = SVG_WIDTH - RIGHT
    out = [f'<line x1="{LEFT}" y1="{y}" x2="{end_x}" y2="{y}" stroke="#7c8797" stroke-width="1.3"/>']
    month_labels = {2: "2", 4: "4", 6: "6", 9: "9", 12: "12", 15: "15", 18: "18", 24: "24"}
    year_labels = {36: "3", 48: "4", 60: "5", 72: "6"}
    ticks = list(range(1, 25)) + list(range(27, 73, 3))
    for month in ticks:
        x = _x(month)
        out.append(f'<line x1="{x:.2f}" y1="{y-4}" x2="{x:.2f}" y2="{y+4}" stroke="#697586" stroke-width="1"/>')
        label = month_labels.get(month, year_labels.get(month))
        if label:
            label_y = y + 15 if bottom else y - 9
            out.append(_text(x, label_y, label, size=14, fill="#3e4856", anchor="middle"))
    if not bottom:
        out.append(_text(LEFT, y - 24, "BULAN", size=14, fill="#536071", weight=700))
        out.append(_text(_x(36), y - 24, "TAHUN", size=14, fill="#536071", weight=700))
    else:
        out.append(_text(LEFT, y + 30, "BULAN", size=14, fill="#536071", weight=700))
        out.append(_text(_x(36), y + 30, "TAHUN", size=14, fill="#536071", weight=700))
    return "".join(out)


def build_diagram_svg(
    tasks: list[dict],
    age_months: float | None,
    initial_ids: set[str],
    screening_date: str = "",
    domain_keys: set[str] | None = None,
    answers: dict[str, str] | None = None,
) -> str:
    domain_rows: list[dict] = []
    y = TOP
    for key, label, color in DOMAIN_ORDER:
        domain_tasks = [task for task in tasks if task.get("domain") == key and (domain_keys is None or key in domain_keys)]
        # ID terbesar di atas dan ID terkecil di bawah, sesuai susunan diagram web.
        domain_tasks.sort(key=_task_id_number, reverse=True)
        height = len(domain_tasks) * ROW_HEIGHT + 14
        domain_rows.append({"key": key, "label": label, "color": color, "tasks": domain_tasks, "y": y, "height": height})
        y += height + DOMAIN_GAP
    bottom_axis_y = y + 2
    total_height = bottom_axis_y + 36

    out = [f'<svg xmlns="http://www.w3.org/2000/svg" width="{SVG_WIDTH}" height="{total_height}" viewBox="0 0 {SVG_WIDTH} {total_height}">']
    out.append('<rect width="100%" height="100%" fill="#ffffff"/>')
    out.append('<defs><pattern id="percentileHatch" width="5" height="5" patternUnits="userSpaceOnUse" patternTransform="rotate(35)"><rect width="5" height="5" fill="#ccebd2"/><line x1="0" y1="0" x2="0" y2="5" stroke="#9bd4a4" stroke-width="1.3"/></pattern></defs>')
    out.append(_axis_markup(64, bottom=False))

    # Kisi vertikal pada label umur utama.
    major_months = [2, 4, 6, 9, 12, 15, 18, 24, 36, 48, 60, 72]
    for month in major_months:
        x = _x(month)
        out.append(f'<line x1="{x:.2f}" y1="71" x2="{x:.2f}" y2="{bottom_axis_y-3}" stroke="#e5e9ef" stroke-width="0.8"/>')

    for domain_index, domain in enumerate(domain_rows):
        dy = domain["y"]
        dh = domain["height"]
        bg = "#ffffff" if domain_index % 2 == 0 else "#fbfcfe"
        out.append(f'<rect x="0" y="{dy-3}" width="{SVG_WIDTH}" height="{dh}" fill="{bg}" stroke="#e1e7ef" stroke-width="0.8"/>')
        out.append(f'<rect x="0" y="{dy-3}" width="{LEFT-8}" height="{dh}" fill="#f4f7fb"/>')
        out.append(_text(12, dy + 9, domain["label"], size=13.5, fill=domain["color"], weight=700))
        for index, task in enumerate(domain["tasks"]):
            row_y = dy + index * ROW_HEIGHT + 1
            p25 = _num(task.get("p25_month"))
            p50 = _num(task.get("p50_month"))
            p75 = _num(task.get("p75_month"))
            p90 = _num(task.get("p90_month"))
            available = [v for v in (p25, p50, p75, p90) if v is not None]
            if not available:
                continue
            start = available[0]
            end = p90 if p90 is not None else available[-1]
            if end < start:
                start, end = end, start
            x_start = _x(start)
            x_end = _x(end)
            # Kotak tugas membentang sampai P90; label boleh berada di atas area hijau.
            actual_box_width = max(0.0, x_end - x_start)
            task_id = str(task.get("id", ""))
            # Lima tugas awal ini memang hanya memiliki P90 pada master Denver II.
            # Tampilkan kotaknya dengan warna hijau penuh seperti diagram web.
            # Untuk P90=0, beri lebar visual minimum agar kotak tidak nyaris hilang;
            # nilai persentil dan koordinat marker tetap tidak diubah.
            full_green_task_ids = {"PS_001", "L_001", "L_002", "GM_001", "GM_002"}
            is_full_green = task_id in full_green_task_ids
            minimum_box_width = 22.0 if is_full_green else 8.0
            box_width = max(minimum_box_width, actual_box_width)
            is_initial = task_id in initial_ids
            answer = (answers or {}).get(task_id)
            is_additional_checked = bool(answer and not is_initial)
            border = "#3475ee" if is_initial else ("#ff873e" if is_additional_checked else "#7cbd88")
            fill = "#eaf1ff" if is_initial else ("#fffaf6" if is_additional_checked else ("#ccebd2" if is_full_green else "#ffffff"))
            stroke_width = 1.8 if is_initial or is_additional_checked else 0.8
            box_height = 16.8
            out.append(f'<g><title>{_esc(task.get("name", ""))}</title>')
            out.append(f'<rect x="{x_start:.2f}" y="{row_y:.2f}" width="{box_width:.2f}" height="{box_height:.2f}" fill="{fill}" stroke="{border}" stroke-width="{stroke_width}"/>')
            # Arsiran hijau tetap menunjukkan rentang P75-P90.
            if p75 is not None and end > p75:
                out.append(f'<rect x="{_x(p75):.2f}" y="{row_y:.2f}" width="{max(1, x_end-_x(p75)):.2f}" height="{box_height:.2f}" fill="#ccebd2" stroke="{border}" stroke-width="{0.9 if is_initial or is_additional_checked else 0.5}"/>')
            # P50 dan tanda L ditempatkan di bagian atas; teks tugas di bagian bawah.
            if p50 is not None:
                out.append(f'<line x1="{_x(p50):.2f}" y1="{row_y+0.8:.2f}" x2="{_x(p50):.2f}" y2="{row_y+4.8:.2f}" stroke="#222222" stroke-width="0.9"/>')
            name = str(task.get("name", ""))
            # Untuk kotak yang cukup lebar, letakkan nama di bagian bawah kotak.
            # Sisakan ruang di atas untuk penanda P50 dan L.
            label_inside = actual_box_width >= 82
            if label_inside:
                label_x = x_start + 3
                label_width = actual_box_width - 6
                max_chars = max(6, int(label_width / 5.0))
                lines = _wrap_label(name, max_chars, 2)
                font_size = 8.2
                if len(lines) == 1:
                    first_y = row_y + 14.2
                else:
                    first_y = row_y + 8.8
                out.append(
                    f'<text x="{label_x:.2f}" y="{first_y:.2f}" '
                    f'font-family="Arial, Helvetica, sans-serif" font-size="{font_size}" '
                    f'font-weight="600" fill="#263b2b">'
                )
                out.append(f'<tspan x="{label_x:.2f}" dy="0">{_esc(lines[0])}</tspan>')
                if len(lines) > 1:
                    out.append(f'<tspan x="{label_x:.2f}" dy="6.4">{_esc(lines[1])}</tspan>')
                out.append('</text>')
            else:
                # Untuk kotak yang terlalu pendek, nama harus benar-benar berada
                # di luar kotak. Gunakan tepi kotak yang terlihat (box_width),
                # bukan x_end data persentil, agar teks tidak menimpa kotak mini.
                right_limit = SVG_WIDTH - RIGHT - 2
                left_limit = LEFT + 2
                visible_box_right = x_start + box_width
                right_space = max(0.0, right_limit - (visible_box_right + 4))
                left_space = max(0.0, x_start - 4 - left_limit)

                if right_space >= 55 or right_space >= left_space:
                    label_x = visible_box_right + 4
                    available_width = right_space
                    anchor = "start"
                else:
                    label_x = x_start - 4
                    available_width = left_space
                    anchor = "end"

                # Label maksimal dua baris dan tidak diberi latar putih, karena
                # latar tersebut sebelumnya menutupi garis/border kotak tugas.
                max_chars = max(5, min(30, int(available_width / 4.8)))
                lines = _wrap_label(name, max_chars, 2)
                font_size = 8.0
                first_y = row_y + (8.2 if len(lines) > 1 else 12.5)
                out.append(
                    f'<text x="{label_x:.2f}" y="{first_y:.2f}" '
                    f'text-anchor="{anchor}" font-family="Arial, Helvetica, sans-serif" '
                    f'font-size="{font_size}" font-weight="600" fill="#263b2b">'
                )
                out.append(f'<tspan x="{label_x:.2f}" dy="0">{_esc(lines[0])}</tspan>')
                if len(lines) > 1:
                    out.append(f'<tspan x="{label_x:.2f}" dy="6.4">{_esc(lines[1])}</tspan>')
                out.append('</text>')
            if answer in {"P", "F"}:
                badge_x = max(LEFT - 19, x_start - 18)
                badge_fill = "#dcfce7" if answer == "P" else "#fee2e2"
                badge_stroke = "#86d49b" if answer == "P" else "#fca5a5"
                badge_text = "#166534" if answer == "P" else "#b91c1c"
                out.append(f'<rect x="{badge_x:.2f}" y="{row_y+2.2:.2f}" width="14" height="12.2" rx="2.2" fill="{badge_fill}" stroke="{badge_stroke}" stroke-width="0.7"/>')
                out.append(_text(badge_x + 7, row_y + 10.7, answer, size=7.5, fill=badge_text, weight=800, anchor="middle"))
            if task.get("reportable"):
                # Penanda L berada di bagian atas agar tidak menutupi nama tugas.
                if actual_box_width < 18:
                    # Untuk item dengan rentang sangat pendek, tempatkan L di
                    # bagian kiri kotak mini agar tidak bertabrakan dengan label samping.
                    lx = x_start + 0.7
                    marker_width = 6.0
                    marker_height = 6.2
                else:
                    lx = min(SVG_WIDTH - 18, max(x_start + 2, x_end - 11))
                    marker_width = 8.5
                    marker_height = 7.2
                out.append(f'<rect x="{lx:.2f}" y="{row_y+0.5:.2f}" width="{marker_width}" height="{marker_height}" rx="1.2" fill="#fff0df" stroke="#ed9b4c" stroke-width="0.6"/>')
                out.append(_text(lx + marker_width / 2, row_y + 5.3, "L", size=5.2, fill="#a9580e", weight=800, anchor="middle"))
            out.append('</g>')

    if age_months is not None:
        age_x = _x(age_months)
        out.append(f'<line x1="{age_x:.2f}" y1="32" x2="{age_x:.2f}" y2="{bottom_axis_y+2}" stroke="#3475ee" stroke-width="2" stroke-dasharray="6 4"/>')
        date_label = _date_id(screening_date) or "Usia anak"
        label_width = max(90, min(150, len(date_label) * 7.0 + 18))
        label_x = max(LEFT, min(SVG_WIDTH - RIGHT - label_width, age_x - label_width / 2))
        out.append(f'<rect x="{label_x:.2f}" y="4" width="{label_width:.2f}" height="21" rx="3" fill="#3475ee"/>')
        out.append(_text(label_x + label_width/2, 18, date_label, size=10, fill="#ffffff", weight=700, anchor="middle"))
    out.append(_axis_markup(bottom_axis_y, bottom=True))
    out.append('</svg>')
    return "".join(out)


def create_diagram_pdf(
    tasks: list[dict],
    child: dict | None,
    age: dict | None,
    initial_ids: set[str],
    answers: dict[str, str] | None = None,
    show_result_legend: bool = False,
) -> bytes:
    """Membuat PDF Denver II satu halaman A3 portrait dengan diagram penuh."""
    valid_child = child if isinstance(child, dict) and isinstance(age, dict) else None
    age_months = None
    if valid_child and age:
        try:
            years, months, days = int(age["years"]), int(age["months"]), int(age["days"])
            if min(years, months, days) >= 0:
                age_months = years * 12 + months + days / 30
            else:
                valid_child = None
        except (KeyError, TypeError, ValueError):
            valid_child = None
    if valid_child is None:
        age_months = None
        initial_ids = set()

    svg = build_diagram_svg(
        tasks=tasks,
        age_months=age_months,
        initial_ids=initial_ids,
        screening_date=(valid_child or {}).get("screening_date", ""),
        answers=answers,
    )
    context = {
        "svg": svg,
        "examiner_name": (valid_child or {}).get("examiner_name", "") or "",
        "screening_date": _date_id((valid_child or {}).get("screening_date", "")),
        "child_name": (valid_child or {}).get("child_name", "") or "",
        "birth_date": _date_id((valid_child or {}).get("birth_date", "")),
        "has_child": bool(valid_child),
        "show_result_legend": show_result_legend,
    }
    html_content = render_template("diagram_pdf.html", **context)
    return HTML(string=html_content).write_pdf()


REPORT_DOMAIN_ORDER = [
    ("personal_social", "Personal Sosial"),
    ("fine_motor_adaptive", "Adaptif-Motorik Halus"),
    ("language", "Bahasa"),
    ("gross_motor", "Motorik Kasar"),
]
REPORT_STATUS_LABELS = {
    "advanced": "Advanced",
    "normal": "Normal",
    "caution": "Caution",
    "delayed": "Delayed",
}


def create_screening_report_pdf(
    tasks: list[dict],
    screening: dict,
    initial_ids: set[str],
    answers: dict[str, str],
    domain_statuses: dict[str, str],
    ai_result: dict,
) -> bytes:
    """Membuat laporan PDF portrait: halaman pertama diagram detail, berikutnya ringkasan."""
    child = screening.get("child") or {}
    age = screening.get("age") or {}
    domains = screening.get("domains") or {}
    age_months = int(age["years"]) * 12 + int(age["months"]) + int(age["days"]) / 30
    svg = build_diagram_svg(
        tasks=tasks,
        age_months=age_months,
        initial_ids=initial_ids,
        screening_date=child.get("screening_date", ""),
        answers=answers,
    )

    domain_rows = []
    total_pass = 0
    total_fail = 0
    for key, fallback_name in REPORT_DOMAIN_ORDER:
        item = domains.get(key) or {}
        passed = int(item.get("pass") or 0)
        failed = int(item.get("fail") or 0)
        total_pass += passed
        total_fail += failed
        domain_rows.append({
            "name": item.get("name") or fallback_name,
            "pass": passed,
            "fail": failed,
            "status": REPORT_STATUS_LABELS.get(domain_statuses.get(key), "Belum dapat ditentukan"),
            "status_key": domain_statuses.get(key, "unknown"),
        })

    age_label = f"{age.get('years', 0)} Tahun {age.get('months', 0)} Bulan {age.get('days', 0)} Hari"
    premature = child.get("premature")
    premature_weeks = child.get("premature_weeks")
    if premature == "yes":
        premature_label = f"Ya ({premature_weeks} minggu)" if premature_weeks else "Ya"
    elif premature == "no":
        premature_label = "Tidak"
    else:
        premature_label = "—"

    context = {
        "svg": svg,
        "examiner_name": child.get("examiner_name") or "—",
        "screening_date": _date_id(child.get("screening_date", "")) or "—",
        "child_name": child.get("child_name") or "—",
        "birth_date": _date_id(child.get("birth_date", "")) or "—",
        "gender": child.get("gender") or "—",
        "age_label": age_label,
        "weight": f"{child.get('weight')} kg" if child.get("weight") not in (None, "") else "—",
        "height": f"{child.get('height')} cm" if child.get("height") not in (None, "") else "—",
        "premature_label": premature_label,
        "domain_rows": domain_rows,
        "total_tasks": total_pass + total_fail,
        "total_pass": total_pass,
        "total_fail": total_fail,
        "final_status": ai_result.get("status_label") or str(ai_result.get("status", "")).upper() or "—",
        "final_status_key": ai_result.get("status", ""),
        "final_description": ai_result.get("description") or "—",
        "recommendation": ai_result.get("recommendation") or "—",
        
        "normal_probability": (
            f"{ai_result['probabilities']['normal'] * 100:.2f}%"
            if ai_result.get("probabilities")
            else "—"
        ),
        "suspect_probability": (
            f"{ai_result['probabilities']['suspect'] * 100:.2f}%"
            if ai_result.get("probabilities")
            else "—"
        ),
        
    }
    html_content = render_template("report_pdf.html", **context)
    return HTML(string=html_content).write_pdf()

from flask import Flask, render_template

from src.prediction_pipeline import ChildDevelopmentPipeline

from datetime import datetime
from flask import request, jsonify, send_file

from src.age_calculator import calculate_denver_age
from src.denver_task_selector import get_initial_tasks, get_next_task
from pathlib import Path
import json
import math
import re
import hashlib
from io import BytesIO


app = Flask(
    __name__,
    template_folder="web/templates",
    static_folder="web/static"
)


# Load AI pipeline
pipeline = ChildDevelopmentPipeline()


# Master tugas Denver II
DENVER_TASKS_PATH = (
    Path(__file__).resolve().parent
    / "data"
    / "denver"
    / "denver_tasks.json"
)

# Penyimpanan hasil pemeriksaan aktif untuk prototipe lokal.
# File disimpan di folder instance agar tidak bercampur dengan source code.
SAVED_SCREENING_PATH = Path(app.instance_path) / "saved_screening.json"
AI_ANALYSIS_CACHE_PATH = Path(app.instance_path) / "ai_analysis_cache.json"
REQUIRED_AI_DOMAIN_KEYS = (
    "personal_social",
    "fine_motor_adaptive",
    "language",
    "gross_motor",
)
ALLOWED_AI_DOMAIN_STATUSES = {"advanced", "normal", "caution", "delayed"}


def normalize_ai_domain_statuses(domain_statuses):
    """Validasi dan normalisasi empat status domain yang akan masuk ke model."""
    if not isinstance(domain_statuses, dict):
        raise ValueError("Status empat domain belum tersedia.")

    normalized = {}
    for key in REQUIRED_AI_DOMAIN_KEYS:
        status = str(domain_statuses.get(key, "")).strip().lower()
        if status not in ALLOWED_AI_DOMAIN_STATUSES:
            raise ValueError(
                f"Status domain {key.replace('_', ' ')} belum dapat ditentukan. "
                "Periksa hasil interpretasi domain terlebih dahulu."
            )
        normalized[key] = status
    return normalized


def load_saved_screening():
    if not SAVED_SCREENING_PATH.exists():
        return None
    with SAVED_SCREENING_PATH.open("r", encoding="utf-8") as file:
        return json.load(file)


def make_ai_analysis_fingerprint(screening, normalized_statuses):
    """Fingerprint hanya untuk input yang dapat memengaruhi hasil AI."""
    child = screening.get("child") or {}
    age = screening.get("age") or {}
    domains = screening.get("domains") or {}
    relevant_data = {
        # bagian ini akan di ubah saat logika pemrosesan/validasi AI berubah.
        "analysis_version": "positive-measurements-no-range-warning-v3",
        "age": {
            "years": age.get("years"),
            "months": age.get("months"),
            "days": age.get("days"),
        },
        "measurements": {
            "weight": child.get("weight"),
            "height": child.get("height"),
        },
        # Sertakan jawaban/isi domain, bukan hanya label akhirnya, supaya perubahan
        # jawaban tugas membatalkan hasil AI lama meskipun label domain kebetulan sama.
        "domains": {key: domains.get(key) for key in REQUIRED_AI_DOMAIN_KEYS},
        "domain_statuses": normalized_statuses,
    }
    canonical = json.dumps(relevant_data, ensure_ascii=False, sort_keys=True, default=str, separators=(",", ":"))
    return hashlib.sha256(canonical.encode("utf-8")).hexdigest()


def read_cached_ai_result(fingerprint):
    try:
        if not AI_ANALYSIS_CACHE_PATH.exists():
            return None
        with AI_ANALYSIS_CACHE_PATH.open("r", encoding="utf-8") as file:
            cached = json.load(file)
        if cached.get("fingerprint") == fingerprint and isinstance(cached.get("result"), dict):
            return cached["result"]
    except (OSError, ValueError, TypeError):
        app.logger.warning("Cache hasil AI tidak dapat dibaca; analisis akan dijalankan ulang.", exc_info=True)
    return None


def save_cached_ai_result(fingerprint, result):
    AI_ANALYSIS_CACHE_PATH.parent.mkdir(parents=True, exist_ok=True)
    temporary_path = AI_ANALYSIS_CACHE_PATH.with_suffix(".tmp")
    with temporary_path.open("w", encoding="utf-8") as file:
        json.dump({"fingerprint": fingerprint, "result": result}, file, ensure_ascii=False, indent=2)
    temporary_path.replace(AI_ANALYSIS_CACHE_PATH)


@app.route("/api/screening/current", methods=["GET"])
def get_current_screening():
    """Mengambil hasil pemeriksaan yang terakhir disimpan."""
    try:
        if not SAVED_SCREENING_PATH.exists():
            return jsonify({"success": True, "saved": False, "screening": None})
        with SAVED_SCREENING_PATH.open("r", encoding="utf-8") as file:
            screening = json.load(file)
        return jsonify({"success": True, "saved": True, "screening": screening})
    except Exception:
        app.logger.exception("Gagal membaca hasil pemeriksaan tersimpan")
        return jsonify({"success": False, "message": "Hasil pemeriksaan gagal dibaca."}), 500


@app.route("/api/ai/cached-result", methods=["POST"])
def get_cached_ai_result():
    """Mengembalikan hasil AI tersimpan hanya jika input pemeriksaan masih sama."""
    try:
        payload = request.get_json(silent=True) or {}
        normalized_statuses = normalize_ai_domain_statuses(payload.get("domain_statuses"))
        screening = load_saved_screening()
        if screening is None:
            return jsonify({"success": True, "cached": False})

        fingerprint = make_ai_analysis_fingerprint(screening, normalized_statuses)
        cached_result = read_cached_ai_result(fingerprint)
        if cached_result is None:
            return jsonify({"success": True, "cached": False})
        return jsonify({"success": True, "cached": True, "result": cached_result})
    except ValueError as error:
        return jsonify({"success": False, "message": str(error)}), 400
    except Exception:
        app.logger.exception("Gagal memeriksa cache hasil AI")
        return jsonify({"success": False, "message": "Hasil analisis tersimpan gagal diperiksa."}), 500


@app.route("/api/ai/analyze", methods=["POST"])
def analyze_screening_with_ai():
    """Memetakan input anak ke fitur model lalu menjalankan pipeline CatBoost + TransE."""
    try:
        payload = request.get_json(silent=True) or {}
        normalized_statuses = normalize_ai_domain_statuses(payload.get("domain_statuses"))

        screening = load_saved_screening()
        if screening is None:
            return jsonify({"success": False, "message": "Hasil pemeriksaan belum tersimpan."}), 404

        fingerprint = make_ai_analysis_fingerprint(screening, normalized_statuses)
        cached_result = read_cached_ai_result(fingerprint)
        if cached_result is not None:
            return jsonify({**cached_result, "cached": True})

        child = screening.get("child") or {}
        age = screening.get("age") or {}
        try:
            years = int(age["years"])
            months = int(age["months"])
            days = int(age["days"])
        except (KeyError, TypeError, ValueError):
            return jsonify({"success": False, "message": "Data usia anak tidak lengkap."}), 400

        if years < 0 or not 0 <= months < 12 or not 0 <= days < 30:
            return jsonify({"success": False, "message": "Format usia anak tidak valid."}), 400

        # Age Range Mapping dari tabel pengguna:
        # 0 <= usia < 12 bulan -> 0 tahun; 12 <= usia < 24 -> 1 tahun; dst.
        # Model dilatih dengan fitur age yang dinormalisasi menjadi 0, 0.2, ..., 1.
        total_age_months = years * 12 + months + (days / 30.0)
        # Age Range Mapping:
        # 0 <= usia < 12 bulan -> 0 tahun; 12 <= usia < 24 -> 1 tahun; dst.
        # Kategori 5 tahun mencakup 60 sampai 73,2 bulan (inklusif).
        if not 0 <= total_age_months <= 73.2 + 1e-9:
            return jsonify({
                "success": False,
                "message": "Model mendukung usia 0 sampai maksimal 73,2 bulan (6 tahun 1 bulan 6 hari)."
            }), 400
        age_category = min(int(total_age_months // 12), 5)

        def parse_measurement(value, label):
            try:
                number = float(str(value).strip().replace(",", "."))
            except (TypeError, ValueError):
                raise ValueError(f"{label} anak belum diisi dengan angka yang valid.")
            if not math.isfinite(number) or number <= 0:
                raise ValueError(f"{label} anak harus berupa angka positif.")
            return number

        weight = parse_measurement(child.get("weight"), "Berat badan")
        height = parse_measurement(child.get("height"), "Tinggi badan")

        # Rentang min–max mengikuti dataset pelatihan: berat 3–20 kg, tinggi 50–120 cm.
        # Nilai diskalakan ke [0,1], sesuai fitur asli yang dipakai saat melatih pipeline.
        weight_scaled = min(1.0, max(0.0, (weight - 3.0) / 17.0))
        height_scaled = min(1.0, max(0.0, (height - 50.0) / 70.0))

        model_input = {
            "weight": weight_scaled,
            "height": height_scaled,
            "age": age_category / 5.0,
            "gross_motor": normalized_statuses["gross_motor"],
            "fine_motor_adaptive": normalized_statuses["fine_motor_adaptive"],
            "language": normalized_statuses["language"],
            "personal_social": normalized_statuses["personal_social"],
        }

        prediction = str(pipeline.predict(model_input)[0]).strip().lower()
        
        # Mengambil probabilitas prediksi untuk setiap kelas
        probability_values = pipeline.predict_proba(model_input)[0]

        # Menghubungkan probabilitas dengan nama kelas CatBoost
        class_probabilities = {
            str(class_name).lower(): float(probability)
            for class_name, probability in zip(
                pipeline.catboost_model.classes_,
                probability_values
            )
        }

        normal_probability = class_probabilities["normal"]
        suspect_probability = class_probabilities["suspect"]
        
        if prediction not in {"normal", "suspect"}:
            app.logger.error("Pipeline mengembalikan label tidak dikenal: %r", prediction)
            return jsonify({"success": False, "message": "Model mengembalikan hasil yang tidak dikenali."}), 500

        if prediction == "suspect":
            description = "Anak terdeteksi memiliki risiko keterlambatan perkembangan."
            recommendation = (
                "Disarankan untuk melakukan pemeriksaan diagnosis perkembangan lanjutan "
                "guna memastikan faktor risiko, serta tetap melakukan stimulasi perkembangan "
                "secara berkelanjutan."
            )
        else:
            description = "Hasil skrining menunjukkan status perkembangan Normal."
            recommendation = (
                "Lanjutkan stimulasi sesuai usia dan lakukan pemantauan perkembangan anak secara berkala. "
                "Konsultasikan dengan tenaga kesehatan jika muncul kekhawatiran."
            )

        result_data = {
            "success": True,
            "status": prediction,
            "status_label": prediction.upper(),
            "description": description,
            "recommendation": recommendation,
            
            "probabilities": {
            "normal": normal_probability,
            "suspect": suspect_probability
            },
            
            "age_mapping": {
                "age_months": round(total_age_months, 2),
                "age_category": age_category,
                "age_category_label": f"{age_category} tahun"
            }
        }
        save_cached_ai_result(fingerprint, result_data)
        return jsonify({**result_data, "cached": False})
    except ValueError as error:
        return jsonify({"success": False, "message": str(error)}), 400
    except Exception:
        app.logger.exception("Gagal menjalankan pipeline AI untuk kesimpulan akhir")
        return jsonify({
            "success": False,
            "message": "Analisis AI gagal dijalankan. Periksa dependensi dan artefak model, lalu coba kembali."
        }), 500


@app.route("/api/screening/save", methods=["POST"])
def save_current_screening():
    """Menyimpan data anak dan hasil P/F untuk ditampilkan di halaman hasil."""
    try:
        payload = request.get_json(silent=True)
        if not isinstance(payload, dict):
            return jsonify({"success": False, "message": "Data pemeriksaan tidak valid."}), 400

        child = payload.get("child")
        age = payload.get("age")
        domains = payload.get("domains")
        if not isinstance(child, dict) or not isinstance(age, dict) or not isinstance(domains, dict):
            return jsonify({"success": False, "message": "Data anak, usia, atau hasil domain belum lengkap."}), 400

        # Validasi usia di backend agar data di luar rentang tidak bisa disimpan
        # meskipun endpoint dipanggil tanpa melalui validasi halaman input.
        try:
            age_years = int(age["years"])
            age_months = int(age["months"])
            age_days = int(age["days"])
        except (KeyError, TypeError, ValueError):
            return jsonify({"success": False, "message": "Data usia anak tidak lengkap atau tidak valid."}), 400

        if age_years < 0 or not 0 <= age_months < 12 or not 0 <= age_days < 30:
            return jsonify({"success": False, "message": "Format usia anak tidak valid."}), 400

        total_age_months = age_years * 12 + age_months + age_days / 30.0
        if total_age_months > 73.2 + 1e-9:
            return jsonify({
                "success": False,
                "message": "Data tidak dapat disimpan. Usia maksimal pemeriksaan adalah 73,2 bulan (6 tahun 1 bulan 6 hari)."
            }), 400

        required_domains = {
            "personal_social",
            "fine_motor_adaptive",
            "language",
            "gross_motor",
        }
        if not required_domains.issubset(domains.keys()):
            return jsonify({
                "success": False,
                "message": "Pemeriksaan belum lengkap. Pastikan keempat domain Denver II tersedia."
            }), 400

        incomplete_domains = []
        for domain_key in required_domains:
            item = domains.get(domain_key)
            if not isinstance(item, dict):
                incomplete_domains.append(domain_key)
                continue

            is_terminal = bool(item.get("completed") or item.get("exhausted"))
            answered = int(item.get("answered") or 0)
            total_displayed = int(item.get("total_displayed") or 0)
            if not is_terminal or answered <= 0 or answered != total_displayed:
                incomplete_domains.append(domain_key)

        if incomplete_domains:
            return jsonify({
                "success": False,
                "message": "Pemeriksaan belum selesai pada domain: " + ", ".join(incomplete_domains)
            }), 400

        if not any(isinstance(item, dict) and (item.get("pass", 0) or item.get("fail", 0)) for item in domains.values()):
            return jsonify({"success": False, "message": "Belum ada hasil P/F yang dapat disimpan."}), 400

        SAVED_SCREENING_PATH.parent.mkdir(parents=True, exist_ok=True)
        temporary_path = SAVED_SCREENING_PATH.with_suffix(".tmp")
        with temporary_path.open("w", encoding="utf-8") as file:
            json.dump(payload, file, ensure_ascii=False, indent=2)
        temporary_path.replace(SAVED_SCREENING_PATH)

        return jsonify({"success": True, "message": "Hasil pemeriksaan terbaru berhasil disimpan."})
    except Exception:
        app.logger.exception("Gagal menyimpan hasil pemeriksaan")
        return jsonify({"success": False, "message": "Hasil pemeriksaan gagal disimpan."}), 500


@app.route("/")
def index():
    return render_template("index.html")


@app.route("/diagram")
def diagram():
    return render_template("diagram.html")


@app.route("/result")
def result():
    return render_template("result.html")


@app.route("/detail")
def detail():
    return render_template("detail.html")

@app.route("/api/denver/initial-tasks", methods=["POST"])
def initial_tasks_api():

    try:
        data = request.get_json(silent=True) or {}
        age = data.get("age")

        if not isinstance(age, dict):
            raise ValueError("Data usia final tidak ditemukan.")

        years = int(age["years"])
        months = int(age["months"])
        days = int(age["days"])

        if years < 0 or months < 0 or days < 0:
            raise ValueError("Komponen usia tidak boleh negatif.")

        age_months = (years * 12) + months + (days / 30)

        tasks = get_initial_tasks(
            age_months=age_months,
            json_path=DENVER_TASKS_PATH
        )

        return jsonify({
            "success": True,
            "age_months": age_months,
            "tasks": tasks
        })

    except Exception as e:
        return jsonify({
            "success": False,
            "message": str(e)
        }), 400


@app.route("/api/denver/next-task", methods=["POST"])
def next_task_api():
    """Mengembalikan satu tugas tambahan yang paling dekat sesuai arah pemeriksaan."""
    try:
        data = request.get_json(silent=True) or {}
        age = data.get("age")
        if not isinstance(age, dict):
            raise ValueError("Data usia final tidak ditemukan.")

        years = int(age["years"])
        months = int(age["months"])
        days = int(age["days"])
        if min(years, months, days) < 0:
            raise ValueError("Komponen usia tidak boleh negatif.")
        age_months = years * 12 + months + days / 30

        domain = data.get("domain")
        direction = data.get("direction")
        excluded_ids = data.get("excluded_ids", [])
        if not isinstance(excluded_ids, list):
            raise ValueError("excluded_ids harus berupa list.")

        task = get_next_task(
            age_months=age_months,
            domain=domain,
            direction=direction,
            excluded_ids=excluded_ids,
            json_path=DENVER_TASKS_PATH,
        )
        return jsonify({"success": True, "task": task})
    except (KeyError, TypeError, ValueError) as e:
        return jsonify({"success": False, "message": str(e)}), 400
    except Exception as e:
        app.logger.exception("Gagal mengambil tugas tambahan Denver II")
        return jsonify({"success": False, "message": "Terjadi kesalahan saat mengambil tugas tambahan."}), 500


@app.route("/api/denver/diagram-pdf", methods=["POST"])
def denver_diagram_pdf_api():
    """Membuat PDF A3 portrait dari master diagram Denver II."""
    try:
        from src.denver_pdf import create_diagram_pdf

        payload = request.get_json(silent=True) or {}
        child = payload.get("child")
        age = payload.get("age")
        raw_initial_ids = payload.get("initial_task_ids", [])
        if not isinstance(raw_initial_ids, list):
            raw_initial_ids = []

        with open(DENVER_TASKS_PATH, "r", encoding="utf-8") as file:
            tasks = json.load(file)
        if not isinstance(tasks, list) or len(tasks) != 125:
            raise ValueError("Master diagram Denver II harus berisi 125 tugas.")

        initial_ids = {str(item) for item in raw_initial_ids if isinstance(item, (str, int))}
        has_saved_data = isinstance(child, dict) and isinstance(age, dict)
        if has_saved_data and not initial_ids:
            age_months = int(age["years"]) * 12 + int(age["months"]) + int(age["days"]) / 30
            selected = get_initial_tasks(age_months=age_months, json_path=DENVER_TASKS_PATH)
            initial_ids = {str(task["id"]) for domain_tasks in selected.values() for task in domain_tasks}
        if not has_saved_data:
            child, age, initial_ids = None, None, set()

        pdf_bytes = create_diagram_pdf(tasks, child, age, initial_ids)
        return send_file(
            BytesIO(pdf_bytes),
            mimetype="application/pdf",
            as_attachment=True,
            download_name="diagram_denver_ii.pdf",
        )
    except Exception:
        app.logger.exception("Gagal membuat PDF diagram Denver II")
        return jsonify({"success": False, "message": "PDF gagal dibuat. Periksa dependensi WeasyPrint dan data diagram."}), 500




@app.route("/api/denver/detail-diagram-pdf", methods=["POST"])
def denver_detail_diagram_pdf_api():
    """Membuat PDF diagram Denver II dengan penanda hasil P/F pemeriksaan."""
    try:
        from src.denver_pdf import create_diagram_pdf

        screening = load_saved_screening()
        if not isinstance(screening, dict):
            return jsonify({"success": False, "message": "Belum ada pemeriksaan tersimpan."}), 400

        child = screening.get("child") or {}
        age = screening.get("age") or {}
        domains = screening.get("domains") or {}
        if not isinstance(child, dict) or not isinstance(age, dict):
            return jsonify({"success": False, "message": "Data anak atau usia pemeriksaan tidak lengkap."}), 400

        with open(DENVER_TASKS_PATH, "r", encoding="utf-8") as file:
            tasks = json.load(file)
        if not isinstance(tasks, list) or len(tasks) != 125:
            raise ValueError("Master diagram Denver II harus berisi 125 tugas.")

        age_months = int(age["years"]) * 12 + int(age["months"]) + int(age["days"]) / 30
        selected = get_initial_tasks(age_months=age_months, json_path=DENVER_TASKS_PATH)
        initial_ids = {str(task["id"]) for domain_tasks in selected.values() for task in domain_tasks}

        answers = {}
        for domain_state in domains.values():
            for task in (domain_state or {}).get("tasks", []):
                task_id = str(task.get("id", task.get("task_id", "")))
                answer = str(task.get("answer", "")).strip().upper()
                if task_id and answer in {"P", "F"}:
                    answers[task_id] = answer

        pdf_bytes = create_diagram_pdf(
            tasks, child, age, initial_ids,
            answers=answers,
            show_result_legend=False,
        )
        return send_file(
            BytesIO(pdf_bytes),
            mimetype="application/pdf",
            as_attachment=True,
            download_name="detail_diagram_pemeriksaan_denver_ii.pdf",
        )
    except Exception:
        app.logger.exception("Gagal membuat PDF detail diagram Denver II")
        return jsonify({"success": False, "message": "PDF detail gagal dibuat. Periksa dependensi WeasyPrint dan data pemeriksaan."}), 500


@app.route("/api/denver/report-pdf", methods=["POST"])
def denver_screening_report_pdf_api():
    """Mengunduh laporan skrining: diagram satu halaman, lalu ringkasan hasil."""
    try:
        from src.denver_pdf import create_screening_report_pdf

        payload = request.get_json(silent=True) or {}
        normalized_statuses = normalize_ai_domain_statuses(payload.get("domain_statuses"))
        screening = load_saved_screening()
        if not isinstance(screening, dict):
            return jsonify({"success": False, "message": "Belum ada hasil pemeriksaan tersimpan."}), 400

        # Pastikan kesimpulan AI sesuai dengan data dan interpretasi pemeriksaan terbaru.
        fingerprint = make_ai_analysis_fingerprint(screening, normalized_statuses)
        ai_result = read_cached_ai_result(fingerprint)
        if not isinstance(ai_result, dict):
            return jsonify({
                "success": False,
                "message": "Kesimpulan akhir belum tersedia atau data berubah. Jalankan analisis AI kembali sebelum menyimpan laporan."
            }), 400

        with open(DENVER_TASKS_PATH, "r", encoding="utf-8") as file:
            tasks = json.load(file)
        if not isinstance(tasks, list) or len(tasks) != 125:
            raise ValueError("Master diagram Denver II harus berisi 125 tugas.")

        child = screening.get("child") or {}
        age = screening.get("age") or {}
        domains = screening.get("domains") or {}
        age_months = int(age["years"]) * 12 + int(age["months"]) + int(age["days"]) / 30
        selected = get_initial_tasks(age_months=age_months, json_path=DENVER_TASKS_PATH)
        initial_ids = {str(task["id"]) for domain_tasks in selected.values() for task in domain_tasks}

        answers = {}
        for domain_state in domains.values():
            for task in (domain_state or {}).get("tasks", []):
                task_id = str(task.get("id", task.get("task_id", "")))
                answer = str(task.get("answer", "")).strip().upper()
                if task_id and answer in {"P", "F"}:
                    answers[task_id] = answer

        pdf_bytes = create_screening_report_pdf(
            tasks=tasks,
            screening=screening,
            initial_ids=initial_ids,
            answers=answers,
            domain_statuses=normalized_statuses,
            ai_result=ai_result,
        )
        child_name = str(child.get("child_name") or "anak").strip()
        safe_name = re.sub(r"[^A-Za-z0-9_-]+", "_", child_name).strip("_") or "anak"
        return send_file(
            BytesIO(pdf_bytes),
            mimetype="application/pdf",
            as_attachment=True,
            download_name=f"laporan_denver_ii_{safe_name}.pdf",
        )
    except ValueError as error:
        return jsonify({"success": False, "message": str(error)}), 400
    except Exception:
        app.logger.exception("Gagal membuat PDF laporan Denver II")
        return jsonify({"success": False, "message": "Laporan PDF gagal dibuat. Periksa dependensi WeasyPrint dan data pemeriksaan."}), 500


@app.route("/api/denver/diagram-data", methods=["GET"])
def denver_diagram_data_api():
    """Mengirim master tugas untuk visualisasi diagram Denver II."""
    try:
        with open(DENVER_TASKS_PATH, "r", encoding="utf-8") as file:
            tasks = json.load(file)

        if not isinstance(tasks, list) or len(tasks) != 125:
            raise ValueError("Master Denver II harus berisi 125 tugas.")

        return jsonify({"success": True, "tasks": tasks})
    except Exception:
        app.logger.exception("Gagal memuat master diagram Denver II")
        return jsonify({
            "success": False,
            "message": "Master diagram Denver II gagal dimuat."
        }), 500


@app.route("/api/calculate-age", methods=["POST"])
def calculate_age_api():

    try:
        data = request.get_json()

        birth_date = datetime.strptime(
            data["birth_date"],
            "%Y-%m-%d"
        ).date()

        screening_date = datetime.strptime(
            data["screening_date"],
            "%Y-%m-%d"
        ).date()

        is_premature = data.get("premature") == "yes"

        premature_weeks = int(
            data.get("premature_weeks") or 0
        )

        result = calculate_denver_age(
            birth_date=birth_date,
            screening_date=screening_date,
            is_premature=is_premature,
            premature_weeks=premature_weeks
        )

        # Batas usia mengikuti usia final yang dipakai untuk pemeriksaan Denver II.
        final_age = result["final_age"]
        total_age_months = (
            int(final_age["years"]) * 12
            + int(final_age["months"])
            + int(final_age["days"]) / 30.0
        )
        if total_age_months > 73.2 + 1e-9:
            return jsonify({
                "success": False,
                "message": "Usia anak melebihi batas pemeriksaan Denver II. Usia maksimal adalah 73,2 bulan (6 tahun 1 bulan 6 hari)."
            }), 400

        return jsonify({
            "success": True,
            **result
        })

    except Exception as e:

        return jsonify({
            "success": False,
            "message": str(e)
        }), 400


if __name__ == "__main__":
    app.run(
        debug=True,
        host="127.0.0.1",
        port=5000
    )
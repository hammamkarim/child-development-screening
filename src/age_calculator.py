from datetime import date


# Konstanta sesuai Lampiran B proposal
DAYS_PER_MONTH = 30
MONTHS_PER_YEAR = 12
DAYS_PER_WEEK = 7

PREMATURE_THRESHOLD_WEEKS = 2
PREMATURE_CORRECTION_LIMIT_MONTHS = 24


def calculate_chronological_age(birth_date: date, screening_date: date):
    """
    Menghitung usia kronologis berdasarkan aturan proposal:
    1 tahun = 12 bulan
    1 bulan = 30 hari
    """

    if birth_date > screening_date:
        raise ValueError(
            "Tanggal lahir tidak boleh setelah tanggal skrining."
        )

    years = screening_date.year - birth_date.year
    months = screening_date.month - birth_date.month
    days = screening_date.day - birth_date.day

    if days < 0:
        months -= 1
        days += DAYS_PER_MONTH

    if months < 0:
        years -= 1
        months += MONTHS_PER_YEAR

    return {
        "years": years,
        "months": months,
        "days": days,
    }


def premature_weeks_to_age(weeks: int):
    """
    Mengubah usia prematur dalam minggu menjadi
    bulan dan hari berdasarkan aturan proposal.

    Contoh:
    6 minggu = 42 hari
    42 hari = 1 bulan 12 hari
    """

    if weeks <= PREMATURE_THRESHOLD_WEEKS:
        raise ValueError(
            "Koreksi prematuritas hanya berlaku untuk "
            "lebih dari 2 minggu."
        )

    total_days = weeks * DAYS_PER_WEEK

    months = total_days // DAYS_PER_MONTH
    days = total_days % DAYS_PER_MONTH

    return {
        "months": months,
        "days": days,
    }


def subtract_prematurity(
    chronological_age,
    premature_weeks: int
):
    """
    Mengurangi usia kronologis dengan selisih prematuritas.
    """

    correction = premature_weeks_to_age(premature_weeks)

    years = chronological_age["years"]
    months = chronological_age["months"]
    days = chronological_age["days"]

    correction_months = correction["months"]
    correction_days = correction["days"]

    # Borrow dari bulan jika hari tidak cukup
    if days < correction_days:
        months -= 1
        days += DAYS_PER_MONTH

    days -= correction_days

    # Borrow dari tahun jika bulan tidak cukup
    if months < correction_months:
        years -= 1
        months += MONTHS_PER_YEAR

    months -= correction_months

    if years < 0:
        raise ValueError(
            "Koreksi prematuritas melebihi usia kronologis anak."
        )

    return {
        "years": years,
        "months": months,
        "days": days,
    }


def calculate_denver_age(
    birth_date: date,
    screening_date: date,
    is_premature: bool = False,
    premature_weeks: int = 0
):
    """
    Menghasilkan usia final yang digunakan untuk Denver II.

    Aturan:
    1. Hitung usia kronologis.
    2. Jika prematur > 2 minggu dan usia < 2 tahun,
       lakukan koreksi prematuritas.
    3. Jika tidak memenuhi kondisi tersebut,
       gunakan usia kronologis.
    """

    chronological_age = calculate_chronological_age(
        birth_date,
        screening_date
    )

    chronological_total_months = (
        chronological_age["years"] * MONTHS_PER_YEAR
        + chronological_age["months"]
    )

    corrected = False

    final_age = chronological_age.copy()

    if (
        is_premature
        and premature_weeks > PREMATURE_THRESHOLD_WEEKS
        and chronological_total_months < PREMATURE_CORRECTION_LIMIT_MONTHS
    ):
        final_age = subtract_prematurity(
            chronological_age,
            premature_weeks
        )

        corrected = True

    final_total_months = (
        final_age["years"] * MONTHS_PER_YEAR
        + final_age["months"]
    )

    return {
        "chronological_age": chronological_age,
        "final_age": final_age,
        "corrected": corrected,
        "premature_weeks": premature_weeks if is_premature else 0,
        "total_months": final_total_months,
    }


def format_age(age):
    """
    Mengubah hasil usia menjadi teks untuk UI.
    """

    return (
        f"{age['years']} Tahun "
        f"{age['months']} Bulan "
        f"{age['days']} Hari"
    )
from datetime import date

from src.age_calculator import (
    calculate_denver_age,
    format_age
)


# ==========================================
# TEST 1 — LAHIR NORMAL
# ==========================================

result = calculate_denver_age(
    birth_date=date(2003, 1, 5),
    screening_date=date(2004, 3, 11),
    is_premature=False
)

print("TEST 1 - Normal")
print("Usia:", format_age(result["final_age"]))

assert result["final_age"] == {
    "years": 1,
    "months": 2,
    "days": 6
}


# ==========================================
# TEST 2 — PREMATUR 6 MINGGU
# ==========================================

result = calculate_denver_age(
    birth_date=date(2002, 2, 4),
    screening_date=date(2003, 3, 11),
    is_premature=True,
    premature_weeks=6
)

print("\nTEST 2 - Prematur 6 minggu")
print("Usia kronologis:",
      format_age(result["chronological_age"]))

print("Usia setelah koreksi:",
      format_age(result["final_age"]))

assert result["chronological_age"] == {
    "years": 1,
    "months": 1,
    "days": 7
}

assert result["final_age"] == {
    "years": 0,
    "months": 11,
    "days": 25
}

assert result["corrected"] is True


# ==========================================
# TEST 3 — PREMATUR TAPI SUDAH >= 2 TAHUN
# ==========================================

result = calculate_denver_age(
    birth_date=date(2023, 1, 1),
    screening_date=date(2025, 1, 1),
    is_premature=True,
    premature_weeks=6
)

print("\nTEST 3 - Prematur tetapi usia >= 2 tahun")
print("Usia:", format_age(result["final_age"]))

assert result["corrected"] is False


print("\nSEMUA TEST BERHASIL.")
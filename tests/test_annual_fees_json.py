"""The JSON twin of vcl-annual-data.js: same structure, readable from PHP."""
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "variation-fee-calculator"))

import importlib.util

spec = importlib.util.spec_from_file_location(
    "convert_annual_fees",
    Path(__file__).resolve().parents[1] / "variation-fee-calculator" / "convert-annual-fees.py",
)
caf = importlib.util.module_from_spec(spec)
spec.loader.exec_module(caf)


COUNTRIES = [
    {
        "cc": "AT",
        "hasAnnual": True,
        "turnoverBased": False,
        "note": "",
        "tariffs": [
            {"id": "rms", "label": "RMS", "role": "RMS", "base": 3965,
             "addStrength": 3965, "ccy": "EUR"},
        ],
    },
    {
        "cc": "IT",
        "hasAnnual": True,
        "turnoverBased": False,
        "note": "Annual fee per valid six-digit AIC",
        "tariffs": [
            {"id": "all", "label": "RMS/CMS/national", "role": None, "base": 1879,
             "addStrength": None, "ccy": "EUR", "isDefault": True},
        ],
    },
    {"cc": "DE", "hasAnnual": False, "turnoverBased": False, "note": "", "tariffs": []},
]


def parsed():
    return json.loads(caf.render_json(COUNTRIES, {"SEK": 11.0}, "2026-09-02"))


def test_carries_the_generated_date():
    assert parsed()["updated"] == "2026-09-02"


def test_keeps_every_country_including_those_without_a_fee():
    codes = [c["cc"] for c in parsed()["countries"]]
    assert codes == ["AT", "IT", "DE"]


def test_keeps_the_tariff_fields_php_validates_against():
    at = parsed()["countries"][0]
    assert at["tariffs"][0]["id"] == "rms"
    assert at["tariffs"][0]["base"] == 3965
    assert at["tariffs"][0]["addStrength"] == 3965
    assert at["tariffs"][0]["ccy"] == "EUR"


def test_keeps_null_addstrength_as_null():
    it = parsed()["countries"][1]
    assert it["tariffs"][0]["addStrength"] is None


def test_carries_the_fallback_fx():
    assert parsed()["fallbackFx"] == {"SEK": 11.0}


def test_is_valid_utf8_json_with_umlauts_intact():
    out = caf.render_json(
        [{"cc": "SE", "hasAnnual": True, "turnoverBased": False,
          "note": "Gebühr je Stärke", "tariffs": []}],
        {}, "2026-09-02",
    )
    assert "Gebühr je Stärke" in out

"""The HA sheet's comments column carries the source reference per country
(e.g. Italy: 'Elenco Tariffe aggiornato ad Luglio 2025'). It used to be
dropped on purpose; the public fee page needs it."""
import importlib.util
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
XLSX = ROOT / "Variation-Fee-Calculator-EU.xlsx"


def load_convert():
    path = ROOT / "variation-fee-calculator" / "convert.py"
    spec = importlib.util.spec_from_file_location("vcl_convert", path)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


def test_ha_entries_carry_the_comments_column():
    convert = load_convert()
    entries = convert.load_ha_websites(XLSX)

    assert len(entries) == 33
    assert all("comments" in e for e in entries)

    italy = next(e for e in entries if e["cc"] == "IT")
    assert italy["comments"] == "Elenco Tariffe aggiornato ad Luglio 2025"


def test_every_country_has_a_source_reference():
    convert = load_convert()
    entries = convert.load_ha_websites(XLSX)
    missing = [e["cc"] for e in entries if not e["comments"]]
    assert missing == []

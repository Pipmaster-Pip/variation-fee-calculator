import sys, pathlib
sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1] / "tools" / "fee-migration"))

from harness import open_calculator


def test_italy_rms_three_strengths_one_ia_two_ib_one_ii():
    with open_calculator() as (page, errors):
        res = page.evaluate("""() => window.VCLCALC.computeFees({
            countries: [{ cc: "IT", role: "RMS", strengths: 3,
                          special: { IA: "standard", IB: "standard", II: "standard" } }],
            counts: { IA: 1, IB: 2, II: 1 }
        })""")
        assert round(res["grandTotal"], 2) == 35304.00
        assert errors == [], f"page errors while loading: {errors}"

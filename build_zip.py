"""Builds variation-fee-calculator.zip for upload to WordPress.

Run from anywhere:  python build_zip.py

Two rules this exists to enforce, both learned the hard way:

1. Forward slashes. PowerShell's Compress-Archive writes backslash separators, which the
   WordPress plugin uploader rejects -- so the archive is written with zipfile and explicit
   arcnames rather than by any shell helper.
2. Exactly the listed files. FILES is maintained by hand, so the build fails loudly if a
   listed file is missing *or* if the plugin folder holds anything unlisted -- a leftover
   _verify-guide.html harness, or a .bak that the admin page's fee-data upload left behind.
   Without that second check a temporary file ships silently to production.
"""

import os
import zipfile

HERE = os.path.dirname(os.path.abspath(__file__))
SRC = os.path.join(HERE, "variation-fee-calculator")
OUT = os.path.join(HERE, "variation-fee-calculator.zip")

FILES = [
    "variation-fee-calculator.php",
    "convert.py",
    "convert-workload.py",
    "convert-annual-fees.py",
    "extract_qa.py",
    "extract_art5.py",
    "README.md",
    "includes/admin.php",
    "includes/fee-editor.php",
    "includes/lookup.php",
    "includes/usage-counter.php",
    "includes/usage-dashboard.php",
    "assets/css/vcl-style.css",
    "assets/css/vcl-workload-style.css",
    "assets/css/vcl-workflow-style.css",
    "assets/css/vcl-guide-style.css",
    "assets/css/vcl-calc-style.css",
    "assets/css/vcl-fee-editor.css",
    "assets/js/vcl-app.js",
    "assets/js/vcl-usage.js",
    "assets/js/vcl-fee-editor.js",
    "assets/js/vcl-data.js",
    "assets/js/vcl-qa-data.js",
    "assets/js/vcl-art5-data.js",
    "assets/js/vcl-timeline.js",
    "assets/js/vcl-workload-data.js",
    "assets/js/vcl-workload-hours.js",
    "assets/js/vcl-workload-hours-data.js",
    "assets/data/annual-fees.json",
    "assets/js/vcl-annual-data.js",
    "assets/js/vcl-budget-engine.js",
    "assets/js/vcl-budget.js",
    "assets/css/vcl-budget-style.css",
    "assets/js/vcl-sg-logic.js",
    "assets/js/vcl-submission.js",
    "assets/js/vcl-workflow.js",
    "assets/js/vcl-guide.js",
    "assets/js/vcl-feedata.js",
    "assets/js/vcl-calc-app.js",
    "assets/js/vcl-calc-data.js",
]


def main():
    missing = [f for f in FILES if not os.path.isfile(os.path.join(SRC, f))]
    if missing:
        raise SystemExit("ERROR missing files: " + ", ".join(missing))

    on_disk = set()
    for root, dirs, names in os.walk(SRC):
        # Byte-code caches are never shipped and are created by anyone who imports
        # convert.py (the test suite does). Pruning them keeps "test, then build" working.
        dirs[:] = [d for d in dirs if d != "__pycache__"]
        for n in names:
            if n.endswith((".pyc", ".pyo")):
                continue
            rel = os.path.relpath(os.path.join(root, n), SRC).replace(os.sep, "/")
            on_disk.add(rel)
    extra = sorted(on_disk - set(FILES))
    if extra:
        raise SystemExit(
            "ERROR unlisted files in plugin folder (delete them, or add them to FILES): "
            + ", ".join(extra)
        )

    if os.path.exists(OUT):
        os.remove(OUT)

    with zipfile.ZipFile(OUT, "w", zipfile.ZIP_DEFLATED) as z:
        for f in FILES:
            z.write(os.path.join(SRC, f), "variation-fee-calculator/" + f)

    with zipfile.ZipFile(OUT) as z:
        names = z.namelist()
        bad_sep = [n for n in names if "\\" in n]
        if bad_sep:
            raise SystemExit("ERROR backslashes in arcnames: " + ", ".join(bad_sep))
        broken = z.testzip()
        if broken:
            raise SystemExit("ERROR bad CRC in: " + broken)

    print("OK  %s" % OUT)
    print("    %d files, %.1f KB" % (len(FILES), os.path.getsize(OUT) / 1024))


if __name__ == "__main__":
    main()

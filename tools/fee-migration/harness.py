"""Opens the harness page with the real production scripts loaded.

Every external request is aborted so LIVE_FX stays empty and the static
exchange rates apply -- without this the golden master would drift with the
daily ECB rate (spec B2).
"""

from contextlib import contextmanager
from pathlib import Path

from playwright.sync_api import sync_playwright

HERE = Path(__file__).resolve().parent
PAGE = (HERE / "harness.html").as_uri()


@contextmanager
def open_calculator():
    errors = []
    with sync_playwright() as p:
        browser = p.chromium.launch()
        page = browser.new_page()
        page.route("**", lambda route: route.continue_()
                   if route.request.url.startswith("file://") else route.abort())
        page.on("pageerror", lambda e: errors.append(e.message))
        page.goto(PAGE)
        page.wait_for_function(
            "() => typeof window.VCLCALC?.computeFees === 'function'")
        try:
            yield page, errors
        finally:
            browser.close()

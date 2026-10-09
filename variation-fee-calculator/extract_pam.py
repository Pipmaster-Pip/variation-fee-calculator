# Extracts the EMA "post-authorisation procedural advice for users of the centralised
# procedure" (EMEA-H-19984/03) into a structured, recursive JSON tree. Like extract_qa.py it
# parses the PDF's own text rather than summarising it -- this is a regulatory document and the
# wording has to survive verbatim.
#
# Three things that differ from the CMDh Q&A and shape this parser:
#  * Numbering is up to three levels deep (1., 1.1., 13.15.1.) and the depth is irregular: a
#    second-level item is EITHER a leaf question (1.1) OR a sub-section group (13.15) that has
#    its own intro prose plus child questions 13.15.1..n. So nodes are recursive, not flat.
#  * Each item carries its OWN revision marker -- "Rev. <Month Year>" (revised) or
#    "NEW <Month Year>" (new). These are read from the table of contents, where every entry
#    shows its marker reliably on one (flattened) line; the body repeats them inline but wrapped.
#  * There is no "Answer:" separator -- the answer prose follows the heading directly, so the
#    title/answer split is driven by the TOC title length instead.
#
# Usage:  python extract_pam.py <path-to-EMA-PAM-pdf>
# Writes: assets/js/vcl-pam-data.js  (next to this script)
#
# Needs pypdf (pip install pypdf). Mirrors extract_qa.py's role: a source document goes in, a
# generated data file comes out.
import json
import os
import re
import sys

import pypdf

if len(sys.argv) < 2:
    raise SystemExit("usage: python extract_pam.py <path-to-EMA-PAM-pdf>")
PDF = sys.argv[1]
HERE = os.path.dirname(os.path.abspath(__file__))

reader = pypdf.PdfReader(PDF)
pages = [p.extract_text() or "" for p in reader.pages]

# ---- Month normalisation: display string keeps the source form, sort key is YYYY-MM ----------
MONTHS = {
    "jan": "01", "feb": "02", "mar": "03", "apr": "04", "may": "05", "jun": "06",
    "jul": "07", "aug": "08", "sep": "09", "oct": "10", "nov": "11", "dec": "12",
}
MARKER = re.compile(r"(Rev\.?|NEW)\s+([A-Za-z]{3,9})\.?\s+(\d{4})\s*$", re.I)


def parse_marker(tail):
    """Pull a trailing 'Rev. Oct 2026' / 'NEW Feb 2014' off a title. Returns (clean_title, rev)."""
    m = MARKER.search(tail)
    if not m:
        return tail.strip(), None
    kind = "new" if m.group(1).upper() == "NEW" else "rev"
    mon = MONTHS.get(m.group(2)[:3].lower())
    if not mon:
        return tail.strip(), None
    clean = tail[: m.start()].strip()
    rev = {
        "type": kind,
        "date": "%s %s" % (m.group(2), m.group(3)),  # verbatim month token + year
        "sort": "%s-%s" % (m.group(3), mon),
    }
    return clean, rev


# ---- 1. Locate the TOC and the body ----------------------------------------------------------
toc_start = next((i for i, p in enumerate(pages) if "Table of Contents" in p), None)
if toc_start is None:
    raise SystemExit("ERROR: 'Table of Contents' not found")
# Body starts where chapter 1's heading appears WITHOUT leader dots / trailing page number.
body_start = next(
    (i for i in range(toc_start + 1, len(pages))
     if re.search(r"(?m)^\s*1\.\s+Type IA Variations\s*$", pages[i])),
    None,
)
if body_start is None:
    raise SystemExit("ERROR: body start (chapter 1 heading) not found")
print("toc pages %d-%d, body starts page %d" % (toc_start + 1, body_start, body_start + 1))

# ---- 2. Parse the TOC line by line -----------------------------------------------------------
# A new entry starts on a line beginning with its "<id>. "; continuation lines (wrapped titles)
# are appended until the next id line. Parsing per line (not a flattened blob) tolerates entries
# with few or no leader dots -- several titles run right up to the page number with none at all.
ID_START = re.compile(r"^(\d+(?:\.\d+)*)\.\s+(.*)$")
TOC_JUNK = JUNK_TOC = (
    re.compile(r"^European Medicines Agency post-authorisation"),
    re.compile(r"^centralised procedure"),
    re.compile(r"^EMEA-H-19984/03"),
    re.compile(r"^Page \d+/\d+$"),
    re.compile(r"^Table of Contents$"),
)
entries = []
cur = None
for p in pages[toc_start:body_start]:
    for raw in p.split("\n"):
        s = raw.strip()
        if not s or any(j.match(s) for j in TOC_JUNK):
            continue
        m = ID_START.match(s)
        if m:
            if cur:
                entries.append(cur)
            cur = {"id": m.group(1), "text": m.group(2)}
        elif cur:
            cur["text"] += " " + s
if cur:
    entries.append(cur)

chapters = []
toc_title = {}  # id -> canonical title (marker stripped)
toc_rev = {}    # id -> rev dict or None
top_ids = []    # level-2 ids, in TOC order; deeper levels are discovered from the body
seen_ids = set()
for e in entries:
    ident = e["id"]
    if ident in seen_ids:
        continue
    seen_ids.add(ident)
    # Strip the trailing leader dots + page number, then the revision marker.
    text = re.sub(r"\s*\.*\s*\d+\s*$", "", re.sub(r"\s+", " ", e["text"])).strip()
    title, rev = parse_marker(text)
    segs = ident.split(".")
    if len(segs) == 1:
        chapters.append({"key": ident, "title": title})
        continue
    toc_title[ident] = title
    toc_rev[ident] = rev
    if len(segs) == 2:
        top_ids.append(ident)

print("chapters:", len(chapters), "| level-2 ids from TOC:", len(top_ids))


# ---- 3. Body text, minus the repeating page furniture ----------------------------------------
JUNK = (
    re.compile(r"^European Medicines Agency post-authorisation procedural advice for users of the$"),
    re.compile(r"^centralised procedure\s*$"),
    re.compile(r"^EMEA-H-19984/03\s*$"),
    re.compile(r"^Page \d+/\d+$"),
    re.compile(r"^An agency of the European Union\s*$"),
)


def lines_with_y(page, text):
    """Line text from extract_text(), line *position* from a visitor pass (see extract_qa.py).

    The document marks paragraphs by leading alone and extract_text() throws that away; the
    visitor keeps the y but mangles inter-word spaces. So: text from the safe pass, y from the
    visitor, matched on a whitespace-free key.
    """
    rows = {}

    def visit(t, cm, tm, font, size):
        if t.strip():
            rows.setdefault(round(tm[5], 1), []).append((t, str(font)))

    page.extract_text(visitor_text=visit)
    vis = []
    for y in sorted(rows, reverse=True):
        t = "".join(x[0] for x in rows[y]).strip()
        if t:
            # A heading line is set entirely in a Bold face; body prose is not. The first run's
            # font decides -- headings begin with their (bold) number.
            vis.append({"y": y, "key": re.sub(r"\s+", "", t), "bold": "Bold" in rows[y][0][1]})

    out = []
    vi = 0
    for raw in text.split("\n"):
        s = raw.strip()
        if not s or any(p.match(s) for p in JUNK):
            continue
        key = re.sub(r"\s+", "", s)
        y, bold = None, False
        for j in range(vi, min(vi + 8, len(vis))):
            if vis[j]["key"] == key:
                y, bold, vi = vis[j]["y"], vis[j]["bold"], j + 1
                break
        out.append({"text": s, "y": y, "bold": bold})
    return out


body = []
for pno, (page_obj, text) in enumerate(zip(reader.pages[body_start:], pages[body_start:])):
    for ln in lines_with_y(page_obj, text):
        ln["page"] = pno
        body.append(ln)
lines = [ln["text"] for ln in body]


# ---- 4. Body walk helpers --------------------------------------------------------------------
def heading_re(ident):
    return re.compile(r"^%s\.\s+(.*)$" % re.escape(ident))


norm = lambda s: re.sub(r"\s+", " ", s).strip()
nows = lambda s: re.sub(r"\s+", "", s)  # whitespace-free key: the TOC and body disagree on


# spacing ("IA/ IAIN" vs "IA/IAIN"), which is an extraction artefact, not a wording difference.
def find_heading(ident, lo, hi):
    pat = heading_re(ident)
    return next((j for j in range(lo, hi) if pat.match(lines[j])), None)


PARA_GAP = 15  # ~13-14pt inside a paragraph, ~21pt+ between them


def reflow(i0, i1):
    """Re-join column-wrapped lines into paragraphs/bullets using the leading between them."""
    out, cur, kind = [], [], "p"

    def flush():
        nonlocal cur, kind
        if cur:
            out.append({"t": kind, "text": " ".join(cur)})
        cur, kind = [], "p"

    prev_y = prev_page = None
    for i in range(i0, i1):
        t, y, pg = body[i]["text"], body[i]["y"], body[i]["page"]
        if t == "•" or t == "–" or t == "-":
            continue  # a lone bullet glyph on its own line: the text follows on the next line
        if t.startswith("•") or t.startswith("–"):
            flush()
            cur, kind = [t.lstrip("•–-").strip()], "li"
        else:
            same_page = prev_page is not None and pg == prev_page
            if same_page and prev_y is not None and y is not None and (prev_y - y) > PARA_GAP:
                flush()
            cur.append(t)
        prev_y, prev_page = y, pg
    flush()
    return [p for p in out if p["text"]]


# ---- 5. Recursive block walk -----------------------------------------------------------------
# Only level-2 ids are in the TOC; level-3+ exist only in the body and are discovered by
# scanning each block for child headings prefixed with the parent id ("13.15." -> "13.15.1").
all_nodes = []  # flat list, for the self-checks and fidelity gate


def split_title(ident, i0, i1):
    """Return (title, rev, answer_start). The heading is set in bold and may wrap over a few
    lines; the title spans the bold lines from the heading, and the answer is the rest. The
    revision marker (also bold, part of the heading) is stripped off and, for level-2 items,
    taken from the cleaner TOC parse instead."""
    parts = [heading_re(ident).match(body[i0]["text"]).group(1).strip()]
    ai = i0 + 1
    # The marker (if any) terminates the heading: stop there, so a bold answer lead-in on the
    # next line ("Groups of Type IA variations:") is not swallowed into the title. Without a
    # marker, consume the whole bold run (a wrapped, undated heading).
    while parse_marker(norm(" ".join(parts)))[1] is None and ai < i1 and body[ai]["bold"]:
        parts.append(body[ai]["text"])
        ai += 1
    title, body_rev = parse_marker(norm(" ".join(p for p in parts if p)))
    return title, (toc_rev.get(ident) if ident in toc_rev else body_rev), ai


def build(ident, ch, i0, i1):
    child_pat = re.compile(r"^%s\.(\d+)\.\s+" % re.escape(ident))
    child_starts = [j for j in range(i0 + 1, i1) if child_pat.match(lines[j])]
    body_end = child_starts[0] if child_starts else i1
    title, rev, ai = split_title(ident, i0, body_end)
    node = {"id": ident, "ch": ch, "title": title, "rev": rev, "a": reflow(ai, body_end),
            "children": []}
    all_nodes.append(node)
    for k, cs in enumerate(child_starts):
        ce = child_starts[k + 1] if k + 1 < len(child_starts) else i1
        cid = ident + "." + child_pat.match(lines[cs]).group(1)
        node["children"].append(build(cid, ch, cs, ce))
    return node


tops = []
for ident in top_ids:
    start = find_heading(ident, 0, len(lines))
    if start is not None:
        tops.append((ident, start))
    else:
        print("!! heading not found:", ident, file=sys.stderr)
tops.sort(key=lambda t: t[1])

tree = []
for k, (ident, start) in enumerate(tops):
    end = tops[k + 1][1] if k + 1 < len(tops) else len(lines)
    tree.append(build(ident, int(ident.split(".")[0]), start, end))


def clean_node(n):
    out = {"id": n["id"], "ch": n["ch"], "title": n["title"], "rev": n["rev"], "a": n["a"]}
    if n["children"]:
        out["children"] = [clean_node(c) for c in n["children"]]
    return out


tree = [clean_node(n) for n in tree]
flat_nodes = all_nodes

# ---- 7. Fidelity gate: every title/paragraph must appear verbatim in the body ----------------
body_clean = nows(" ".join(
    s for p in pages[body_start:] for s in (x.strip() for x in p.split("\n"))
    if s and not any(j.match(s) for j in JUNK)
))


def check(n, bad):
    if nows(n["title"]) not in body_clean:
        bad.append(n["id"] + " (title)")
    for p in n["a"]:
        if nows(p["text"]) not in body_clean:
            bad.append("%s: %s" % (n["id"], p["text"][:40]))
    for c in n.get("children", []):
        check(c, bad)


_bad = []
for n in tree:
    check(n, _bad)
if _bad:
    print("!! not verbatim (%d):" % len(_bad), "; ".join(_bad[:20]), file=sys.stderr)
else:
    print("fidelity: all titles and paragraphs found verbatim in the body")

# ---- 8. Emit the plugin data file ------------------------------------------------------------
meta = {
    "docRef": "EMEA-H-19984/03 Rev. 119",
    "docDate": "October 2026",
    "docTitle": "European Medicines Agency post-authorisation procedural advice for users of the centralised procedure",
    "url": "https://www.ema.europa.eu/en/documents/regulatory-procedural-guideline/european-medicines-agency-post-authorisation-procedural-advice-users-centralised-procedure_en.pdf",
    "lastUpdated": "2026-10-09",
}
data = {"meta": meta, "chapters": chapters, "nodes": tree}
JS = os.path.join(HERE, "assets", "js", "vcl-pam-data.js")
with open(JS, "w", encoding="utf-8", newline="\n") as f:
    f.write(
        "// EMA post-authorisation procedural advice (EMEA-H-19984/03) -- GENERATED FILE, DO NOT EDIT BY HAND.\n"
        "//\n"
        "// Produced by extract_pam.py from the source PDF; every title and answer paragraph is\n"
        "// verified to appear verbatim in it. Re-run that script against a new revision rather than\n"
        "// patching text here, or the next regeneration silently drops the edit.\n"
        "//\n"
        "// Shape: nodes[] is a recursive tree ({id, ch, title, rev, a[], children?}). A node is a\n"
        "// leaf question (a[] only), or a sub-section group (a[] intro + children[]). rev is null,\n"
        "// or {type:'rev'|'new', date:'Oct 2026', sort:'2026-10'}. a[] items are {t:'p'|'li', text}.\n"
        "(function () {\n"
        '  "use strict";\n\n'
        "  window.VCL_PAM_DATA = "
    )
    f.write(json.dumps(data, ensure_ascii=False, indent=2).replace("\n", "\n  "))
    f.write(";\n})();\n")
print("wrote", JS)

# ---- 9. Self-checks --------------------------------------------------------------------------
total = len(flat_nodes)
dated = sum(1 for n in flat_nodes if n["rev"])
new = sum(1 for n in flat_nodes if n["rev"] and n["rev"]["type"] == "new")
groups = sum(1 for n in flat_nodes if n["children"])
no_body = [n["id"] for n in flat_nodes if not n["a"] and not n["children"]]
print("nodes: %d | dated: %d (NEW: %d) | sub-section groups: %d" % (total, dated, new, groups))
print("PROBLEM - leaf nodes with no answer:", no_body[:20] or "none")

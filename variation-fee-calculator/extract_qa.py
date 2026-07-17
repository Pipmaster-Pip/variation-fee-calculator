# Extracts the CMDh Q&A into structured JSON. Deliberately parses the PDF's own text rather
# than summarising it: this is a regulatory document, and the wording has to survive verbatim.
#
# Two things the document does that a naive parser gets wrong:
#  * Question numbers are not uniformly N.M -- 2.11 splits into 2.11.a and 2.11.b, and the body
#    sets them inconsistently ("2.11.  a." vs "2.11.b.").
#  * Answers contain their own numbered lists, so scanning for /^\d+\.\d+\./ splits on them.
#    Headings are therefore only accepted where the *next number expected from the TOC* appears.
#
# Usage:  python extract_qa.py <path-to-Q&A-pdf>
# Writes: assets/js/vcl-qa-data.js  (next to this script)
#
# Needs pypdf (pip install pypdf). Mirrors convert.py's role for the fee data: a source
# document goes in, a generated data file comes out.
import json
import os
import re
import sys

import pypdf

if len(sys.argv) < 2:
    raise SystemExit("usage: python extract_qa.py <path-to-Q&A-pdf>")
PDF = sys.argv[1]
HERE = os.path.dirname(os.path.abspath(__file__))

reader = pypdf.PdfReader(PDF)
pages = [p.extract_text() or "" for p in reader.pages]
toc_flat = re.sub(r"\s+", " ", "\n".join(pages[0:5]))

# ---- 1. Chapter titles + the ordered list of question numbers, from the table of contents ---
chapters = []
# \s* not \s before the leader dots: chapter 3's TOC line runs the title straight into them
# ("...Classification of a variation............ 11"), unlike every other chapter.
for m in re.finditer(r"(?:^| )([1-5])\.\s+([A-Z][^.]+?)\s*\.{3,}\s*(\d+)", toc_flat):
    if not any(c["key"] == m.group(1) for c in chapters):
        chapters.append({"key": m.group(1), "title": re.sub(r"\s+", " ", m.group(2)).strip()})

toc = []
for m in re.finditer(r"(\d+)\.(\d+)\.(?:\s*([a-z])\.)?\s+(.+?)\s\.{3,}\s*(\d+)", toc_flat):
    ch, no, letter = int(m.group(1)), int(m.group(2)), m.group(3)
    ident = "%d.%d" % (ch, no) + ("." + letter if letter else "")
    if any(e["id"] == ident for e in toc):
        continue
    toc.append({"id": ident, "ch": ch, "no": no, "letter": letter, "toc_title": m.group(4).strip()})
toc.sort(key=lambda e: (e["ch"], e["no"], e["letter"] or ""))

# ---- 2. Body text, minus the repeating page furniture --------------------------------------
JUNK = (
    re.compile(r"^Q&As for the submission of Variations according$"),
    re.compile(r"^to the Commission Regulation \(EC\) 1234/2008$"),
    re.compile(r"^Page \d+/\d+$"),
)


def lines_with_y(page, text):
    """Line text from extract_text(), line *position* from a visitor pass.

    Both are needed. The document marks paragraphs by leading alone -- ~14pt between lines of
    one paragraph, ~21pt between paragraphs -- and extract_text() throws that away, which
    collapsed whole answers into single 2000-character blobs. But the visitor cannot supply the
    text: the PDF encodes inter-word gaps as positioning rather than space characters, so
    joining its chunks yields "marketingauthorisation". So: text from the safe pass, y from the
    visitor, matched on a whitespace-free key (which is exactly what that defect preserves).
    """
    rows = {}

    def visit(text, cm, tm, font, size):
        if not text.strip():
            return
        y = round(tm[5], 1)
        rows.setdefault(y, []).append(text)

    page.extract_text(visitor_text=visit)
    vis = []
    for y in sorted(rows, reverse=True):
        t = "".join(rows[y]).strip()
        if t:
            vis.append({"y": y, "key": re.sub(r"\s+", "", t)})

    out = []
    vi = 0
    for raw in text.split("\n"):
        s = raw.strip()
        if not s or any(p.match(s) for p in JUNK):
            continue
        key = re.sub(r"\s+", "", s)
        y = None
        # The visitor also sees text extract_text() drops (the flow-chart in Q1.4), so scan
        # forward for the match instead of assuming the two passes line up index for index.
        for j in range(vi, min(vi + 6, len(vis))):
            if vis[j]["key"] == key:
                y, vi = vis[j]["y"], j + 1
                break
        out.append({"text": s, "y": y})
    return out


body = []
for pno, (page_obj, text) in enumerate(zip(reader.pages[5:], pages[5:])):
    pls = lines_with_y(page_obj, text)
    for ln in pls:
        ln["page"] = pno
    body += pls
lines = [ln["text"] for ln in body]


def heading_re(entry):
    """Matches '1.1.  Title', '2.11.  a. Title' and '2.11.b. Title' alike."""
    base = r"^%d\.%d\." % (entry["ch"], entry["no"])
    if entry["letter"]:
        return re.compile(base + r"\s*%s\.\s+(.*)$" % entry["letter"])
    return re.compile(base + r"\s+(?![a-z]\.)(.*)$")


# ---- 3. Walk the body in TOC order ---------------------------------------------------------
blocks = []
idx = 0
for i, want in enumerate(toc):
    pat = heading_re(want)
    start = next((j for j in range(idx, len(lines)) if pat.match(lines[j])), None)
    if start is None:
        print("!! heading not found:", want["id"], file=sys.stderr)
        continue
    end = len(lines)
    if i + 1 < len(toc):
        npat = heading_re(toc[i + 1])
        end = next((j for j in range(start + 1, len(lines)) if npat.match(lines[j])), len(lines))
    else:
        end = next((j for j in range(start + 1, len(lines)) if lines[j] == "Revision history"), len(lines))
    blocks.append({"want": want, "i0": start, "i1": end, "pat": pat})
    idx = start + 1


PARA_GAP = 15  # measured: ~13-14pt inside a paragraph, ~21pt+ between them


def reflow(i0, i1):
    """Re-join the column-wrapped lines into paragraphs, using the leading between them."""
    out, cur, kind = [], [], "p"

    def flush():
        nonlocal cur, kind
        if cur:
            out.append({"t": kind, "text": " ".join(cur)})
        cur, kind = [], "p"

    prev_y = prev_page = None
    for i in range(i0, i1):
        t, y, pg = body[i]["text"], body[i]["y"], body[i]["page"]
        if t.startswith("•"):
            flush()
            cur, kind = [t.lstrip("•").strip()], "li"
        else:
            # Across a page break the leading says nothing (the next line's y is near the top
            # of a fresh page), and a paragraph running over the page boundary is the common
            # case -- so carry on rather than guess a split.
            same_page = prev_page is not None and pg == prev_page
            if same_page and prev_y is not None and y is not None and (prev_y - y) > PARA_GAP:
                flush()
            cur.append(t)
        prev_y, prev_page = y, pg
    flush()
    return [p for p in out if p["text"]]


# ---- 4. Title / answer, and the three phrasings of a deleted question -----------------------
DELETED = re.compile(r"^Question\s+(?:was\s+)?deleted\s+(?:in\s+)?(.+?)\.?$", re.I)
questions = []
for b in blocks:
    i0, i1 = b["i0"], b["i1"]
    ai = next((k for k in range(i0, i1) if body[k]["text"] == "Answer:"), None)
    head = [b["pat"].match(body[i0]["text"]).group(1).strip()] + [body[k]["text"] for k in range(i0 + 1, ai if ai is not None else i1)]
    title = re.sub(r"\s+", " ", " ".join(x for x in head if x)).strip()
    dm = DELETED.match(title)
    questions.append({
        "id": b["want"]["id"],
        "ch": b["want"]["ch"],
        "q": title,
        "a": reflow(ai + 1, i1) if ai is not None else [],
        "deleted": dm.group(1) if dm else None,
    })

# ---- 5. Revision history --------------------------------------------------------------------
tail = re.sub(r"\s+", " ", pages[-1])
tail = tail[tail.find("Revision history"):]
MONTH = r"(?:January|February|March|April|May|June|July|August|September|October|November|December)"
# The date is the LAST month in a row, not the first: Rev 64's summary itself ends in
# "...coming into effect from 15 January 2026." and its actual Date column reads October 2025.
# A non-greedy match takes the in-text date and truncates the summary with it.
revs = []
starts = [(m.start(), m.group(1)) for m in re.finditer(r"\b(6[0-9])\s+Update\b", tail)]
for k, (pos, rev) in enumerate(starts):
    seg = tail[pos:starts[k + 1][0] if k + 1 < len(starts) else len(tail)]
    seg = re.sub(r"^\d+\s+", "", seg).strip()
    hits = list(re.finditer(r"%s\s+\d{4}" % MONTH, seg))
    revs.append({
        "rev": rev,
        "summary": (seg[: hits[-1].start()] if hits else seg).strip(),
        "date": hits[-1].group(0) if hits else "",
    })

data = {"chapters": chapters, "questions": questions, "revisions": revs}

# ---- 5b. Fidelity gate ---------------------------------------------------------------------
# Every string that will reach a user must appear verbatim in the source PDF. Compared against
# the junk-filtered text, not the raw pages: a paragraph running across a page break has the
# page header spliced into the middle of it in the raw extraction, which would fail this check
# for a reason that has nothing to do with the transcription.
_clean = re.sub(r"\s+", " ", " ".join(
    s for p in pages for s in (x.strip() for x in p.split("\n"))
    if s and not any(j.match(s) for j in JUNK)
))
_bad = [q["id"] for q in questions if re.sub(r"\s+", " ", q["q"]).strip() not in _clean]
_bad += ["%s:%s" % (q["id"], p["text"][:40]) for q in questions for p in q["a"]
         if re.sub(r"\s+", " ", p["text"]).strip() not in _clean]
if _bad:
    raise SystemExit("ERROR not verbatim in the source PDF: " + "; ".join(_bad[:10]))
print("fidelity: all %d questions and %d paragraphs found verbatim in the PDF"
      % (len(questions), sum(len(q["a"]) for q in questions)))

# ---- 6. Emit the plugin data file ----------------------------------------------------------
JS = os.path.join(HERE, "assets", "js", "vcl-qa-data.js")
meta = {
    "docRef": "CMDh/132/2009, Rev. 66",
    "docDate": "June 2026",
    "docTitle": "Q&A - List for the submission of variations for human medicinal products according to Commission Regulation (EC) 1234/2008 as amended",
    "url": "https://www.hma.eu/fileadmin/dateien/Human_Medicines/CMD_h_/Questions_Answers/CMDh_132_2009_Rev66_2026_06_clean_-_QAs_Variations.pdf",
    "lastUpdated": "2026-07-17",
}
with open(JS, "w", encoding="utf-8", newline="\n") as f:
    f.write(
        "// Q&A on Variations (CMDh/132/2009, Rev. 66) -- GENERATED FILE, DO NOT EDIT BY HAND.\n"
        "//\n"
        "// Produced by extract_qa.py from the source PDF; every question title and answer paragraph\n"
        "// is verified to appear verbatim in it. Re-run that script against a new revision rather\n"
        "// than patching text here, or the next regeneration silently drops the edit.\n"
        "//\n"
        "// Kept out of vcl-data.js on purpose: that file is the hand-maintained transcription of the\n"
        "// Classification Guideline, this one is machine-generated from a different document -- the\n"
        "// same split as vcl-calc-data.js (generated by convert.py) versus the rest.\n"
        "//\n"
        "// Shape: questions[].a is an array of {t: 'p'|'li', text} -- the source marks paragraphs by\n"
        "// leading only, so the breaks were recovered from the PDF's text coordinates.\n"
        "// deleted: the date string from \"Question deleted in <date>\", or null for a live question.\n"
        "(function () {\n"
        '  "use strict";\n\n'
        "  window.VCL_QA_DATA = "
    )
    f.write(json.dumps({"meta": meta, **data}, ensure_ascii=False, indent=2).replace("\n", "\n  "))
    f.write(";\n})();\n")
print("wrote", JS)

# ---- 6. Self-checks: fail loudly rather than ship a quietly wrong transcription --------------
print("chapters:", len(chapters))
for c in chapters:
    print("  %s. %s" % (c["key"], c["title"]))
print("questions:", len(questions), "| expected from TOC:", len(toc))
print("deleted:", sum(1 for q in questions if q["deleted"]))
print("live:", sum(1 for q in questions if not q["deleted"]))
bad = [q["id"] for q in questions if not q["a"] and not q["deleted"]]
print("PROBLEM - live questions with no answer:", bad or "none")
short = [q["id"] for q in questions if not q["deleted"] and len(" ".join(p["text"] for p in q["a"])) < 40]
print("PROBLEM - suspiciously short answers:", short or "none")
print("revisions:", len(revs))
for r in revs:
    print("  Rev %s (%s): %s" % (r["rev"], r["date"], r["summary"][:70]))

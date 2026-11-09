#!/usr/bin/env python3
"""Marks rows in docs/failures.html as fixed, from Playwright JSON results.

    npx playwright test tests/api/academics --reporter=json > /tmp/run.json
    python3 scripts/mark-fixed.py /tmp/run.json [more.json ...]

A row is matched on (spec file, test title). Only tests present in the supplied results are touched:
  - passed now      -> row is marked fixed (keeps the date it was first marked)
  - failed again    -> a fixed mark is removed and reported as a regression
Rows for tests that were not run keep whatever state they had.
Optional scripts/fixed-notes.json maps a test title to a short note shown beside the badge, e.g. when the row was
cleared by correcting the test rather than Operion. Counts in the header, the module chips and
each module summary are recomputed from the rows, so the script is safe to run repeatedly.
"""
import datetime
import html
import json
import re
import sys
from pathlib import Path

PAGE = Path(__file__).resolve().parent.parent / "docs" / "failures.html"
NOTES_FILE = Path(__file__).resolve().parent / "fixed-notes.json"
NOTES = json.loads(NOTES_FILE.read_text()) if NOTES_FILE.exists() else {}
TODAY = datetime.date.today().isoformat()

CSS = (
    "tr.fixed td{opacity:.6}tr.fixed td:nth-child(2)>div:first-child{text-decoration:line-through}"
    ".ok{display:inline-block;margin-left:8px;padding:1px 7px;border-radius:10px;background:#1a7f37;color:#fff;font-size:11.5px;font-weight:600;text-decoration:none}"
    ".note{margin-left:6px;color:var(--mut);font-size:12px}"
    "body.hide-fixed tr.fixed{display:none}#prog{font-weight:600;color:var(--fg)}label.hf{display:inline-block;margin:0 0 12px;color:var(--mut)}"
)
SCRIPT = (
    "<script>\nconst q=document.getElementById('q'),hf=document.getElementById('hf');"
    "function apply(){const v=q.value.toLowerCase();document.body.classList.toggle('hide-fixed',hf.checked);"
    "document.querySelectorAll('details').forEach(d=>{let n=0;d.querySelectorAll('tr').forEach(r=>{"
    "const s=(!v||r.textContent.toLowerCase().includes(v))&&!(hf.checked&&r.classList.contains('fixed'));"
    "r.style.display=s?'':'none';if(s)n++});d.style.display=n?'':'none'})}"
    "q.addEventListener('input',apply);hf.addEventListener('change',apply);\n</script>"
)


def passed_by_test(paths):
    """{(spec file basename, title): passed?} from Playwright JSON reports."""
    out = {}

    def walk(suite):
        for spec in suite.get("specs", []):
            for test in spec["tests"]:
                out[(Path(spec["file"]).name, spec["title"])] = test["results"][-1]["status"] == "passed"
        for child in suite.get("suites", []):
            walk(child)

    for p in paths:
        for suite in json.load(open(p))["suites"]:
            walk(suite)
    return out


def main():
    results = passed_by_test(sys.argv[1:])
    page = PAGE.read_text()

    if "tr.fixed" not in page:
        page = page.replace("</style>", CSS + "</style>", 1)
        page = page.replace('<input id="q"', '<p class="s" id="prog"></p>\n<label class="hf"><input type="checkbox" id="hf"> Hide fixed</label>\n<input id="q"', 1)
        page = re.sub(r"<script>.*?</script>", lambda m: SCRIPT, page, count=1, flags=re.S)

    row_re = re.compile(r'<tr(?P<cls> class="fixed")?><td class="id">(?P<id>[^<]*)</td><td><div>(?P<title>.*?)</div>(?P<mid>.*?)<div class="f">(?P<kind>[^<]*?) &middot; (?P<file>[^<]*?)</div>(?P<badge><span class="ok">.*?</span>(?:<span class="note">.*?</span>)?)?</td>(?P<tail>.*?)</tr>', re.S)
    newly, regressed = [], []

    def fix_row(m):
        title = html.unescape(m["title"])
        key = (Path(m["file"]).name, title)
        was_fixed = m["cls"] is not None
        if key in results:
            now_fixed = results[key]
        else:
            now_fixed = was_fixed
        if now_fixed and not was_fixed:
            newly.append(title)
        if was_fixed and not now_fixed:
            regressed.append(title)
        if now_fixed:
            old_date = re.search(r"fixed (\d{4}-\d{2}-\d{2})", m["badge"] or "")
            note = NOTES.get(title)
            badge = f'<span class="ok">&#10003; fixed {old_date[1] if old_date else TODAY}</span>' + (f'<span class="note">{html.escape(note)}</span>' if note else "")
        else:
            badge = ""
        tr = '<tr class="fixed">' if now_fixed else "<tr>"
        return (f'{tr}<td class="id">{m["id"]}</td><td><div>{m["title"]}</div>{m["mid"]}'
                f'<div class="f">{m["kind"]} &middot; {m["file"]}</div>{badge}</td>{m["tail"]}</tr>')

    page = row_re.sub(fix_row, page)

    # Per-module summaries and chips, recomputed from the rows.
    total_all = fixed_all = 0

    def fix_details(m):
        nonlocal total_all, fixed_all
        block = m[0]
        rows = block.count("<tr")
        fixed = block.count('<tr class="fixed">')
        api = len(re.findall(r'<div class="f">API ', block))
        ui = rows - api
        total_all += rows
        fixed_all += fixed
        summary = f"<span>{rows - fixed} open &middot; {fixed} fixed &middot; {rows} originally failing ({api} API, {ui} UI)</span>"
        return re.sub(r"<summary>([^<]*)<span>.*?</span></summary>", lambda s: f"<summary>{s[1]}{summary}</summary>", block, count=1, flags=re.S)

    page = re.sub(r'<details id="[^"]+".*?</details>', fix_details, page, flags=re.S)

    def fix_chip(m):
        block = re.search(rf'<details id="{m["id"]}".*?</details>', page, flags=re.S)[0]
        rows, fixed = block.count("<tr"), block.count('<tr class="fixed">')
        return f'<a href="#{m["id"]}">{m["name"]} {rows - fixed}' + (f" <small>({fixed} fixed)</small>" if fixed else "") + "</a>"

    page = re.sub(r'<a href="#(?P<id>[a-z-]+)">(?P<name>[a-z-]+) \d+(?: <small>\(\d+ fixed\)</small>)?</a>', fix_chip, page)
    page = re.sub(r'(<p class="s" id="prog">).*?(</p>)', lambda m: f"{m[1]}Progress: {fixed_all} of {total_all} originally failing tests fixed, {total_all - fixed_all} still open.{m[2]}", page, count=1, flags=re.S)

    PAGE.write_text(page)
    print(f"newly marked fixed: {len(newly)}; regressions un-marked: {len(regressed)}; overall {fixed_all}/{total_all} fixed")
    for t in regressed:
        print("  REGRESSED:", t)


main()

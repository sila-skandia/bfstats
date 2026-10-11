#!/usr/bin/env python3
"""Turn ledger.md into records, one per row, with every address the row cites.

    ./ledger_index.py                # rewrite ledger-index.json and ledger-gaps.md
    ./ledger_index.py --check        # exit 1 if ledger-index.json is out of step
    ./ledger_index.py --add-symbols  # also record the uncatalogued lnxded
                                     # function entries in symbols.json

ledger-index.json is what `tools/bf1942-models/ghidra-cloud/ghidra_ledger.py`
writes into a Ghidra program, so a function opened in Ghidra shows the rows
that cite it. `./annotate.py` runs this and then that; see the README.

An address is a `0x` literal that falls inside one of the two images:

    lnxded   bf1942_lnxded.static   0x08048000 .. 0x087e1007  (ELF, named)
    client   BF1942.exe             0x00400000 .. 0x00a95fff  (PE, stripped)

Anything else written in hex (a float's bits, a class id, a flag) is a constant
and is left out. Each address is then one of

    entry     the first instruction of a function
    inside    an instruction inside a function; `function` is its entry
    code      executable bytes no function covers
    data      anywhere else in the image

The Linux server's functions come from its own symbol table (`nm`), so the
binary has to be on disk to regenerate. The client has no symbols:
client-functions.txt is the function table of the `bf1942-mp-enabler` Ghidra
project, dumped by `ghidra_ledger.py` (see annotate.py --dump-client-functions).
"""

from __future__ import annotations

import argparse
import bisect
import json
import os
import re
import subprocess
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
LEDGER = HERE / "ledger.md"
INDEX = HERE / "ledger-index.json"
GAPS = HERE / "ledger-gaps.md"
SYMBOLS = HERE / "symbols.json"
CLIENT_FUNCTIONS = HERE / "client-functions.txt"

LNXDED_CANDIDATES = [
    os.environ.get("LNXDED_BIN", ""),
    "/home/dylan/projects/public/bf42plus/bf1942_lnxded.static",
    str(HERE.parents[1] / "tools/bf1942-models/ghidra-cloud/.work/bf1942_lnxded.static"),
]

# Image ranges, read from the Ghidra memory maps of both programs (2026-10-11).
# lnxded: ELF segments 0x08048000 through .bss and the EXTERNAL block.
# client: PE headers 0x00400000 through .rsrc.
IMAGES = {
    "lnxded": (0x08048000, 0x087E1007),
    "client": (0x00400000, 0x00A95FFF),
}
# The client's PE headers. Nothing cites them; a `0x400000` there is a flag.
CLIENT_HEADERS_END = 0x00400FFF
# Executable ranges: lnxded .init/.plt/.text/.fini, client .text.
CODE = {
    "lnxded": (0x0804ACBC, 0x086AFC4B),
    "client": (0x00401000, 0x008C2FFF),
}

STATUS_WORDS = [
    "refuted", "verified", "confirmed", "inferred", "open", "moot", "settled",
    "closed", "read", "built", "measured", "working", "corrected", "refined",
    "retired", "restored", "fixed", "extracted", "observed", "derived",
]

ROW_ID = re.compile(r"^(~~)?\**([A-Z][A-Z0-9]*-\d+[a-z]?)\**(~~)?$")
ADDRESS = re.compile(r"(?<![0-9A-Za-z_$+\-])0x([0-9a-fA-F]{6,8})(?![0-9A-Za-z_])")
LINK = re.compile(r"\[([^\]]*)\]\([^)]*\)")
# A backticked name sitting just before the address: `loadLod` `0x083a6f00`,
# `BFSpawnPoint::getActive(bool, int)` 0x08163dd0, `getStride` (lnxded `0x08...`).
NAME_BEFORE = re.compile(
    r"`([^`]{2,140})`[\s,(:=]*(?:(?:at|is|lnxded|client|server|the)\s+)*[`(\s]*$")
IDENTIFIER = re.compile(r"^[A-Za-z_~][\w:~<>*&,\[\]. -]*(\([^()]*\))?( const)?$")


# ----------------------------------------------------------------- function tables

class FunctionTable:
    """Function entries and extents of one binary, plus its named data."""

    def __init__(self, functions, data=()):
        # functions: iterable of (start, end_inclusive, name); name may be ''.
        self.functions = sorted(set(functions))
        self.starts = [f[0] for f in self.functions]
        self.data = sorted(set(data))
        self.data_starts = [d[0] for d in self.data]

    def containing(self, va):
        i = bisect.bisect_right(self.starts, va) - 1
        if i >= 0:
            start, end, name = self.functions[i]
            if start <= va <= end:
                return start, name
        return None

    def data_symbol(self, va):
        i = bisect.bisect_right(self.data_starts, va) - 1
        if i >= 0:
            start, end, name = self.data[i]
            if start <= va <= end:
                return name if va == start else f"{name}+0x{va - start:x}"
        return ""


def find_lnxded() -> Path | None:
    for c in LNXDED_CANDIDATES:
        if c and Path(c).exists():
            return Path(c)
    return None


def lnxded_table(binary: Path) -> FunctionTable:
    """Functions and data objects from the server's symbol table."""
    out = subprocess.run(["nm", "-S", "-C", "--defined-only", str(binary)],
                         capture_output=True, text=True, check=True).stdout
    lo, hi = CODE["lnxded"]
    sized, unsized, data = {}, {}, []
    for line in out.splitlines():
        m = re.match(r"^([0-9a-f]{8}) (?:([0-9a-f]{8}) )?(\S) (.*)$", line)
        if not m:
            continue
        va, size, kind, name = int(m.group(1), 16), m.group(2), m.group(3), m.group(4)
        size = int(size, 16) if size else 0
        if kind in "TtWw" and lo <= va <= hi:
            # Two names at one address (a constructor's C1/C2 pair, an alias):
            # keep the first in sort order so the output does not depend on nm.
            bucket = sized if size else unsized
            if va not in bucket or name < bucket[va][1]:
                bucket[va] = (size, name)
        elif kind in "VvBbDdRrGgSs" and size:
            data.append((va, va + size - 1, name))
    starts = sorted(set(sized) | set(unsized))
    functions = []
    for i, va in enumerate(starts):
        if va in sized:
            size, name = sized[va]
            end = va + size - 1
        else:
            # No size recorded (hand-written assembly): runs to the next symbol.
            name = unsized[va][1]
            end = (starts[i + 1] - 1) if i + 1 < len(starts) else hi
        functions.append((va, end, name))
    return FunctionTable(functions, data)


def client_table(path: Path = CLIENT_FUNCTIONS) -> FunctionTable:
    functions = []
    for line in path.read_text().splitlines():
        if not line or line.startswith("#"):
            continue
        start, end = line.split()[:2]
        functions.append((int(start, 16), int(end, 16), ""))
    return FunctionTable(functions)


# ----------------------------------------------------------------- parsing

def split_cells(line: str) -> list[str]:
    """Split a table row on its pipes, leaving `a | b` in code spans and \\| alone."""
    cells, cur, in_code, i = [], [], False, 0
    while i < len(line):
        ch = line[i]
        if ch == "\\" and i + 1 < len(line) and line[i + 1] == "|":
            cur.append("\\|")
            i += 2
            continue
        if ch == "`":
            in_code = not in_code
        if ch == "|" and not in_code:
            cells.append("".join(cur).strip())
            cur = []
        else:
            cur.append(ch)
        i += 1
    cells.append("".join(cur).strip())
    return cells[1:-1] if len(cells) >= 2 else cells


def plain(text: str) -> str:
    """Markdown to one line of plain words."""
    text = LINK.sub(r"\1", text)
    text = text.replace("\\|", "|")
    text = re.sub(r"[*`]|~~", "", text)
    return re.sub(r"\s+", " ", text).strip()


def clip(text: str, n: int) -> str:
    if len(text) <= n:
        return text
    cut = text[:n - 3]
    if " " in cut[n // 2:]:
        cut = cut[:cut.rindex(" ")]
    return cut.rstrip(" ,;:(") + "..."


def statement(cell: str) -> str:
    text = re.sub(r"^\((?:new|was)\b[^)]*\)\s*", "", plain(cell))
    m = re.search(r"(?<=[a-z0-9)\]])\.\s+(?=[A-Z])", text)
    if m and m.start() >= 40:
        text = text[:m.start() + 1]
    return clip(text, 180)


def status_of(cell: str) -> tuple[str, str]:
    """(normalised word, the row's own wording)."""
    text = plain(cell)
    head = re.split(r"\s[—–-]\s|[.;:|]", text, maxsplit=1)[0].strip()
    wording = clip(head, 80)
    low = head.lower()
    # 'refuted' wins wherever it stands in the head ("partly refuted",
    # "confirmed for X, refuted for Y"); otherwise the first status word.
    if re.search(r"\brefuted\b", low):
        return "refuted", wording
    found = [(m.start(), w) for w in STATUS_WORDS
             for m in [re.search(rf"\b{w}\b", low)] if m]
    return (min(found)[1] if found else "other"), wording


def binary_of(va: int) -> str | None:
    for name, (lo, hi) in IMAGES.items():
        if lo <= va <= hi:
            return name
    return None


def classify(va: int, binary: str, table: FunctionTable) -> dict:
    hit = table.containing(va)
    if hit:
        start, _ = hit
        return {"kind": "entry" if start == va else "inside",
                "function": f"0x{start:08x}"}
    lo, hi = CODE[binary]
    if lo <= va <= hi:
        return {"kind": "code"}
    rec = {"kind": "data"}
    sym = table.data_symbol(va)
    if sym:
        rec["symbol"] = sym
    return rec


def name_before(text: str, pos: int) -> str:
    """The backticked identifier the row puts just before the address, if any."""
    m = NAME_BEFORE.search(text[max(0, pos - 190):pos])
    if not m:
        return ""
    name = m.group(1).strip()
    if name.lower().startswith("0x") or not IDENTIFIER.match(name):
        return ""
    # `and`, `fdivp`, `damage`: a mnemonic or a plain word, not a symbol.
    if not re.search(r"[A-Z_(]|::", name):
        return ""
    # An instruction (`mov eax, [ebx]`) is words outside any parameter list.
    if " " in re.sub(r"\([^()]*\)|<[^<>]*>", "", name).replace(" const", ""):
        return ""
    return name


def context(text: str, start: int, end: int) -> str:
    a = max(0, start - 64)
    b = min(len(text), end + 48)
    before, after = text[a:start], text[end:b]
    if a > 0 and " " in before:
        before = before[before.index(" ") + 1:]
    if b < len(text) and " " in after:
        after = after[:after.rindex(" ")]
    # Stay inside the table cell the address is in.
    before = before.rsplit(" | ", 1)[-1]
    after = after.split(" | ", 1)[0]
    return plain(before + text[start:end] + after)


def cites(text: str, tables: dict) -> list[dict]:
    """Every in-image address in a stretch of ledger text, first mention only."""
    text = LINK.sub(r"\1", text)
    out, seen = [], set()
    for m in ADDRESS.finditer(text):
        va = int(m.group(1), 16)
        binary = binary_of(va)
        if binary is None or va in seen or va <= CLIENT_HEADERS_END:
            continue
        rec = {"address": f"0x{va:08x}", "binary": binary}
        rec.update(classify(va, binary, tables[binary]))
        # `0x08510000..0x08540000` bounds a search; it is not a place in the code.
        if va & 0xFFFF == 0 and rec["kind"] in ("inside", "code"):
            continue
        seen.add(va)
        name = name_before(text, m.start())
        if name:
            rec["row_name"] = name
        rec["context"] = context(text, m.start(), m.end())
        out.append(rec)
    out.sort(key=lambda r: r["address"])
    return out


def id_key(row_id: str):
    m = re.match(r"([A-Z0-9]+?)-(\d+)([a-z]?)$", row_id)
    return (m.group(1), int(m.group(2)), m.group(3))


def parse(ledger_text: str, tables: dict) -> dict:
    rows, prose, problems = [], [], []
    section, header = "", None
    seen_ids = set()
    for lineno, line in enumerate(ledger_text.splitlines(), 1):
        if line.startswith("## "):
            section = plain(re.split(r"\s\(", line[3:], maxsplit=1)[0])
            header = None
            continue
        if not line.startswith("|"):
            found = cites(line, tables)
            for c in found:
                c["section"] = section
                c["rows"] = sorted(set(re.findall(r"\b[A-Z][A-Z0-9]*-\d+[a-z]?\b", line)), key=str)
                prose.append(c)
            continue
        cells = split_cells(line.rstrip())
        if not cells:
            continue
        if set("".join(cells)) <= set("-: "):
            continue
        if "Status" in cells and cells[0] in ("#", "ID"):
            header = cells
            continue
        m = ROW_ID.match(cells[0])
        if not m:
            # A table that is not a ledger table (the status legend, a step
            # table, a file list). Its addresses still count, as prose.
            for c in cites(line, tables):
                c["section"] = section
                c["rows"] = []
                prose.append(c)
            continue
        row_id = m.group(2)
        if row_id in seen_ids:
            problems.append(f"{row_id} appears twice; second copy skipped")
            continue
        seen_ids.add(row_id)
        if header is None:
            problems.append(f"{row_id} has no table header above it")
            status_cell, claim = "", cells[1] if len(cells) > 1 else ""
        else:
            si = header.index("Status")
            claim = cells[1] if len(cells) > 1 else ""
            if len(cells) != len(header):
                # An unescaped pipe outside a code span split a cell. The id
                # and the claim are still the first two; find the status by
                # looking for the first cell that opens with a status word.
                problems.append(
                    f"{row_id} has {len(cells)} cells under a "
                    f"{len(header)}-column header")
                status_cell = ""
                for c in cells[2:]:
                    if status_of(c)[0] != "other" and len(plain(c).split()) and \
                            re.match(r"[\s*~`]*(partly |half |verified|confirmed|refuted|open|inferred|moot|settled|closed|read|built|measured)", c, re.I):
                        status_cell = c
                        break
                if not status_cell and si < len(cells):
                    status_cell = cells[si]
            else:
                status_cell = cells[si]
        status, wording = status_of(status_cell)
        struck = bool(m.group(1)) or claim.lstrip().startswith("~~")
        rows.append({
            "id": row_id,
            "section": section,
            "status": status,
            "status_text": wording,
            "struck": struck,
            "refuted": status == "refuted" or struck,
            "statement": statement(claim),
            "cites": cites(line, tables),
        })
    rows.sort(key=lambda r: id_key(r["id"]))
    prose.sort(key=lambda c: (c["address"], c["section"], c["context"]))
    # The names of the functions cited, once each. Only lnxded has any.
    functions = {}
    for c in [c for r in rows for c in r["cites"]] + prose:
        fn = c.get("function")
        if fn and fn not in functions:
            name = tables[c["binary"]].containing(int(fn, 16))[1]
            if name:
                functions[fn] = name
    return {"rows": rows, "prose": prose, "problems": problems,
            "functions": dict(sorted(functions.items()))}


# ----------------------------------------------------------------- output

def render(doc: dict) -> str:
    """Deterministic JSON, one row per line so a new ledger row is a one-line diff."""
    head = {
        "generated_by": "features/bf1942-engine-reference/ledger_index.py - do not edit",
        "images": {k: [f"0x{lo:08x}", f"0x{hi:08x}"] for k, (lo, hi) in sorted(IMAGES.items())},
    }
    dump = lambda o: json.dumps(o, ensure_ascii=False, sort_keys=True)
    lines = ["{"]
    for k, v in head.items():
        lines.append(f" {json.dumps(k)}: {dump(v)},")
    lines.append(' "functions": {')
    lines.append(",\n".join(f"  {json.dumps(k)}: {json.dumps(v)}"
                            for k, v in doc["functions"].items()))
    lines.append(" },")
    lines.append(' "rows": [')
    lines.append(",\n".join("  " + dump(r) for r in doc["rows"]))
    lines.append(" ],")
    lines.append(' "prose": [')
    lines.append(",\n".join("  " + dump(r) for r in doc["prose"]))
    lines.append(" ],")
    lines.append(f' "problems": {json.dumps(doc["problems"], ensure_ascii=False, indent=1)}')
    lines.append("}")
    return "\n".join(lines) + "\n"


def stats(doc: dict) -> dict:
    rows = doc["rows"]
    per = {}
    for r in rows:
        for c in r["cites"]:
            per.setdefault(c["binary"], {}).setdefault(c["kind"], set()).add(c["address"])
    for c in doc["prose"]:
        per.setdefault(c["binary"], {}).setdefault(c["kind"], set()).add(c["address"])
    status = {}
    for r in rows:
        status[r["status"]] = status.get(r["status"], 0) + 1
    return {
        "rows": len(rows),
        "rows_without_address": sum(1 for r in rows if not r["cites"]),
        "rows_struck": sum(1 for r in rows if r["struck"]),
        "cites": sum(len(r["cites"]) for r in rows),
        "prose_cites": len(doc["prose"]),
        "status": dict(sorted(status.items())),
        "addresses": {b: {k: len(v) for k, v in sorted(kinds.items())}
                      for b, kinds in sorted(per.items())},
        "problems": len(doc["problems"]),
    }


def load_tables() -> dict:
    binary = find_lnxded()
    if binary is None:
        sys.exit("bf1942_lnxded.static not found. Set LNXDED_BIN, or run "
                 "tools/bf1942-models/ghidra-cloud/setup.sh (it downloads the binary).")
    return {"lnxded": lnxded_table(binary), "client": client_table()}


def build() -> dict:
    return parse(LEDGER.read_text(encoding="utf-8"), load_tables())


# ----------------------------------------------------------------- gaps and symbols

def address_rows(doc: dict) -> dict:
    """address -> {'cite': first cite record, 'rows': [(id, status, context)]}."""
    out = {}
    for r in doc["rows"]:
        for c in r["cites"]:
            e = out.setdefault(c["address"], {"cite": c, "rows": []})
            e["rows"].append((r["id"], r["status"], c["context"], c.get("row_name", "")))
    return out


def subsystem_votes(doc: dict, symbols: list) -> dict:
    """Ledger prefix -> the subsystem its already-recorded symbols mostly carry."""
    by_addr = {s["address"]: s for s in symbols}
    votes = {}
    for r in doc["rows"]:
        prefix = id_key(r["id"])[0]
        for c in r["cites"]:
            s = by_addr.get(c["address"])
            if s and s["subsystem"] != "unsorted":
                tally = votes.setdefault(prefix, {})
                tally[s["subsystem"]] = tally.get(s["subsystem"], 0) + 1
    return {p: sorted(t.items(), key=lambda kv: (-kv[1], kv[0]))[0][0] for p, t in votes.items()}


def new_symbols(doc: dict, symbols: list, source: str) -> list:
    """lnxded function entries a ledger row cites that symbols.json lacks.

    The name is the binary's own (nm, demangled), so it is never a guess. The
    confidence says whether a row that read the code stands behind the address.
    """
    have = {s["address"] for s in symbols}
    votes = subsystem_votes(doc, symbols)
    out = []
    for addr, e in sorted(address_rows(doc).items()):
        c = e["cite"]
        if addr in have or c["binary"] != "lnxded" or c["kind"] != "entry":
            continue
        name = doc["functions"].get(addr)
        if not name:
            continue
        rows = sorted(e["rows"], key=lambda t: id_key(t[0]))
        read = any(st in ("verified", "confirmed", "refuted", "settled", "read", "closed")
                   for _, st, _, _ in rows)
        tally = {}
        for rid, _, _, _ in rows:
            sub = votes.get(id_key(rid)[0])
            if sub:
                tally[sub] = tally.get(sub, 0) + 1
        subsystem = sorted(tally.items(), key=lambda kv: (-kv[1], kv[0]))[0][0] if tally else "unsorted"
        ids = ", ".join(f"{rid} ({st})" for rid, st, _, _ in rows[:8])
        if len(rows) > 8:
            ids += f" and {len(rows) - 8} more"
        note = (f"Cited by ledger {ids}. {rows[0][0]}: \"{clip(rows[0][2], 200)}\". "
                "Name from the lnxded symbol table.")
        out.append({
            "address": addr, "name": name, "kind": "function",
            "subsystem": subsystem, "confidence": "verified" if read else "inferred",
            "source": source, "note": note,
        })
    return out


def merge_symbols(additions: list) -> int:
    """Merge by address: an existing address keeps its name, its note is extended."""
    doc = json.loads(SYMBOLS.read_text())
    by_addr = {s["address"]: s for s in doc["symbols"]}
    added = 0
    for s in additions:
        old = by_addr.get(s["address"])
        if old is None:
            doc["symbols"].append(s)
            by_addr[s["address"]] = s
            added += 1
        elif s["note"] and s["note"] not in (old.get("note") or ""):
            old["note"] = ((old.get("note") or "").rstrip() + " " + s["note"]).strip()
    doc["symbols"].sort(key=lambda s: int(s["address"], 16))
    SYMBOLS.write_text(json.dumps(doc, indent=1) + "\n")
    return added


def gaps(doc: dict, symbols: list) -> str:
    have = {s["address"]: s for s in symbols}
    cited = address_rows(doc)
    prose_cited = {c["address"] for c in doc["prose"]}
    st = stats(doc)

    def rows_of(e, n=6):
        ids = [rid for rid, _, _, _ in sorted(e["rows"], key=lambda t: id_key(t[0]))]
        return ", ".join(ids[:n]) + (f" +{len(ids) - n}" if len(ids) > n else "")

    L = []
    w = L.append
    w("# Ledger and symbol table: the gaps")
    w("")
    w("Generated by `./ledger_index.py`. Do not edit; rerun it.")
    w("")
    w(f"{st['rows']} ledger rows, {st['rows_without_address']} of them cite no address. "
      f"{len(cited)} distinct addresses are cited from rows and {len(have)} are in "
      "`symbols.json`.")
    w("")
    w("| Binary | entry | inside a function | code outside any function | data |")
    w("|---|---|---|---|---|")
    for b, kinds in st["addresses"].items():
        w(f"| {b} | {kinds.get('entry', 0)} | {kinds.get('inside', 0)} | "
          f"{kinds.get('code', 0)} | {kinds.get('data', 0)} |")
    w("")

    for binary, title, hint in (
        ("lnxded", "Linux server function entries the ledger cites and `symbols.json` lacks",
         "Add them with `./ledger_index.py --add-symbols`: the name is the binary's own."),
        ("client", "Client function entries the ledger cites and `symbols.json` lacks",
         "The client is stripped. Name one only from what a row established, with "
         "`./xref.py add`; the third column is what the citing row calls it, where it does."),
    ):
        missing = [(a, e) for a, e in sorted(cited.items())
                   if a not in have and e["cite"]["binary"] == binary and e["cite"]["kind"] == "entry"]
        w(f"## {title}")
        w("")
        w(f"{len(missing)}. {hint}")
        w("")
        if missing:
            w("| Address | Rows | Name |")
            w("|---|---|---|")
            for a, e in missing:
                c = e["cite"]
                name = doc["functions"].get(a) or next((n for _, _, _, n in e["rows"] if n), "")
                w(f"| `{a}` | {rows_of(e)} | {('`' + name + '`') if name else ''} |")
            w("")

    loose = [(a, e) for a, e in sorted(cited.items()) if e["cite"]["kind"] == "code"]
    w("## Client code the ledger cites that no Ghidra function covers")
    w("")
    w(f"{len(loose)}. The `bf1942-mp-enabler` project has no function over these "
      "addresses (`client-functions.txt`), so Ghidra shows their annotation as a "
      "comment on bare code and cannot decompile them. Create the function in "
      "Ghidra, save, and refresh the table with `./annotate.py <dir> <project> "
      "--dump-client-functions`.")
    w("")
    if loose:
        w("| Address | Rows | `symbols.json` name |")
        w("|---|---|---|")
        for a, e in loose:
            s = have.get(a)
            w(f"| `{a}` | {rows_of(e)} | {('`' + s['name'] + '`') if s else ''} |")
        w("")

    data_missing = [(a, e) for a, e in sorted(cited.items())
                    if a not in have and e["cite"]["kind"] == "data"]
    w("## Data addresses the ledger cites and `symbols.json` lacks")
    w("")
    w(f"{len(data_missing)}: constants, globals and vtables. Listed for `./xref.py add`; "
      "the name column is the lnxded symbol where the binary has one.")
    w("")
    if data_missing:
        w("| Address | Binary | Rows | Symbol |")
        w("|---|---|---|---|")
        for a, e in data_missing:
            c = e["cite"]
            sym = c.get("symbol", "")
            w(f"| `{a}` | {c['binary']} | {rows_of(e)} | {('`' + sym + '`') if sym else ''} |")
        w("")

    orphans = [s for s in symbols if s["address"] not in cited and s["address"] not in prose_cited]
    w("## `symbols.json` entries no ledger row cites")
    w("")
    w(f"{len(orphans)} of {len(symbols)}. Most are the bf42plus seed and symbols a "
      "subsystem note cites instead of a row. A `verified` symbol here has its "
      "evidence somewhere other than the ledger, or nowhere.")
    w("")
    tally = {}
    for s in orphans:
        k = (s["source"], s["confidence"])
        tally[k] = tally.get(k, 0) + 1
    w("| Source | Confidence | Count |")
    w("|---|---|---|")
    for (src, conf), n in sorted(tally.items(), key=lambda kv: (-kv[1], kv[0])):
        w(f"| {src} | {conf} | {n} |")
    w("")
    w("| Address | Confidence | Subsystem | Name |")
    w("|---|---|---|---|")
    for s in orphans:
        w(f"| `{s['address']}` | {s['confidence']} | {s['subsystem']} | `{s['name']}` |")
    w("")
    if doc["problems"]:
        w("## Rows the parser had to guess at")
        w("")
        for p in doc["problems"]:
            w(f"- {p}")
        w("")
    return "\n".join(L)


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--check", action="store_true",
                    help="exit 1 if ledger-index.json is not what the ledger yields")
    ap.add_argument("--add-symbols", action="store_true",
                    help="record uncatalogued lnxded function entries in symbols.json")
    ap.add_argument("--source", default="ledger-index",
                    help="the `source` written on symbols --add-symbols records")
    ap.add_argument("--quiet", action="store_true")
    args = ap.parse_args()

    doc = build()
    text = render(doc)
    if args.check:
        if not INDEX.exists() or INDEX.read_text(encoding="utf-8") != text:
            sys.exit("ledger-index.json is out of step with ledger.md: run ./ledger_index.py")
        print("ledger-index.json is in step")
        return
    INDEX.write_text(text, encoding="utf-8")
    symbols = json.loads(SYMBOLS.read_text())["symbols"]
    added = 0
    if args.add_symbols:
        added = merge_symbols(new_symbols(doc, symbols, args.source))
        symbols = json.loads(SYMBOLS.read_text())["symbols"]
    GAPS.write_text(gaps(doc, symbols), encoding="utf-8")
    if not args.quiet:
        out = stats(doc)
        out["symbols_added"] = added
        print(json.dumps(out, indent=1))


if __name__ == "__main__":
    main()

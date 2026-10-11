# Write what the repo knows about an address into the Ghidra program, so that
# opening a function shows the ledger rows that cite it.
#
# Run through apply_labels.py, or with one command from the engine reference:
#   features/bf1942-engine-reference/annotate.py <project_dir> <project>
#
# Reads ledger-index.json (features/bf1942-engine-reference/ledger_index.py
# makes it from ledger.md) and symbols.json, and writes, for the binary the
# program is (the Linux server or the client):
#
#   function entry      plate comment: each ledger row citing it (id, status,
#                       one-line statement) and the symbols.json note
#   any other address   pre comment: the row id and the words around the address
#   every ledger cite   a bookmark of type "bfstats", category = the row id, so
#                       the Bookmarks window filtered on a category lists a row
#   client only         the symbols.json name as a label where the address has
#                       only a default name (FUN_, DAT_, LAB_)
#
# Every line it writes starts with "[bfstats]". A re-run rewrites those lines
# and its own bookmarks and labels, and touches nothing else: other comment
# lines at the same address are kept, and a name it did not apply is never
# replaced (the conflict is reported instead). A run that changes nothing
# leaves the program unmodified.
#
# Environment:
#   BFSTATS_LEDGER_INDEX   ledger-index.json   (default: found from the cwd)
#   BFSTATS_SYMBOLS        symbols.json        (default: beside the index)
#   BFSTATS_LEDGER_REPORT  write the counts here as JSON
#   BFSTATS_LEDGER_STRIP   "1": remove everything this script ever wrote
#@category bfstats

import json
import os
import re
import textwrap

from ghidra.program.model.symbol import SourceType

try:
    from ghidra.program.model.listing import CommentType
    PLATE, PRE = CommentType.PLATE, CommentType.PRE
except ImportError:  # Ghidra before 11.4
    from ghidra.program.model.listing import CodeUnit
    PLATE, PRE = CodeUnit.PLATE_COMMENT, CodeUnit.PRE_COMMENT

TAG = "[bfstats]"
BOOKMARK_TYPE = "bfstats"
LABEL_PROPERTY = "bfstats_label"
LABEL_KINDS = ("function", "data", "vtable", "string")
WIDTH = 100

program = currentProgram
listing = program.getListing()
memory = program.getMemory()
symtab = program.getSymbolTable()
funcs = program.getFunctionManager()
bookmarks = program.getBookmarkManager()
space = program.getAddressFactory().getDefaultAddressSpace()


def find_index():
    p = os.environ.get("BFSTATS_LEDGER_INDEX")
    if p:
        return p
    d = os.getcwd()
    while True:
        c = os.path.join(d, "features", "bf1942-engine-reference", "ledger-index.json")
        if os.path.exists(c):
            return c
        if os.path.dirname(d) == d:
            raise RuntimeError("ledger-index.json not found; set BFSTATS_LEDGER_INDEX")
        d = os.path.dirname(d)


def which_binary():
    fmt = str(program.getExecutableFormat() or "")
    base = program.getImageBase().getOffset()
    if "ELF" in fmt and base == 0x08048000:
        return "lnxded"
    if "PE" in fmt and base == 0x00400000 and program.getName().lower() == "bf1942.exe":
        return "client"
    raise RuntimeError("%s (%s, base 0x%08x) is neither bf1942_lnxded.static nor BF1942.exe"
                       % (program.getName(), fmt, base))


def wrap(head, body):
    """Lines of at most WIDTH, every one opening with the tag."""
    lines = textwrap.wrap("%s %s" % (head, body), WIDTH - len(TAG) - 1,
                          subsequent_indent="  ", break_long_words=False,
                          break_on_hyphens=False)
    return ["%s %s" % (TAG, l) for l in lines]


def status_word(row):
    if row["refuted"]:
        return "REFUTED" if row["status"] == "refuted" else "REFUTED (struck through)"
    return row["status_text"] or row["status"]


def label_name(name):
    """A symbols.json name as a Ghidra label, or '' when it is a sentence."""
    name = re.sub(r"\s*\([^()]*\)\s*(const)?\s*$", "", name.strip())
    name = re.sub(r"\s*\([^()]*\)", "", name)
    name = name.replace("::", "__")
    name = re.sub(r"[^A-Za-z0-9_~<>@$?.]+", "_", name).strip("_")
    if not name or len(name) > 96 or name.count("_") > 12:
        return ""
    return name


binary = which_binary()
index_path = find_index()
symbols_path = os.environ.get("BFSTATS_SYMBOLS") or os.path.join(os.path.dirname(index_path), "symbols.json")
strip_only = os.environ.get("BFSTATS_LEDGER_STRIP") == "1"
with open(index_path, encoding="utf-8") as f:
    index = json.load(f)
with open(symbols_path, encoding="utf-8") as f:
    symbols = json.load(f)["symbols"]
lo, hi = [int(x, 16) for x in index["images"][binary]]

counts = {
    "program": program.getName(), "binary": binary,
    "ledger_rows_citing_this_binary": 0, "ledger_cites": 0,
    "functions_annotated": 0, "functions_with_ledger_rows": 0,
    "inline_comments": 0, "inline_without_ghidra_function": 0,
    "comments_on_data_or_unowned_code": 0,
    "symbol_notes": 0, "bookmarks": 0, "bookmark_categories": 0,
    "labels_applied": 0, "labels_already_there": 0, "labels_renamed": 0,
    "labels_removed": 0, "labels_skipped_sentence": 0, "label_conflicts": [],
    "outside_program": [], "moved_to_code_unit_start": 0,
    "comments_written": 0, "comments_cleared": 0,
    "bookmarks_added": 0, "bookmarks_removed": 0,
}

# ---------------------------------------------------------------- what to write

plate = {}       # address offset -> [lines]
pre = {}         # address offset -> [lines]
want_marks = {}  # (offset, category) -> comment
entry_rows = set()
inline_addrs = set()     # inside a function, by Ghidra or by the index (nm)
unowned_addrs = set()    # ...of those, the ones no Ghidra function covers
outside_addrs = set()    # data, or code nothing claims


def place(va):
    """(offset to annotate, function containing it or None, is entry)."""
    addr = space.getAddress(va)
    if not memory.contains(addr):
        return None
    fn = funcs.getFunctionContaining(addr)
    if fn is not None and fn.getEntryPoint().getOffset() == va:
        return va, fn, True
    cu = listing.getCodeUnitContaining(addr)
    at = cu.getMinAddress().getOffset() if cu is not None else va
    return at, fn, False


def note_inline(at, fn, kind):
    if fn is not None or kind == "inside":
        inline_addrs.add(at)
        if fn is None:
            unowned_addrs.add(at)
    else:
        outside_addrs.add(at)


def cite(va, head, entry_text, inline_text, category, kind):
    where = place(va)
    if where is None:
        counts["outside_program"].append("0x%08x %s" % (va, category or "prose"))
        return
    at, fn, is_entry = where
    if is_entry:
        plate.setdefault(at, []).extend(wrap(head, entry_text))
        entry_rows.add(at)
    else:
        text = inline_text
        if at != va:
            text = "(at 0x%08x) %s" % (va, text)
            counts["moved_to_code_unit_start"] += 1
        pre.setdefault(at, []).extend(wrap(head, text))
        note_inline(at, fn, kind)
    if category:
        note = entry_text if is_entry else inline_text
        want_marks[(at, category)] = ("%s %s" % (head.split(" ", 1)[1] if " " in head else "", note)).strip()[:300]


if not strip_only:
    for row in index["rows"]:
        mine = [c for c in row["cites"] if c["binary"] == binary]
        if not mine:
            continue
        counts["ledger_rows_citing_this_binary"] += 1
        head = "%s %s:" % (row["id"], status_word(row))
        for c in mine:
            counts["ledger_cites"] += 1
            cite(int(c["address"], 16), head, row["statement"], c["context"], row["id"], c["kind"])
    for c in index["prose"]:
        if c["binary"] != binary:
            continue
        head = "ledger, %s%s:" % (c["section"][:40], (" (" + ", ".join(c["rows"][:4]) + ")") if c["rows"] else "")
        cite(int(c["address"], 16), head, c["context"], c["context"], None, c["kind"])
    for s in symbols:
        va = int(s["address"], 16)
        if not (lo <= va <= hi):
            continue
        where = place(va)
        if where is None:
            counts["outside_program"].append("0x%08x symbols.json %s" % (va, s["name"]))
            continue
        at, fn, is_entry = where
        note = (s.get("note") or "").strip()
        cap = 700 if is_entry else 300
        if len(note) > cap:
            note = note[:cap].rsplit(" ", 1)[0] + " ... (xref.py sym %s)" % s["address"]
        lines = wrap("symbols.json: %s (%s, %s, %s)" % (s["name"], s["kind"], s["confidence"], s["source"]), note)
        (plate if is_entry else pre).setdefault(at, []).extend(lines)
        if not is_entry:
            note_inline(at, fn, "")
        counts["symbol_notes"] += 1

# ---------------------------------------------------------------- comments


def tagged_addresses(kind):
    out = set()
    it = listing.getCommentAddressIterator(kind, memory, True)
    while it.hasNext():
        a = it.next()
        text = listing.getComment(kind, a)
        if text and TAG in text:
            out.add(a.getOffset())
    return out


def sync_comments(kind, wanted):
    for va in sorted(tagged_addresses(kind) | set(wanted)):
        addr = space.getAddress(va)
        old = listing.getComment(kind, addr)
        kept = [l for l in (old or "").split("\n") if l.strip() and not l.startswith(TAG)]
        new = "\n".join(kept + wanted.get(va, [])) or None
        if new != (old or None):
            listing.setComment(addr, kind, new)
            counts["comments_written" if new and TAG in new else "comments_cleared"] += 1


sync_comments(PLATE, plate)
sync_comments(PRE, pre)
counts["functions_annotated"] = len(plate)
counts["functions_with_ledger_rows"] = len(entry_rows)
counts["inline_comments"] = len(inline_addrs)
counts["inline_without_ghidra_function"] = len(unowned_addrs)
counts["comments_on_data_or_unowned_code"] = len(outside_addrs - inline_addrs)

# ---------------------------------------------------------------- bookmarks

have_marks = {}
it = bookmarks.getBookmarksIterator(BOOKMARK_TYPE)
while it.hasNext():
    b = it.next()
    have_marks[(b.getAddress().getOffset(), str(b.getCategory()))] = b
for key, b in sorted(have_marks.items()):
    if key not in want_marks:
        bookmarks.removeBookmark(b)
        counts["bookmarks_removed"] += 1
for (va, category), comment in sorted(want_marks.items()):
    b = have_marks.get((va, category))
    if b is None or str(b.getComment()) != comment:
        bookmarks.setBookmark(space.getAddress(va), BOOKMARK_TYPE, category, comment)
        counts["bookmarks_added"] += 1
counts["bookmarks"] = len(want_marks)
counts["bookmark_categories"] = len(set(c for _, c in want_marks))

# ---------------------------------------------------------------- labels (client)

if binary == "client":
    props = program.getUsrPropertyManager()
    applied = props.getStringPropertyMap(LABEL_PROPERTY)
    if applied is None:
        applied = props.createStringPropertyMap(LABEL_PROPERTY)
    want_labels = {}
    if not strip_only:
        for s in symbols:
            va = int(s["address"], 16)
            if not (lo <= va <= hi) or s["kind"] not in LABEL_KINDS:
                continue
            name = label_name(s["name"])
            if not name:
                counts["labels_skipped_sentence"] += 1
                continue
            want_labels[va] = name
    # Labels this script applied on an earlier run and no longer wants.
    stale = []
    it = applied.getPropertyIterator()
    while it.hasNext():
        a = it.next()
        if a.getOffset() not in want_labels:
            stale.append(a)
    for a in stale:
        sym = symtab.getPrimarySymbol(a)
        if sym is not None and sym.getName() == applied.getString(a):
            sym.delete()
            counts["labels_removed"] += 1
        applied.remove(a)
    for va, name in sorted(want_labels.items()):
        addr = space.getAddress(va)
        if not memory.contains(addr):
            continue
        sym = symtab.getPrimarySymbol(addr)
        ours = applied.getString(addr) if applied.hasProperty(addr) else None
        try:
            if sym is None or sym.getSource() == SourceType.DEFAULT:
                fn = funcs.getFunctionAt(addr)
                if fn is not None:
                    fn.setName(name, SourceType.USER_DEFINED)
                else:
                    symtab.createLabel(addr, name, SourceType.USER_DEFINED).setPrimary()
                applied.add(addr, name)
                counts["labels_applied"] += 1
            elif sym.getName() == name:
                counts["labels_already_there"] += 1
            elif ours is not None and sym.getName() == ours:
                sym.setName(name, SourceType.USER_DEFINED)  # ours; symbols.json renamed it
                applied.add(addr, name)
                counts["labels_renamed"] += 1
            else:
                counts["label_conflicts"].append(
                    "0x%08x has %s (%s); symbols.json says %s" % (va, sym.getName(), sym.getSource(), name))
        except Exception as e:
            counts["label_conflicts"].append("0x%08x %s: %s" % (va, name, e))

# ---------------------------------------------------------------- report

counts["outside_program"] = sorted(set(counts["outside_program"]))
report = os.environ.get("BFSTATS_LEDGER_REPORT")
if report:
    with open(report, "w") as f:
        json.dump(counts, f, indent=1, sort_keys=True)
        f.write("\n")
println("bfstats ledger annotations, %s (%s)" % (program.getName(), binary))
if listing.getNumInstructions() < 100000:
    println("  NOTE: this program was never auto-analysed (%d instructions). Function bodies are" % listing.getNumInstructions())
    println("  one byte, so inline comments sit on undefined bytes and the decompiler will not show them.")
for k in sorted(counts):
    v = counts[k]
    if isinstance(v, list):
        println("  %-34s %d" % (k, len(v)))
        for item in v[:12]:
            println("      " + item)
        if len(v) > 12:
            println("      ... %d more (see the report file)" % (len(v) - 12))
    else:
        println("  %-34s %s" % (k, v))

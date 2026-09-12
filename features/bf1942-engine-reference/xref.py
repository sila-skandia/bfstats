#!/usr/bin/env python3
"""Look things up in the BF1942.exe reference corpus, and drive Ghidra when it can't.

A future agent should never have to rediscover either the symbol table or the
Ghidra bridge's HTTP API. That is what this script is for.

    ./xref.py check                      # is the bridge up, and is it the right binary?
    ./xref.py sym 0x005d0140             # what do we know about this address?
    ./xref.py sym StandardMesh           # ...or this name (substring, case-insensitive)
    ./xref.py list geom                  # everything in a subsystem
    ./xref.py decompile 0x005d0140       # pull C from Ghidra
    ./xref.py xrefs 0x00908a90           # who references this address
    ./xref.py strings 'StandardMesh'     # regex search the binary's strings
    ./xref.py add 0x0012345 NAME --kind function --subsystem geom \
              --confidence verified --note "what you established and how"

`add` is the important one: anything you work out goes back into symbols.json in
the same breath, or the next agent pays to learn it again.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import sys
import urllib.parse
import urllib.request
from pathlib import Path

HERE = Path(__file__).resolve().parent
SYMBOLS = HERE / "symbols.json"
BRIDGE = "http://127.0.0.1:8089"


def load() -> dict:
    return json.loads(SYMBOLS.read_text())


def save(doc: dict) -> None:
    doc["symbols"].sort(key=lambda s: int(s["address"], 16))
    SYMBOLS.write_text(json.dumps(doc, indent=1) + "\n")


def norm(a: str) -> str:
    """'5d0140', '0x5d0140', '005D0140' all mean the same address."""
    return f"0x{int(a, 16):08x}"


def get(path: str, **params) -> dict | str:
    url = f"{BRIDGE}{path}"
    if params:
        url += "?" + urllib.parse.urlencode({k: v for k, v in params.items() if v is not None})
    try:
        with urllib.request.urlopen(url, timeout=60) as r:
            body = r.read().decode("utf-8", "replace")
    except Exception as e:
        sys.exit(
            f"Ghidra bridge unreachable at {BRIDGE}: {e}\n"
            "Start Ghidra, open the bf1942-mp-enabler project with BF1942.exe, and make\n"
            "sure the GhidraMCP extension is enabled (File > Configure > Miscellaneous)."
        )
    try:
        return json.loads(body)
    except json.JSONDecodeError:
        return body


# --------------------------------------------------------------------------- commands

def cmd_check(args) -> None:
    doc = load()
    b = doc["binary"]
    print(get("/check_connection"))
    meta = get("/get_metadata")
    if isinstance(meta, dict):
        print(f"  program        {meta.get('program_name')}")
        print(f"  path           {meta.get('executable_path')}")
        print(f"  base           {meta.get('base_address')}")
        print(f"  functions      {meta.get('function_count')}")

    exe = Path(b["local_path"].replace("~", str(Path.home())))
    if exe.exists():
        digest = hashlib.sha256(exe.read_bytes()).hexdigest()
        ok = digest == b["sha256"]
        print(f"  sha256         {digest} {'MATCH' if ok else 'MISMATCH'}")
        if not ok:
            print("\n  !! Addresses in symbols.json do NOT apply to this binary.", file=sys.stderr)
            sys.exit(1)
    else:
        print(f"  sha256         cannot verify, {exe} not found")
    print(f"  corpus         {len(doc['symbols'])} symbols")


def cmd_sym(args) -> None:
    doc = load()
    q = args.query
    try:
        target = int(norm(q), 16)
        hits = [s for s in doc["symbols"] if int(s["address"], 16) == target]
        if not hits:
            # Nearest preceding symbol - usually the function an address sits inside.
            below = [s for s in doc["symbols"] if int(s["address"], 16) < target]
            if below:
                n = max(below, key=lambda s: int(s["address"], 16))
                delta = target - int(n["address"], 16)
                print(f"no exact match; nearest preceding is +0x{delta:x} from:")
                hits = [n]
    except ValueError:
        ql = q.lower()
        hits = [s for s in doc["symbols"] if ql in s["name"].lower()]

    if not hits:
        print(f"nothing for {q!r}. Try: xref.py strings {q!r}")
        return
    for s in hits:
        print(f"{s['address']}  {s['name']}")
        print(f"    kind={s['kind']}  subsystem={s['subsystem']}  "
              f"confidence={s['confidence']}  source={s['source']}")
        if s.get("note"):
            print(f"    {s['note']}")


def cmd_list(args) -> None:
    doc = load()
    syms = doc["symbols"]
    if args.subsystem:
        syms = [s for s in syms if s["subsystem"] == args.subsystem]
    if args.confidence:
        syms = [s for s in syms if s["confidence"] == args.confidence]
    for s in syms:
        print(f"{s['address']}  {s['confidence']:9s} {s['subsystem']:10s} {s['name']}")
    print(f"\n{len(syms)} symbols", file=sys.stderr)


def cmd_decompile(args) -> None:
    r = get("/decompile_function", address=args.address)
    if isinstance(r, dict) and r.get("decompiled"):
        print(f"/* {r.get('name')} @ {r.get('address')} */")
        print(r["decompiled"])
    else:
        print(r)
        print("\nHint: 'No function found' means Ghidra never defined a function here.\n"
              "      Use /create_function, or look at the containing block in the GUI.",
              file=sys.stderr)


def cmd_xrefs(args) -> None:
    r = get("/get_xrefs_to", address=args.address, limit=args.limit)
    for ref in (r.get("references", []) if isinstance(r, dict) else []):
        fn = ref.get("from_function", "")
        print(f"{ref['from_address']}  {ref['type']:8s} {fn}")
    if isinstance(r, dict):
        print(f"\n{r.get('total', 0)} total", file=sys.stderr)


def cmd_strings(args) -> None:
    r = get("/search_strings", search_term=args.pattern, limit=args.limit)
    for m in (r.get("matches", []) if isinstance(r, dict) else []):
        print(f"{m['address']}  {m['value']!r}")


def cmd_add(args) -> None:
    doc = load()
    addr = norm(args.address)
    doc["symbols"] = [s for s in doc["symbols"] if s["address"] != addr]
    doc["symbols"].append({
        "address": addr, "name": args.name, "kind": args.kind,
        "subsystem": args.subsystem, "confidence": args.confidence,
        "source": args.source, "note": args.note or "",
    })
    save(doc)
    print(f"recorded {addr}  {args.name}  ({args.confidence})")


def main() -> None:
    p = argparse.ArgumentParser(description=__doc__,
                                formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = p.add_subparsers(dest="cmd", required=True)

    sub.add_parser("check", help="bridge health + binary hash check").set_defaults(fn=cmd_check)

    s = sub.add_parser("sym", help="look up an address or name")
    s.add_argument("query")
    s.set_defaults(fn=cmd_sym)

    s = sub.add_parser("list", help="list the corpus")
    s.add_argument("subsystem", nargs="?")
    s.add_argument("--confidence")
    s.set_defaults(fn=cmd_list)

    s = sub.add_parser("decompile")
    s.add_argument("address")
    s.set_defaults(fn=cmd_decompile)

    s = sub.add_parser("xrefs")
    s.add_argument("address")
    s.add_argument("--limit", type=int, default=40)
    s.set_defaults(fn=cmd_xrefs)

    s = sub.add_parser("strings")
    s.add_argument("pattern")
    s.add_argument("--limit", type=int, default=40)
    s.set_defaults(fn=cmd_strings)

    s = sub.add_parser("add", help="record a finding")
    s.add_argument("address")
    s.add_argument("name")
    s.add_argument("--kind", default="function",
                   choices=["function", "data", "string", "patch_site", "vtable", "range", "address"])
    s.add_argument("--subsystem", default="unsorted")
    s.add_argument("--confidence", default="inferred",
                   choices=["verified", "working", "inferred", "open"])
    s.add_argument("--source", default="ghidra-session")
    s.add_argument("--note")
    s.set_defaults(fn=cmd_add)

    args = p.parse_args()
    args.fn(args)


if __name__ == "__main__":
    main()

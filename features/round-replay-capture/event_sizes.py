#!/usr/bin/env python3
"""Every network event type BF1942.exe defines, and its exact struct size.

    python3 event_sizes.py [--exe PATH] [--json]

Reads the sizes out of the engine's own code; Ghidra is not needed.

1. GameEvent::registerEventMaker (0x004A7D70) is called once per event type as
       mov edx, <maker>; mov ecx, <event id>; call registerEventMaker
2. Each maker is a lone vtable pointer in .data. Slot 1, createEvent, opens with
       mov ecx, sizeof(T); call GameEvent::allocate (0x004A6290)
   Slot 0, createEventCopy, loads the same literal, sometimes after saving
   registers first.

Sizes include the 12-byte GameEvent header (vtable, sequenceNumber, nextEvent),
so the payload a recording can dump is size - 12. They are cross-checked
against every struct bf42plus static_asserts in src/bf/gameevent.h, and the
bf42plus recorder reads the same literal at runtime (replay.cpp, eventSize).

Every BF1942 mod runs this same exe, so the table holds for all of them. Other
exe builds relocate everything, so the sha256 is checked before anything else.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import re
import struct
import sys
from pathlib import Path

DEFAULT_EXE = Path.home() / ".wine/drive_c/EA Games/Battlefield 1942/BF1942.exe"
EXPECTED_SHA256 = "60c9452d1ddb6a09a7b2bd6aa49a8a5508504d0f0e458cc61f0aebff53cd3699"
ALLOCATE = 0x004A6290
REGISTER_MAKER = 0x004A7D70
HEADER = 12

# sizeof() that bf42plus static_asserts in src/bf/gameevent.h.
ASSERTED = {
    0x08: ("CreatePlayer", 0x39), 0x0C: ("DestroyPlayer", 0x0D), 0x12: ("Vote", 0x1D),
    0x17: ("WelcomeMsg", 0x54), 0x24: ("GameStatus", 0x33), 0x27: ("SpecialGame", 0x0D),
    0x28: ("ChatFragment", 0x26), 0x2A: ("ScoreMsg", 0x1A), 0x39: ("SetTeam", 0x0E),
    0x3A: ("RadioMessage", 0x10),
}
# Named in gameevent.h, but with no struct to assert against.
NAMED = {0x34: "DataBaseComplete", 0x36: "SetLevel"}


class Image:
    """Read-only virtual-address view of a PE file."""

    def __init__(self, data: bytes):
        self.data = data
        pe = struct.unpack_from("<I", data, 0x3C)[0]
        count = struct.unpack_from("<H", data, pe + 6)[0]
        optional = struct.unpack_from("<H", data, pe + 20)[0]
        base = struct.unpack_from("<I", data, pe + 24 + 28)[0]
        self.sections: dict[str, tuple[int, int, int]] = {}
        for i in range(count):
            s = pe + 24 + optional + i * 40
            name = data[s:s + 8].rstrip(b"\0").decode()
            vsize, vaddr, raw_size, raw_ptr = struct.unpack_from("<IIII", data, s + 8)
            self.sections[name] = (base + vaddr, max(vsize, raw_size), raw_ptr)

    def offset(self, va: int) -> int:
        for start, size, raw in self.sections.values():
            if start <= va < start + size:
                return raw + va - start
        raise ValueError(f"{va:#x} is outside every section")

    def read(self, va: int, n: int) -> bytes:
        o = self.offset(va)
        return self.data[o:o + n]

    def u32(self, va: int) -> int:
        return struct.unpack("<I", self.read(va, 4))[0]

    def in_section(self, name: str, va: int) -> bool:
        start, size, _ = self.sections[name]
        return start <= va < start + size

    def calls_to(self, target: int):
        """VA of every E8 rel32 call in .text that lands on target."""
        start, size, raw = self.sections[".text"]
        text = self.data[raw:raw + size]
        for m in re.finditer(b"\xE8", text):
            i = m.start()
            if i + 5 <= len(text) and start + i + 5 + struct.unpack_from("<i", text, i + 1)[0] == target:
                yield start + i


def allocation_size(img: Image, fn: int, window: int) -> int | None:
    """The sizeof literal a maker method passes to GameEvent::allocate.

    window=0 demands the pattern as the very first instruction, which is what
    the runtime recorder relies on for createEvent.
    """
    code = img.read(fn, window + 10)
    for i in range(window + 1):
        if code[i] == 0xB9 and code[i + 5] == 0xE8:
            if fn + i + 10 + struct.unpack_from("<i", code, i + 6)[0] == ALLOCATE:
                return struct.unpack_from("<I", code, i + 1)[0]
    return None


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--exe", type=Path, default=DEFAULT_EXE)
    ap.add_argument("--json", action="store_true", help="print {id: size} as JSON only")
    args = ap.parse_args()

    data = args.exe.read_bytes()
    digest = hashlib.sha256(data).hexdigest()
    if digest != EXPECTED_SHA256:
        sys.exit(f"{args.exe} has sha256 {digest}; these addresses belong to {EXPECTED_SHA256}")
    img = Image(data)

    table: dict[int, int] = {}
    problems: list[str] = []
    for site in img.calls_to(REGISTER_MAKER):
        pre = img.read(site - 10, 10)
        if pre[0] != 0xBA or pre[5] != 0xB9:
            problems.append(f"registration at {site:#010x} is not mov edx, imm32; mov ecx, imm32")
            continue
        maker = struct.unpack_from("<I", pre, 1)[0]
        event_id = struct.unpack_from("<I", pre, 6)[0]
        vtable = img.u32(maker)
        if not img.in_section(".rdata", vtable):
            problems.append(f"id {event_id:#04x}: maker {maker:#x} has no static vtable")
            continue
        create = allocation_size(img, img.u32(vtable + 4), window=0)
        copy = allocation_size(img, img.u32(vtable), window=16)
        if create is None:
            problems.append(f"id {event_id:#04x}: createEvent does not open with mov ecx, sizeof; call allocate")
            continue
        if copy != create:
            problems.append(f"id {event_id:#04x}: createEventCopy allocates {copy}, createEvent {create}")
        if event_id in table:
            problems.append(f"id {event_id:#04x} is registered twice")
        table[event_id] = create

    mismatches = [i for i, (_, size) in ASSERTED.items() if table.get(i) != size]

    if args.json:
        print(json.dumps({f"{k:#04x}": v for k, v in sorted(table.items())}, indent=1))
    else:
        print(f"{len(table)} event types registered by {args.exe.name}\n")
        print("cross-check against bf42plus static_asserts:")
        for event_id, (name, expected) in sorted(ASSERTED.items()):
            got = table.get(event_id)
            verdict = "ok" if got == expected else "MISMATCH"
            print(f"  {event_id:#04x} {name:14} asserted {expected:3}  exe {got!s:>4}  {verdict}")
        print(f"\n{'id':>4}  {'size':>4}  {'payload':>7}  name")
        for event_id, size in sorted(table.items()):
            name = ASSERTED[event_id][0] if event_id in ASSERTED else NAMED.get(event_id, "")
            print(f"{event_id:#04x}  {size:4}  {size - HEADER:7}  {name}")
        for problem in problems:
            print(f"problem: {problem}")

    sys.exit(1 if mismatches or problems else 0)


if __name__ == "__main__":
    main()

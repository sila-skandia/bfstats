#!/usr/bin/env python3
"""Check target_w32ded.c's detour sites and offsets against BF1942_w32ded.exe.

For every `<NAME>_SITE` with its `<NAME>_ORIG` bytes in src/target_w32ded.c:
  - the exe holds exactly those bytes there,
  - they are whole instructions (the patch ends on a boundary),
  - nothing in them is relative except the rel32 its `<NAME>_REL_AT` names,
  - no branch or call anywhere in .text lands inside them (only on the first
    byte), so the 5-byte jmp never leaves another path half an instruction.
Then each table value the shot and hit hooks read is found in the
instruction it was read from (ANCHORS below).

    tests/w32_sites.py [path/to/BF1942_w32ded.exe]

The exe defaults to $W32DED_EXE, then ~/bf1942-lab/w32/BF1942_w32ded.exe.
Without it, or without objdump, the check is skipped (exit 0, says so).
"""

from __future__ import annotations

import hashlib
import os
import re
import shutil
import subprocess
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
SRC = HERE.parent / "src" / "target_w32ded.c"
EXE_MD5 = "1f75eb8b55ab5bb4d6782dd6f3be2e45"

# (address, a regex the instruction there must match, what it backs).
ANCHORS = [
    (0x005036E4, r"mov\s+BYTE PTR \[ecx\+0x2c5\],al", "fa_fake_off 0x2c5 (setFakeFire)"),
    (0x0050792F, r"mov\s+al,BYTE PTR \[ebp\+0x2c5\]", "fa_fake_off 0x2c5 (Fire's test)"),
    (0x00507943, r"jne\s+0x507aca", "the fake branch lands on FAKE_SITE"),
    (0x005075D4, r"mov\s+ebx,DWORD PTR \[esp\+0x74\]", "Fire: the IPlayer in ebx"),
    (0x005075DB, r"mov\s+ebp,ecx", "Fire: this in ebp"),
    (0x005079C1, r"lea\s+edx,\[esp\+0x40\]", "Fire: the Mat4 at [esp+0x3c] (one push down)"),
    (0x005079C9, r"call\s+0x506bf0", "Fire calls fireBarrel"),
    (0x005072A0, r"mov\s+DWORD PTR \[esi\+0x120\],eax", "proj_owner_off 0x120"),
    (0x005072BE, r"lea\s+edi,\[esi\+0x14c\]", "proj_origin_off 0x14c"),
    (0x00507311, r"mov\s+DWORD PTR \[esi\+0x158\],eax", "proj_stat_off 0x158"),
    (0x00473C16, r"call\s+DWORD PTR \[edx\+0x34\]", "proj_pos_slot 0x34"),
    (0x00473DC0, r"mov\s+ecx,DWORD PTR \[esi\+0x158\]", "handleCollisionForProjectile reads the stat id"),
    (0x00473DD0, r"mov\s+eax,DWORD PTR \[esi\+0x120\]", "handleCollisionForProjectile reads the owner"),
    (0x00506BFA, r"mov\s+eax,DWORD PTR \[ebp\+0x1b4\]", "fa_proj_tmpl_off 0x1b4"),
    (0x00505A29, r"mov\s+ecx,ebp", "initProjectilePool: push_back into ebp (+0x200)"),
    (0x00505A0F, r"add\s+ebp,0x200", "fa_pool_off: the vector at +0x200"),
    (0x004581B1, r"mov\s+esi,DWORD PTR \[ecx\+0x4\]", "fa_pool_off: a vector's begin at +4"),
    (0x00505A3A, r"mov\s+DWORD PTR \[ebp\+0x210\],esi", "fa_pool_count_off 0x210"),
    (0x00506682, r"mov\s+DWORD PTR \[esi\],0x704b48", "vt_fire_arms 0x704b48"),
    (0x005094AD, r"mov\s+DWORD PTR \[esi\],0x704e98", "vt_hand_fire_arms 0x704e98"),
    (0x00509499, r"call\s+0x506670", "HandFireArms runs FireArms' ctor first"),
    (0x004F7D03, r"mov\s+DWORD PTR \[esi\],0x702b28", "vt_projectile 0x702b28"),
    (0x00475480, r"mov\s+BYTE PTR \[esp\+0x28\],al", "the hit strength at [esp+0x28]"),
    (0x004759E4, r"mov\s+BYTE PTR \[esp\+0x14\],0x4", "the hit sector at [esp+0x14]"),
    (0x00475A0D, r"mov\s+ecx,DWORD PTR \[esp\+0x28\]", "HitFromPosEvent reads the strength"),
    (0x00475A11, r"mov\s+edx,DWORD PTR \[esp\+0x14\]", "HitFromPosEvent reads the sector"),
    (0x0047609D, r"call\s+0x4058b0", "giveDamage calls addBulletsGivingDamage"),
    (0x00670770, r"mov\s+eax,DWORD PTR \[ecx\+0x40\]", "tmpl_id_off 0x40 (ObjectTemplate::getId, vtable 0x6ea238 +0x1c)"),
    (0x00696D90, r"lea\s+eax,\[ecx\+0x8\]", "the same vtable's getName: the name at +8"),
    (0x006E7090, None, "GameServer vtable +0x30 holds IMPACT_SITE"),
]

RELATIVE = re.compile(r"^(call|jmp|j[a-z]{1,3}|loop[a-z]*|jecxz)\s+0x[0-9a-f]+$")
BRANCH = re.compile(r"\b(call|jmp|j[a-z]{1,3}|loop[a-z]*|jecxz)\s+0x([0-9a-f]+)$")
LINE = re.compile(r"^\s*([0-9a-f]+):\t((?:[0-9a-f]{2} )+)\s*\t?(.*)$")


def skip(why: str) -> None:
    print(f"recorder w32ded sites: skipped ({why})")
    sys.exit(0)


def parse_source() -> dict[str, dict]:
    text = SRC.read_text()
    sites = {m.group(1): int(m.group(2), 16)
             for m in re.finditer(r"#define\s+(\w+)_SITE\s+0x([0-9a-fA-F]+)u", text)}
    origs = {m.group(1): bytes(int(b, 16) for b in re.findall(r"0x([0-9a-fA-F]{2})", m.group(2)))
             for m in re.finditer(r"static const uint8_t\s+(\w+)_ORIG\[\]\s*=\s*\{([^}]*)\}", text)}
    rels = {m.group(1): int(m.group(2))
            for m in re.finditer(r"#define\s+(\w+)_REL_AT\s+(\d+)", text)}
    out = {}
    for name, addr in sites.items():
        if name not in origs:
            sys.exit(f"{name}_SITE has no {name}_ORIG in {SRC.name}")
        out[name] = {"addr": addr, "orig": origs[name], "rel_at": rels.get(name, -1)}
    return out


def pe_sections(data: bytes) -> tuple[int, list[tuple[int, int, int]]]:
    pe = int.from_bytes(data[0x3C:0x40], "little")
    n = int.from_bytes(data[pe + 6:pe + 8], "little")
    opt = int.from_bytes(data[pe + 20:pe + 22], "little")
    base = int.from_bytes(data[pe + 52:pe + 56], "little")
    secs = []
    for i in range(n):
        o = pe + 24 + opt + i * 40
        va, rs, ro = (int.from_bytes(data[o + k:o + k + 4], "little") for k in (12, 16, 20))
        secs.append((base + va, rs, ro))
    return base, secs


def read_va(data: bytes, secs, va: int, n: int) -> bytes:
    for start, size, raw in secs:
        if start <= va < start + size:
            return data[raw + va - start:raw + va - start + n]
    raise SystemExit(f"{va:#x} is not in the exe")


def main() -> int:
    exe = Path(sys.argv[1] if len(sys.argv) > 1 else
               os.environ.get("W32DED_EXE", Path.home() / "bf1942-lab/w32/BF1942_w32ded.exe"))
    if not exe.is_file():
        skip(f"no {exe}")
    if not shutil.which("objdump"):
        skip("no objdump")
    data = exe.read_bytes()
    if hashlib.md5(data).hexdigest() != EXE_MD5:
        sys.exit(f"{exe} is not BF1942_w32ded.exe 1.61 (md5 {EXE_MD5})")
    _, secs = pe_sections(data)
    sites = parse_source()

    dis = subprocess.run(["objdump", "-d", "-M", "intel", "-j", ".text", str(exe)],
                         capture_output=True, text=True, check=True).stdout
    insn: dict[int, tuple[int, str]] = {}
    targets: dict[int, list[int]] = {}
    for line in dis.splitlines():
        m = LINE.match(line)
        if not m:
            continue
        at = int(m.group(1), 16)
        size = len(m.group(2).split())
        text = " ".join(m.group(3).split())
        insn[at] = (size, text)
        b = BRANCH.search(text)
        if b:
            targets.setdefault(int(b.group(2), 16), []).append(at)

    bad = 0
    for name, s in sorted(sites.items(), key=lambda kv: kv[1]["addr"]):
        addr, orig, rel_at = s["addr"], s["orig"], s["rel_at"]
        problems = []
        have = read_va(data, secs, addr, len(orig))
        if have != orig:
            problems.append(f"bytes {have.hex()} != {orig.hex()}")
        at, rel_ok = addr, rel_at < 0
        while at < addr + len(orig):
            if at not in insn:
                problems.append(f"{at:#x} is not an instruction boundary")
                break
            size, text = insn[at]
            if RELATIVE.match(text):
                # Only the call whose rel32 the trampoline re-aims.
                target = int(text.split()[-1], 16)
                if rel_at >= 0 and at + size == addr + rel_at + 4 and text.startswith("call"):
                    rel_ok = True
                elif target == addr + len(orig):
                    # Lands on the patch's end, which in the trampoline is
                    # the jmp back to that same address: still right.
                    pass
                else:
                    problems.append(f"{at:#x} `{text}` is relative")
            at += size
        if at != addr + len(orig):
            problems.append(f"the patch ends mid-instruction ({at:#x})")
        if not rel_ok:
            problems.append(f"{name}_REL_AT {rel_at} names no call's rel32")
        if len(orig) < 5:
            problems.append("shorter than a jmp")
        inside = [(t, f) for t, fs in targets.items() if addr < t < addr + len(orig) for f in fs]
        for t, f in inside:
            problems.append(f"{f:#x} branches to {t:#x}, inside the patch")
        bad += bool(problems)
        print(f"  {name:8s} {addr:#010x} {len(orig):2d} bytes  " + ("ok" if not problems else "; ".join(problems)))

    for addr, pattern, what in ANCHORS:
        if pattern is None:   # a vtable slot
            ok = int.from_bytes(read_va(data, secs, addr, 4), "little") == sites["IMPACT"]["addr"]
            got = f"{int.from_bytes(read_va(data, secs, addr, 4), 'little'):#x}"
        else:
            got = insn.get(addr, (0, "(no instruction here)"))[1]
            ok = re.search(pattern, got) is not None
        if not ok:
            bad += 1
            print(f"  anchor {addr:#010x} {what}: found `{got}`")
    if bad:
        print(f"recorder w32ded sites: {bad} problem(s)")
        return 1
    print(f"recorder w32ded sites: {len(sites)} detour sites and {len(ANCHORS)} offsets match {exe.name}")
    return 0


if __name__ == "__main__":
    sys.exit(main())

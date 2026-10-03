#!/usr/bin/env python3
"""List the draws in an i915 GPU hang's batch, and mark where the GPU stopped.

    sudo cat /sys/class/drm/card1/error > ~/gpu-hang.txt
    python3 scripts/i915-hang-draws.py ~/gpu-hang.txt

The kernel keeps the first hang since boot in that file. This decodes the
captured batch (ascii85 + zlib), walks its Gen12 3D commands, and prints the
draws as runs that share a shader and state: index count, instances,
topology, pixel and vertex shader addresses, blend word, depth/stencil word,
MSAA, and the vertex buffers as (pitch, bytes). The hung draw is the
3DPRIMITIVE just before BBADDR, whose header is IPEHR (0x7b000005).
features/intel-gpu-msaa-hang reads one of these.
"""

from __future__ import annotations

import re
import struct
import sys
import zlib

GFX = {
    0x7808: "VERTEX_BUFFERS", 0x780A: "INDEX_BUFFER", 0x780D: "MULTISAMPLE", 0x7810: "VS",
    0x7820: "PS", 0x784B: "VF_TOPOLOGY", 0x784D: "PS_BLEND", 0x784E: "WM_DEPTH_STENCIL",
    0x7B00: "3DPRIMITIVE",
}


def ascii85(text: str) -> bytes:
    words, i = [], 0
    while i < len(text):
        if text[i] == "z":
            words.append(0)
            i += 1
            continue
        value = 0
        for ch in text[i:i + 5]:
            value = value * 85 + ord(ch) - 33
        words.append(value & 0xFFFFFFFF)
        i += 5
    return struct.pack(f"<{len(words)}I", *words)


def read_batch(path: str) -> tuple[bytes, int, int]:
    lines = open(path, encoding="latin-1").read().split("\n")
    text = "\n".join(lines)
    bbaddr = int(re.search(r"BBADDR: 0x([0-9a-f]+)_([0-9a-f]+)", text).expand(r"\1\2"), 16) & ~3
    for n, line in enumerate(lines):
        m = re.match(r"^\w+ --- batch = 0x([0-9a-f]{8}) ([0-9a-f]{8})", line)
        if m:
            data = lines[n + 1]
            raw = ascii85(data[1:])
            if data.startswith(":"):
                raw = zlib.decompress(raw)
            return raw, (int(m.group(1), 16) << 32) | int(m.group(2), 16), bbaddr
    sys.exit("no batch buffer captured in this error state")


def commands(buf: bytes):
    dw = struct.unpack(f"<{len(buf) // 4}I", buf)
    i = 0
    while i < len(dw):
        h = dw[i]
        kind = h >> 29
        if kind == 0:  # MI_*
            op = (h >> 23) & 0x3F
            n = 1 if op < 0x10 else (h & 0xFF) + 2
            name = "MI_BB_END" if op == 0x0A else f"MI_{op:#x}"
        elif kind == 3:  # 3D pipe
            sub, opc = (h >> 27) & 3, (h >> 24) & 7
            n = 1 if sub == 1 and opc in (0, 1) else (h & 0xFF) + 2
            name = GFX.get(h >> 16, f"GFX_{h >> 16:#06x}")
        else:
            n, name = (h & 0xFF) + 2, f"OTHER_{h:#010x}"
        yield i * 4, name, dw[i:i + n]
        if name == "MI_BB_END":
            return
        i += n


def main() -> None:
    if len(sys.argv) != 2:
        sys.exit(__doc__)
    buf, base, bbaddr = read_batch(sys.argv[1])
    stop = bbaddr - base
    state: dict[str, tuple] = {}
    draws = []
    for off, name, dw in commands(buf):
        if name == "3DPRIMITIVE":
            draws.append((off, dw, dict(state)))
        else:
            state[name] = dw
    hung = max((k for k, (off, _, _) in enumerate(draws) if off < stop), default=None)

    def word(st, key, i):
        dw = st.get(key)
        return f"{dw[i]:#x}" if dw is not None and len(dw) > i else "-"

    runs = []
    for k, (off, dw, st) in enumerate(draws):
        vb = st.get("VERTEX_BUFFERS", ())
        vbs = tuple((vb[j] & 0xFFF, vb[j + 3]) for j in range(1, len(vb) - 3, 4))
        key = (dw[2], dw[4], word(st, "VF_TOPOLOGY", 1), word(st, "PS", 1), word(st, "VS", 1),
               word(st, "PS_BLEND", 1), word(st, "WM_DEPTH_STENCIL", 1), word(st, "MULTISAMPLE", 1), vbs)
        if runs and runs[-1][0] == key and not (k == hung or runs[-1][3]):
            runs[-1][2] += 1
        else:
            runs.append([key, k, 1, k == hung])
    print(f"{len(draws)} draws; GPU stopped at draw {hung + 1 if hung is not None else '?'}")
    for key, first, count, is_hung in runs:
        cnt, inst, topo, ps, vs, blend, ds, ms, vbs = key
        mark = "  <== hung" if is_hung else ""
        print(f"{first + 1:4d}-{first + count:<4d} x{count:<3d} idx={cnt:<6d} inst={inst:<4d} topo={topo} "
              f"ps={ps} vs={vs} blend={blend} ds={ds} msaa={ms} vbs={vbs}{mark}")


if __name__ == "__main__":
    main()

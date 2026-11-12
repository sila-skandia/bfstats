#!/usr/bin/env python3
"""Read typed values at a virtual address in our own BF1942 binaries, without Ghidra.

    ./readmem.py client 0x008eb25c f        # one float32 at that VMA in BF1942.exe
    ./readmem.py server 0x086d271c f 4      # four float32 in bf1942_lnxded.static
    ./readmem.py dyn    0x08685688 f        # in bf1942_lnxded.dynamic (the 1.61 build the
                                            # bf1942reverseengineering linux dump was made from:
                                            # its DAT_ addresses are this file's)
    ./readmem.py server 0x086d2320 s        # a C string
    ./readmem.py client 0x008c3100 x 16     # raw bytes, hex
    ./readmem.py - 0x3f350481 hexf          # decode an immediate as float32 (reads no file)

Types: f float32, d float64, i int32, I uint32, h int16, b int8, s C string,
x <n> raw bytes, hexf the address argument itself as IEEE float32 bits.

LLVM `objdump -s --start-address` misreads data addresses in both files (it
printed 0x951320 for a request at 0x008c3100), so constants a disassembly loads
(`flds 0x86d1388`) are read here instead. Disassemble with
`objdump -d --no-show-raw-insn --start-address=A --stop-address=B <file>`, and
name a server address with `objdump -t <lnxded.static> | grep <address>`.
This is how the 2026-11-12 retail cross-check settled every disagreement
between our code, the ledger and the third-party decompile
(`features/retail-parity-cross-check-2026-11-12`).

The binaries are found at $BF1942_EXE, $BF1942_LNXDED and $BF1942_LNXDED_DYN,
else under the home directory where the lab keeps them.
"""
from __future__ import annotations

import os
import struct
import sys
from pathlib import Path

HOME = Path.home()
PATHS = {
    'client': os.environ.get('BF1942_EXE') or HOME / '.cache/vimpact-game/BF1942.exe',
    'server': os.environ.get('BF1942_LNXDED') or HOME / 'bf1942-lab/linux-src/bf1942_lnxded.static',
    'dyn': os.environ.get('BF1942_LNXDED_DYN') or HOME / 'bf1942-lab/linux-src/bf1942_lnxded.dynamic',
}
FORMATS = {'f': 'f', 'd': 'd', 'i': 'i', 'I': 'I', 'h': 'h', 'b': 'b'}


def segments(data: bytes) -> list[tuple[int, int, int, int]]:
    """(vma, bytes in file, file offset, bytes in memory) per loaded segment."""
    if data[:4] == b'\x7fELF':
        phoff = struct.unpack_from('<I', data, 28)[0]
        phentsize, phnum = struct.unpack_from('<HH', data, 42)
        out = []
        for i in range(phnum):
            p_type, p_offset, p_vaddr, _, p_filesz, p_memsz = struct.unpack_from(
                '<IIIIII', data, phoff + i * phentsize)
            if p_type == 1:  # PT_LOAD
                out.append((p_vaddr, p_filesz, p_offset, p_memsz))
        return out
    pe = struct.unpack_from('<I', data, 0x3c)[0]
    count = struct.unpack_from('<H', data, pe + 6)[0]
    optional = struct.unpack_from('<H', data, pe + 20)[0]
    base = struct.unpack_from('<I', data, pe + 24 + 28)[0]
    out = []
    for i in range(count):
        o = pe + 24 + optional + 40 * i
        virtual_size, va, raw_size, raw_offset = struct.unpack_from('<IIII', data, o + 8)
        out.append((va + base, raw_size, raw_offset, virtual_size))
    return out


def read(data: bytes, segs, vma: int, size: int) -> bytes:
    for va, filesz, offset, memsz in segs:
        if va <= vma < va + memsz:
            rel = vma - va
            if rel + size > filesz:
                return b'\0' * size  # .bss: zero-filled at load
            return data[offset + rel: offset + rel + size]
    raise SystemExit(f'0x{vma:08x} is not mapped in this binary')


def main(argv: list[str]) -> None:
    if len(argv) < 3:
        print(__doc__)
        raise SystemExit(2)
    which, address, kind = argv[0], int(argv[1], 16), argv[2]
    count = int(argv[3]) if len(argv) > 3 else 1
    if kind == 'hexf':
        print(struct.unpack('<f', struct.pack('<I', address))[0])
        return
    path = Path(PATHS[which]).expanduser()
    data = path.read_bytes()
    segs = segments(data)
    if kind == 's':
        print(read(data, segs, address, 256).split(b'\0')[0].decode('latin-1'))
        return
    if kind == 'x':
        print(read(data, segs, address, count).hex(' '))
        return
    fmt = FORMATS[kind]
    size = struct.calcsize(fmt)
    for k in range(count):
        value = struct.unpack('<' + fmt, read(data, segs, address + k * size, size))[0]
        print(f'0x{address + k * size:08x}  {value!r}')


if __name__ == '__main__':
    main(sys.argv[1:])

#!/usr/bin/env python3
"""Dump a gcc vtable out of bf1942_lnxded.static, or read constants from it.

    ./vt.py ResponsePhysics            # by class-name substring ("vtable for ...")
    ./vt.py 0x0872e240 40              # by the vtable SYMBOL address, 40 slots
    ./vt.py --float 0x86d16cc          # read a float constant
    ./vt.py --u32   0x86c2a98          # read a u32 (an IID_/CID_ value)
    ./vt.py --sym   0x8259e52          # which function contains this address

Offsets are printed relative to the VPTR, which is the symbol + 8 (offset-to-top
and the typeinfo pointer come first). A `call *0x58(%eax)` is therefore the row
printed as +0x058. Counting from the symbol lands two slots early - that mistake
has been made in this corpus more than once.
"""
import bisect
import re
import struct
import subprocess
import sys

BIN = '/home/dylan/projects/public/bf42plus/bf1942_lnxded.static'

_secs = []
for line in subprocess.run(['readelf', '-S', '-W', BIN], capture_output=True, text=True).stdout.splitlines():
    m = re.match(r'\s*\[\s*\d+\]\s+(\S+)\s+\S+\s+([0-9a-f]{8})\s+([0-9a-f]+)\s+([0-9a-f]+)', line)
    if m:
        _secs.append((int(m.group(2), 16), int(m.group(3), 16), int(m.group(4), 16)))
_data = open(BIN, 'rb').read()

syms = {}
for line in subprocess.run(['nm', '-C', BIN], capture_output=True, text=True).stdout.splitlines():
    p = line.split(' ', 2)
    if len(p) == 3 and p[0]:
        try:
            syms.setdefault(int(p[0], 16), p[2])
        except ValueError:
            pass
_addrs = sorted(syms)


def _off(va):
    for addr, off, size in _secs:
        if addr and addr <= va < addr + size:
            return off + (va - addr)
    raise ValueError(f'{va:#x} is not in a file-backed section')


def rd32(va):
    return struct.unpack_from('<I', _data, _off(va))[0]


def rdf(va):
    return struct.unpack_from('<f', _data, _off(va))[0]


def containing(va):
    i = bisect.bisect_right(_addrs, va) - 1
    return _addrs[i], syms[_addrs[i]]


def main(argv):
    if not argv:
        print(__doc__)
        return 1
    if argv[0] == '--float':
        for a in argv[1:]:
            print(a, rdf(int(a, 16)))
        return 0
    if argv[0] == '--u32':
        for a in argv[1:]:
            print(a, hex(rd32(int(a, 16))))
        return 0
    if argv[0] == '--sym':
        for a in argv[1:]:
            base, name = containing(int(a, 16))
            print(a, f'{base:#010x}', name)
        return 0
    n = int(argv[1]) if len(argv) > 1 else 64
    if argv[0].startswith('0x'):
        base = int(argv[0], 16)
    else:
        hits = [(a, s) for a, s in syms.items() if s.startswith('vtable for') and argv[0] in s]
        for a, s in sorted(hits):
            print(f'{a:#010x} {s}')
        if not hits:
            return 1
        base = sorted(hits, key=lambda h: len(h[1]))[0][0]
    print(f'vtable symbol {base:#010x}, vptr {base + 8:#010x}')
    for i in range(n):
        v = rd32(base + 8 + 4 * i)
        print(f'+0x{4 * i:03x}  {v:08x}  {syms.get(v, "")}')
    return 0


if __name__ == '__main__':
    sys.exit(main(sys.argv[1:]))

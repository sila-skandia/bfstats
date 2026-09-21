#!/usr/bin/env python3
"""Emulate SkeletonCollisionMeshTemplate::SkeletonCollisionMeshTemplate()'s
vertex-array fill (0x083af34a..0x083af660) to recover the 17 default vertices."""
import re, struct, sys, math

BIN = '/home/dylan/projects/public/bf42plus/bf1942_lnxded.static'
data = open(BIN, 'rb').read()


def rdf(va):
    return struct.unpack_from('<f', data, va - 0x8048000)[0]


lines = [l.rstrip() for l in open(sys.argv[1]) if re.match(r'^\s*[0-9a-f]+:', l)]
ins = []
for l in lines:
    a, rest = l.split(':', 1)
    ins.append((int(a.strip(), 16), rest.strip()))

VERT_BASE = 0x10000000
reg = {'eax': 0, 'ebx': 0, 'ecx': 0, 'edx': 0, 'esi': 0,
       'edi': 0x20000000, 'ebp': 0x30000000, 'esp': 0}
mem = {}
st = []
last = (0, 0)


def val(tok):
    tok = tok.strip()
    if tok in reg:
        return reg[tok]
    if tok.startswith('DWORD PTR'):
        return mem.get(addr(tok[len('DWORD PTR'):]), 0)
    return int(tok, 16) if tok.startswith('0x') else int(tok)


def addr(expr):
    expr = expr.strip()
    if expr.startswith('ds:'):
        return int(expr[3:], 16)
    m = re.match(r'^\[(\w+)([+-])(0x[0-9a-f]+)\]$', expr)
    if m:
        b = reg[m.group(1)]
        o = int(m.group(3), 16)
        return b + o if m.group(2) == '+' else b - o
    m = re.match(r'^\[(\w+)\]$', expr)
    if m:
        return reg[m.group(1)]
    raise ValueError(expr)


def loadf(a):
    if 0x86afc60 <= a < 0x8708dec:
        return rdf(a)
    v = mem.get(a, 0)
    return struct.unpack('<f', struct.pack('<I', v & 0xffffffff))[0]


def storef(a, f):
    mem[a] = struct.unpack('<I', struct.pack('<f', f))[0]


byaddr = {a: k for k, (a, _) in enumerate(ins)}
i = 0
guard = 0
while i < len(ins) and guard < 200000:
    guard += 1
    a, txt = ins[i]
    parts = txt.split(None, 1)
    op = parts[0]
    arg = parts[1] if len(parts) > 1 else ''
    i += 1
    if op == 'mov':
        d, s = [x.strip() for x in arg.split(',', 1)]
        if d.startswith('DWORD PTR'):
            da = addr(d[len('DWORD PTR'):])
            if s.startswith('DWORD PTR'):
                mem[da] = mem.get(addr(s[len('DWORD PTR'):]), 0)
            else:
                mem[da] = val(s) & 0xffffffff
        elif d.startswith('BYTE PTR'):
            pass
        elif s.startswith('DWORD PTR'):
            reg[d] = mem.get(addr(s[len('DWORD PTR'):]), 0)
        elif s.startswith('BYTE PTR'):
            pass
        else:
            reg[d] = val(s)
    elif op == 'lea':
        d, s = [x.strip() for x in arg.split(',', 1)]
        reg[d] = addr(s)
    elif op == 'fld':
        st.insert(0, loadf(addr(arg.replace('DWORD PTR', ''))))
    elif op == 'fst':
        storef(addr(arg.replace('DWORD PTR', '')), st[0])
    elif op == 'fstp':
        storef(addr(arg.replace('DWORD PTR', '')), st[0])
        st.pop(0)
    elif op == 'fxch':
        n = int(re.match(r'st\((\d+)\)', arg).group(1))
        st[0], st[n] = st[n], st[0]
    elif op == 'add':
        d, s = [x.strip() for x in arg.split(',', 1)]
        if d in reg:
            reg[d] = (reg[d] + val(s)) & 0xffffffff
    elif op == 'sub':
        d, s = [x.strip() for x in arg.split(',', 1)]
        if d in reg:
            reg[d] = (reg[d] - val(s)) & 0xffffffff
    elif op in ('dec', 'inc'):
        if arg in reg:
            reg[arg] = (reg[arg] + (1 if op == 'inc' else -1)) & 0xffffffff
    elif op == 'xor':
        d, s = [x.strip() for x in arg.split(',', 1)]
        reg[d] = 0 if d == s else reg[d] ^ val(s)
    elif op == 'shl':
        d, s = [x.strip() for x in arg.split(',', 1)]
        reg[d] = (reg[d] << val(s)) & 0xffffffff
    elif op == 'cmp':
        d, s = [x.strip() for x in arg.split(',', 1)]
        last = (reg[d] if d in reg else val(d), val(s))
    elif op == 'jne':
        t = int(arg.split()[0], 16)
        if last[0] != last[1] and t in byaddr:
            i = byaddr[t]
    elif op in ('jb', 'jae'):
        t = int(arg.split()[0], 16)
        cond = last[0] < last[1] if op == 'jb' else last[0] >= last[1]
        if cond and t in byaddr:
            i = byaddr[t]
    elif op == 'ret':
        break

base = mem.get(0x20000000 + 0x38, VERT_BASE)
best = 0.0
for k in range(17):
    v = [loadf(base + k * 16 + j * 4) for j in range(3)]
    r = math.sqrt(sum(x * x for x in v))
    best = max(best, r)
    print(f"v{k:2d} = ({v[0]:7.3f},{v[1]:7.3f},{v[2]:7.3f})  |v| = {r:.4f}")
print("max |v| =", round(best, 6))

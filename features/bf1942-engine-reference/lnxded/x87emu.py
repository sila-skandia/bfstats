"""A tiny i386 + x87 emulator for one leaf-ish engine function, numeric with a
symbolic shadow: every float carries the expression that produced it, so a
run on concrete inputs prints the formula along the path those inputs take.

Used to read PlaneControl::towardsDirection (0x08629fa0) exactly: see
towards_direction_emu.py. Ghidra mangles x87-heavy functions (this one lost
its head); running the disassembly is the reliable reading.
"""
import math
import re
import struct
import sys

BIN = '/home/dylan/projects/public/bf42plus/bf1942_lnxded.static'
DATA = open(BIN, 'rb').read()
_ph = struct.unpack_from('<I', DATA, 0x1c)[0]
_pn = struct.unpack_from('<H', DATA, 0x2c)[0]
_pe = struct.unpack_from('<H', DATA, 0x2a)[0]
SEGS = []
for _i in range(_pn):
    _p = struct.unpack_from('<8I', DATA, _ph + _i * _pe)
    if _p[0] == 1:
        SEGS.append((_p[2], _p[1], _p[4], _p[5]))


def f2i(f):
    return struct.unpack('<I', struct.pack('<f', f))[0]


def i2f(i):
    return struct.unpack('<f', struct.pack('<I', i & 0xffffffff))[0]


def paren(e):
    if re.fullmatch(r'[\w\.\-]+', e):
        return e
    if e.startswith('(') and e.endswith(')'):
        d = 0
        ok = True
        for k, c in enumerate(e):
            d += c == '('
            d -= c == ')'
            if d == 0 and k < len(e) - 1:
                ok = False
                break
        if ok:
            return e
    return '(' + e + ')'


class Emu:
    def __init__(self, dis_path, symbolic=True):
        self.ins = {}
        order = []
        for ln in open(dis_path):
            m = re.match(r'\s*([0-9a-f]+):\t([0-9a-f ]+)\t(\S+)\s*(.*)$', ln.rstrip())
            if not m:
                continue
            a = int(m.group(1), 16)
            raw = [int(b, 16) for b in m.group(2).split()]
            ops = m.group(4).split(' <')[0].strip()
            self.ins[a] = (raw, m.group(3), ops)
            order.append(a)
        order.sort()
        self.nxt = {order[i]: order[i + 1] for i in range(len(order) - 1)}
        self.mem = {}      # byte address -> byte
        self.sym = {}      # 4-byte slot address -> symbolic expr of the float there
        self.reg = {r: 0 for r in ('eax', 'ebx', 'ecx', 'edx', 'esi', 'edi', 'esp', 'ebp')}
        self.rsym = {}
        self.st = []       # [(value, sym)] top first
        self.flags = {}
        self.fsw = 0
        self.natives = {}
        self.symbolic = symbolic
        self.trace = []
        self.branches = []

    # --- memory ---
    def rb(self, a):
        if a in self.mem:
            return self.mem[a]
        for v, o, fs, ms in SEGS:
            if v <= a < v + fs:
                return DATA[o + a - v]
            if v <= a < v + ms:
                return 0
        return 0

    def r32(self, a):
        return self.rb(a) | self.rb(a + 1) << 8 | self.rb(a + 2) << 16 | self.rb(a + 3) << 24

    def w32(self, a, v, s=None):
        v &= 0xffffffff
        for k in range(4):
            self.mem[a + k] = (v >> (8 * k)) & 0xff
        if s is None:
            self.sym.pop(a, None)
        else:
            self.sym[a] = s

    def rf(self, a):
        v = i2f(self.r32(a))
        s = self.sym.get(a)
        if s is None:
            s = self.names.get(a, repr(round(v, 6)))
        return (v, s)

    def wf(self, a, v, s):
        self.w32(a, f2i(v), s)

    # --- operands ---
    def ea(self, op):
        op = op.replace('DWORD PTR ', '').replace('BYTE PTR ', '').replace('QWORD PTR ', '')
        m = re.match(r'ds:0x([0-9a-f]+)$', op)
        if m:
            return int(m.group(1), 16)
        m = re.match(r'\[(.*)\]$', op)
        if not m:
            raise ValueError(op)
        expr = m.group(1)
        total = 0
        for term in re.findall(r'[+-]?[^+-]+', expr):
            sign = -1 if term.startswith('-') else 1
            t = term.lstrip('+-')
            if '*' in t:
                r, k = t.split('*')
                total += sign * (self.reg.get(r, 0) if r != 'eiz' else 0) * int(k, 0)
            elif t in self.reg:
                total += sign * self.reg[t]
            elif t == 'eiz':
                pass
            else:
                total += sign * int(t, 16)
        return total & 0xffffffff

    def val(self, op):
        if op in self.reg:
            return self.reg[op]
        if op in ('al', 'dl', 'cl', 'bl'):
            return self.reg['e' + op[0] + 'x'] & 0xff
        if op in ('ah',):
            return (self.reg['eax'] >> 8) & 0xff
        if re.match(r'^-?0x[0-9a-f]+$|^\d+$', op):
            return int(op, 0) & 0xffffffff
        if op.startswith('BYTE PTR'):
            return self.rb(self.ea(op))
        return self.r32(self.ea(op))

    def sti(self, s):
        m = re.match(r'st\((\d)\)', s)
        if m:
            return int(m.group(1))
        return 0 if s == 'st' else None

    # --- run ---
    def push(self, v, s=None):
        self.reg['esp'] = (self.reg['esp'] - 4) & 0xffffffff
        self.w32(self.reg['esp'], v, s)

    def pop(self):
        v = self.r32(self.reg['esp'])
        self.reg['esp'] = (self.reg['esp'] + 4) & 0xffffffff
        return v

    def fop(self, x, y, kind):
        (a, sa), (b, sb) = x, y
        if kind == '+':
            return (a + b, '%s + %s' % (paren(sa), paren(sb)))
        if kind == '*':
            return (a * b, '%s * %s' % (paren(sa), paren(sb)))
        if kind == '-':
            return (a - b, '%s - %s' % (paren(sa), paren(sb)))
        if kind == '/':
            return (a / b if b != 0 else math.copysign(math.inf, a or 1), '%s / %s' % (paren(sa), paren(sb)))

    def fcmp(self, x, y):
        a, b = x[0], y[0]
        c = 0
        if a != a or b != b:
            c = 0x4500
        elif a < b:
            c = 0x0100
        elif a == b:
            c = 0x4000
        self.fsw = c
        self.cmp_desc = (x[1], y[1], a, b)

    def run(self, start, stop_at_ret=True, max_steps=20000):
        a = start
        steps = 0
        while steps < max_steps:
            steps += 1
            raw, mn, ops = self.ins[a]
            parts = [p.strip() for p in re.split(r',(?![^\[]*\])', ops)] if ops else []
            nxt = self.nxt.get(a)
            b0 = raw[0]
            b1 = raw[1] if len(raw) > 1 else 0
            if mn == 'ret':
                ret = self.pop()
                if ops:
                    self.reg['esp'] += int(ops, 0)
                if ret == 0xdeadbeef:
                    return ret
                nxt = ret
            elif mn == 'push':
                v = self.val(parts[0])
                s = self.rsym.get(parts[0]) if parts[0] in self.reg else (self.sym.get(self.ea(parts[0])) if '[' in parts[0] else None)
                self.push(v, s)
            elif mn == 'pop':
                s = self.sym.get(self.reg['esp'])
                self.reg[parts[0]] = self.pop()
                self.rsym[parts[0]] = s
            elif mn == 'mov':
                d, s_ = parts
                if d in self.reg:
                    self.reg[d] = self.val(s_)
                    if s_ in self.reg:
                        self.rsym[d] = self.rsym.get(s_)
                    elif '[' in s_ or 'ds:' in s_:
                        ad_ = self.ea(s_)
                        self.rsym[d] = self.sym.get(ad_) or getattr(self, 'names', {}).get(ad_)
                    else:
                        self.rsym[d] = None
                elif d in ('al', 'dl', 'cl', 'bl'):
                    r = 'e' + d[0] + 'x'
                    self.reg[r] = (self.reg[r] & ~0xff) | (self.val(s_) & 0xff)
                elif d.startswith('BYTE PTR'):
                    self.mem[self.ea(d)] = self.val(s_) & 0xff
                else:
                    ad = self.ea(d)
                    ssym = self.rsym.get(s_) if s_ in self.reg else None
                    self.w32(ad, self.val(s_), ssym)
            elif mn == 'lea':
                self.reg[parts[0]] = self.ea(parts[1])
            elif mn in ('add', 'sub', 'and', 'xor', 'or'):
                d, s_ = parts
                x = self.val(d)
                y = self.val(s_)
                r = {'add': x + y, 'sub': x - y, 'and': x & y, 'xor': x ^ y, 'or': x | y}[mn] & (0xff if 'BYTE' in d else 0xffffffff)
                if d in self.reg:
                    self.reg[d] = r
                elif d.startswith('BYTE PTR'):
                    ad = self.ea(d)
                    self.mem[ad] = r
                    # a sign-bit flip of a float slot: carry the negation symbolically
                    if mn == 'xor' and y == 0x80 and (ad - 3) in self.sym:
                        self.sym[ad - 3] = '-' + paren(self.sym[ad - 3])
                else:
                    self.w32(self.ea(d), r)
                self.zf = r == 0
            elif mn == 'shrd':
                d, s_, c = parts
                cnt = self.val('ecx') & 0x1f if c == 'cl' else int(c, 0) & 0x1f
                x = self.reg[d]; y = self.reg[s_]
                self.reg[d] = ((x >> cnt) | (y << (32 - cnt))) & 0xffffffff if cnt else x
            elif mn in ('shr', 'shl'):
                d, c = parts
                cnt = self.val('ecx') & 0x1f if c == 'cl' else int(c, 0) & 0x1f
                self.reg[d] = (self.reg[d] >> cnt) if mn == 'shr' else (self.reg[d] << cnt) & 0xffffffff
            elif mn == 'inc':
                self.reg[parts[0]] = (self.reg[parts[0]] + 1) & 0xffffffff
            elif mn == 'cmp':
                x = self.val(parts[0])
                y = self.val(parts[1])
                self.zf = x == y
                self.cf = x < y
                self.ucmp = (x, y)
            elif mn == 'test':
                x = self.val(parts[0])
                y = self.val(parts[1])
                if parts[0] == 'ah':
                    x = (self.fsw >> 8) & 0xff
                self.zf = (x & y) == 0
                self.cf = False
            elif mn.startswith('j'):
                tgt = int(parts[0].split()[0], 16)
                take = {'jmp': True, 'je': self.zf if mn != 'jmp' else True, 'jne': not getattr(self, 'zf', False),
                        'ja': (not self.cf and not self.zf) if mn == 'ja' else False,
                        'jbe': (self.cf or self.zf) if mn == 'jbe' else False,
                        'jb': self.cf if mn == 'jb' else False, 'jae': (not self.cf) if mn == 'jae' else False}.get(mn)
                if mn == 'jmp':
                    take = True
                if take is None:
                    raise RuntimeError('jcc ' + mn)
                if mn != 'jmp':
                    self.branches.append((a, mn, take, getattr(self, 'cmp_desc', None)))
                if take:
                    nxt = tgt
            elif mn == 'call':
                if parts[0].startswith('DWORD PTR'):
                    tgt = self.r32(self.ea(parts[0]))
                else:
                    tgt = int(parts[0].split()[0], 16)
                self.push(nxt)
                if tgt in self.natives:
                    self._jump = None
                    self.natives[tgt](self)
                    if self._jump is not None:
                        nxt = self._jump
                else:
                    raise RuntimeError('call %x from %x' % (tgt, a))
            elif mn == 'nop':
                pass
            # ---- x87 ----
            elif mn == 'fld':
                i = self.sti(parts[0])
                self.st.insert(0, self.st[i] if i is not None else self.rf(self.ea(parts[0])))
            elif mn == 'fldz':
                self.st.insert(0, (0.0, '0'))
            elif mn == 'fld1':
                self.st.insert(0, (1.0, '1'))
            elif mn in ('fst', 'fstp'):
                i = self.sti(parts[0])
                if i is not None:
                    self.st[i] = self.st[0]
                else:
                    ad = self.ea(parts[0])
                    v, s = self.st[0]
                    self.wf(ad, v, s)
                    self.stores.append((a, ad, v, s))
                if mn == 'fstp':
                    self.st.pop(0)
            elif mn == 'fxch':
                i = self.sti(parts[0]) if parts else 1
                self.st[0], self.st[i] = self.st[i], self.st[0]
            elif mn == 'fchs':
                v, s = self.st[0]
                self.st[0] = (-v, '-' + paren(s))
            elif mn in ('fmul', 'fadd', 'fsub', 'fsubr', 'fdiv', 'fdivr', 'fmulp', 'faddp', 'fsubp', 'fsubrp', 'fdivp', 'fdivrp'):
                if len(parts) == 1 and self.sti(parts[0]) is None:
                    m_ = self.rf(self.ea(parts[0]))
                    k = {'mul': '*', 'add': '+', 'sub': '-', 'div': '/'}[mn[1:4]]
                    self.st[0] = self.fop(m_, self.st[0], k) if mn.endswith('r') else self.fop(self.st[0], m_, k)
                elif b0 == 0xd8:
                    r = b1 & 7
                    kind = (b1 >> 3) & 7
                    x, y = self.st[0], self.st[r]
                    self.st[0] = {0: self.fop(x, y, '+'), 1: self.fop(x, y, '*'), 4: self.fop(x, y, '-'),
                                  5: self.fop(y, x, '-'), 6: self.fop(x, y, '/'), 7: self.fop(y, x, '/')}[kind]
                elif b0 in (0xdc, 0xde):
                    r = b1 & 7
                    kind = (b1 >> 3) & 7
                    x, y = self.st[r], self.st[0]
                    self.st[r] = {0: self.fop(x, y, '+'), 1: self.fop(x, y, '*'), 4: self.fop(y, x, '-'),
                                  5: self.fop(x, y, '-'), 6: self.fop(y, x, '/'), 7: self.fop(x, y, '/')}[kind]
                    if b0 == 0xde:
                        self.st.pop(0)
                else:
                    raise RuntimeError('fop form %x' % a)
            elif mn in ('fucom', 'fucomp', 'fucompp', 'fcom', 'fcomp', 'fcompp'):
                if parts and self.sti(parts[0]) is not None:
                    other = self.st[self.sti(parts[0])]
                elif parts:
                    other = self.rf(self.ea(parts[0]))
                else:
                    other = self.st[1]
                self.fcmp(self.st[0], other)
                n = 2 if mn.endswith('pp') else (1 if mn.endswith('p') else 0)
                for _ in range(n):
                    self.st.pop(0)
            elif mn == 'fnstsw':
                self.reg['eax'] = (self.reg['eax'] & 0xffff0000) | self.fsw
            else:
                raise RuntimeError('insn %x %s %s' % (a, mn, ops))
            a = nxt
        raise RuntimeError('too many steps')

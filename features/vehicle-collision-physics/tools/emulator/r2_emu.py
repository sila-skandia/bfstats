# R2 track: minimal unicorn harness for calling lnxded functions (cdecl, x87)
import struct, sys
from unicorn import *
from unicorn.x86_const import *

LNX = '/home/dylan/projects/public/bf42plus/bf1942_lnxded.static'
STACK = 0x7f000000; STACK_SZ = 0x100000
SCRATCH = 0x60000000; SCRATCH_SZ = 0x100000
SENT = 0x50000000

class Emu:
    def __init__(self):
        self.mu = Uc(UC_ARCH_X86, UC_MODE_32)
        data = open(LNX, 'rb').read()
        e_phoff = struct.unpack_from('<I', data, 0x1c)[0]
        e_phentsize, e_phnum = struct.unpack_from('<HH', data, 0x2a)
        for i in range(e_phnum):
            p = struct.unpack_from('<IIIIIIII', data, e_phoff + i * e_phentsize)
            ptype, off, vaddr, paddr, filesz, memsz, flags, align = p
            if ptype != 1: continue
            lo = vaddr & ~0xfff; hi = (vaddr + memsz + 0xfff) & ~0xfff
            try:
                self.mu.mem_map(lo, hi - lo)
            except UcError:
                pass
            self.mu.mem_write(vaddr, data[off:off + filesz])
        self.mu.mem_map(STACK, STACK_SZ)
        self.mu.mem_map(SCRATCH, SCRATCH_SZ)
        self.mu.mem_map(SENT, 0x1000)
        self.mu.mem_write(SENT, b'\xf4' * 16)
        self.brk = SCRATCH
        # init x87
        self.mu.reg_write(UC_X86_REG_FPCW, 0x37f)
        # finite@plt (0x804b3d4) is an unresolved import: replace with a local stub
        self.mu.mem_write(0x804b3d4, bytes.fromhex('8b442408' '250000f07f' '3d0000f07f' '0f95c0' '0fb6c0' 'c3'))
        def bad(mu, access, address, size, value, ud):
            print('UNMAPPED access', access, hex(address), 'eip', hex(mu.reg_read(UC_X86_REG_EIP)))
            return False
        self.mu.hook_add(UC_HOOK_MEM_UNMAPPED, bad)

    def alloc(self, n):
        a = self.brk; self.brk += (n + 15) & ~15; return a
    def wf(self, addr, vals):
        self.mu.mem_write(addr, struct.pack('<%df' % len(vals), *vals))
    def rf(self, addr, n):
        return list(struct.unpack('<%df' % n, bytes(self.mu.mem_read(addr, 4 * n))))
    def w32(self, addr, vals):
        self.mu.mem_write(addr, struct.pack('<%dI' % len(vals), *vals))
    def r32(self, addr, n=1):
        return list(struct.unpack('<%dI' % n, bytes(self.mu.mem_read(addr, 4 * n))))
    def code(self, b):
        a = self.alloc(len(b)); self.mu.mem_write(a, b); return a
    def call(self, fn, args, retfloat=False):
        """args: list of ints (already-encoded 32-bit words; use fbits() for floats)"""
        sp = STACK + STACK_SZ - 0x1000
        for a in reversed(args):
            sp -= 4; self.mu.mem_write(sp, struct.pack('<I', a & 0xffffffff))
        sp -= 4; self.mu.mem_write(sp, struct.pack('<I', SENT))
        self.mu.reg_write(UC_X86_REG_ESP, sp)
        self.mu.reg_write(UC_X86_REG_EBP, sp)
        self.mu.emu_start(fn, SENT, count=5_000_000)
        return self.mu.reg_read(UC_X86_REG_EAX)

def fbits(f):
    return struct.unpack('<I', struct.pack('<f', f))[0]

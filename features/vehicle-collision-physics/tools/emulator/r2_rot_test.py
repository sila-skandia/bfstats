import sys, math
sys.path.insert(0, __import__('os').path.dirname(__import__('os').path.abspath(__file__)))
from r2_emu import *
e = Emu()
ROT = 0x08061e10
def run(axis, deg, M=None):
    m = e.alloc(64); ax = e.alloc(12)
    if M is None:
        M = [1,0,0,0, 0,1,0,0, 0,0,1,0, 5,6,7,1]
    e.wf(m, M); e.wf(ax, axis)
    e.call(ROT, [m, ax, fbits(deg)])
    return e.rf(m, 16)
for axis in ([0,1,0],[1,0,0],[0,0,1],[0.6,0.0,0.8]):
    r = run(axis, 10.0)
    print('axis', axis, 'deg 10')
    for i in range(4): print('   ', ['%+.5f' % x for x in r[4*i:4*i+4]])

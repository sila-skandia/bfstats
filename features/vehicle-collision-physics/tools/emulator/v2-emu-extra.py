import sys, math, struct
sys.path.insert(0, __import__('os').path.dirname(__import__('os').path.abspath(__file__)))
from r2_emu import *
import r2_node_test_lib as L
dt = 1/30
def fresh(gmod=1.0):
    e = Emu(); L.setup_bps(e)
    bmin, bmax = [-1.0,-0.5,-2.0], [1.2,0.9,2.5]
    obj, node = L.build(e, bmin, bmax)
    M0 = [[1,0,0,0],[0,1,0,0],[0,0,1,0],[10,20,30,1]]
    M0 = L.rot_rows(M0, [0.6,0.0,0.8], 0.7)
    e.wf(obj+0x74, [x for r in M0 for x in r]); e.wf(node+0x68, [0.0]); e.wf(node+0x88, [gmod])
    m = L.Model(M0, bmin, bmax); m.gmod = gmod
    return e, obj, node, m
vecf = lambda e, v: (lambda a: (e.wf(a, v), a)[1])(e.alloc(12))
def cmp(tag, e, obj, node, m):
    st = L.readnode(e, node, obj)
    err = max(max(abs(x-y) for x,y in zip(st['v'], m.v)), max(abs(x-y) for x,y in zip(st['w'], m.w)),
              max(abs(x-y) for x,y in zip(st['M'], [x for r in m.M for x in r])))
    print('%-34s v=%s w=%s sleep=%d/%d err=%.2e' % (tag, ['%.4f'%x for x in st['v']], ['%.4f'%x for x in st['w']], st['sleep'], m.sleep, err))
# H: rotational acceleration clamp (|racc| > 1000), linear acc under the clamp
e,obj,node,m = fresh()
p = L.add(m.pos(), [30.0, 5.0, -20.0]); a=[40.0, -55.0, 35.0]
e.call(L.ADD_ACC_ABS,[node,vecf(e,p),vecf(e,a)]); m.addAcc(p,a)
print('   |racc| =', math.sqrt(L.dot(m.racc,m.racc)), '|acc| =', math.sqrt(L.dot(m.acc,m.acc)))
e.call(L.UPDATE,[node,fbits(dt)]); m.update(dt); cmp('H racc > 1000 clamp', e,obj,node,m)
# I: the rammed-sleeper sequence: asleep root, impulse posted, then setIsAwake (as addFriction does), then update
e,obj,node,m = fresh(gmod=1.0)
e.w32(node+0x94,[0]); m.sleep = 0
e.call(L.UPDATE,[node,fbits(dt)]); m.update(dt); cmp('I0 asleep idle tick', e,obj,node,m)
J=[0.5*30*0.5, 0.0, 0.0]   # speedAdjust 0.5 m/s, e=0 -> acc 7.5
e.call(L.ADD_ACC_ABS,[node,vecf(e,m.pos()),vecf(e,J)]); m.addAcc(m.pos(),J)
e.call(0x08255330,[node]); m.sleep = 100           # root.setIsAwake() from addFriction
st=L.readnode(e,node,obj); print('   after post+wake: acc=',st['acc'],'sleep',st['sleep'])
e.call(L.UPDATE,[node,fbits(dt)]); m.update(dt); cmp('I1 first integrated tick', e,obj,node,m)
st=L.readnode(e,node,obj); print('   acc seeded for next tick:', st['acc'])
# J: impulse too small for either waker (acc^2 < 2.5, no setIsAwake): lost
e,obj,node,m = fresh(gmod=1.0)
e.w32(node+0x94,[0]); m.sleep = 0
Js=[1.5,0,0]
e.call(L.ADD_ACC_ABS,[node,vecf(e,m.pos()),vecf(e,Js)]); m.addAcc(m.pos(),Js)
e.call(L.UPDATE,[node,fbits(dt)]); m.update(dt); cmp('J small impulse on sleeper: lost', e,obj,node,m)
st=L.readnode(e,node,obj); print('   acc after:', st['acc'])

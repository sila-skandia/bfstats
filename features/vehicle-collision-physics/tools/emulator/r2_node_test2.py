import sys, math, random, struct
sys.path.insert(0, __import__('os').path.dirname(__import__('os').path.abspath(__file__)))
from r2_emu import *
import r2_node_test_lib as L

def fresh(flags=0x2090400, gmod=1.0, classid=0x1234):
    e = Emu(); L.setup_bps(e)
    bmin, bmax = [-1.0,-0.5,-2.0], [1.2,0.9,2.5]
    obj, node = L.build(e, bmin, bmax, classid=classid, flags=flags)
    M0 = [[1,0,0,0],[0,1,0,0],[0,0,1,0],[10,20,30,1]]
    M0 = L.rot_rows(M0, [0.6,0.0,0.8], 0.7)
    e.wf(obj+0x74, [x for r in M0 for x in r]); e.wf(node+0x68, [0.0]); e.wf(node+0x88, [gmod])
    m = L.Model(M0, bmin, bmax); m.gmod = gmod
    return e, obj, node, m
vecf = lambda e, v: (lambda a: (e.wf(a, v), a)[1])(e.alloc(12))
dt = 1/30
def cmp(tag, e, obj, node, m):
    st = L.readnode(e, node, obj)
    err = max(max(abs(x-y) for x,y in zip(st['v'], m.v)), max(abs(x-y) for x,y in zip(st['w'], m.w)),
              max(abs(x-y) for x,y in zip(st['M'], [x for r in m.M for x in r])))
    print('%-28s v=%s w=%s sleep=%d/%d err=%.2e' % (tag, ['%.4f'%x for x in st['v']], ['%.4f'%x for x in st['w']], st['sleep'], m.sleep, err))

# A: acceleration clamp
e,obj,node,m = fresh()
p = m.pos(); a=[3000,4000,0]
e.call(L.ADD_ACC_ABS,[node,vecf(e,p),vecf(e,a)]); m.addAcc(p,a)
e.call(L.UPDATE,[node,fbits(dt)]); m.update(dt); cmp('A acc 5000 -> clamp 1000', e,obj,node,m)
# B: friction drop > 250
e,obj,node,m = fresh()
f=[300,0,0]; e.call(L.ADD_FRIC_ABS,[node,vecf(e,m.pos()),vecf(e,f)]); m.addFric(m.pos(),f)
e.call(L.UPDATE,[node,fbits(dt)]); m.update(dt); cmp('B friction 300 dropped', e,obj,node,m)
e,obj,node,m = fresh()
f=[240,0,0]; e.call(L.ADD_FRIC_ABS,[node,vecf(e,m.pos()),vecf(e,f)]); m.addFric(m.pos(),f)
e.call(L.UPDATE,[node,fbits(dt)]); m.update(dt); cmp('B2 friction 240 kept', e,obj,node,m)
# C: rotational friction > 200 : quirk
e,obj,node,m = fresh()
p = L.add(m.pos(), [3,1,2]); f=[100,-80,60]
e.call(L.ADD_FRIC_ABS,[node,vecf(e,p),vecf(e,f)]); m.addFric(p,f)
print('   |rfr| =', math.sqrt(L.dot(m.rfr,m.rfr)), '|fr| =', math.sqrt(L.dot(m.fr,m.fr)))
e.call(L.UPDATE,[node,fbits(dt)]); m.update(dt); cmp('C rot friction >200 quirk', e,obj,node,m)
# D: fallback branch (flag 0x4000000) 
e,obj,node,m = fresh(flags=0x2090400|0x4000000)
p = L.add(m.pos(), [1,0.5,-1]); a=[5,-3,8]
e.call(L.ADD_ACC_ABS,[node,vecf(e,p),vecf(e,a)]); m.addAcc(p,a)
st0 = L.readnode(e,node,obj)
e.call(L.UPDATE,[node,fbits(dt)])
st = L.readnode(e,node,obj)
exp = [x*dt/0.0314 for x in st0['racc']]
print('D fallback: w=', st['w'], 'expected racc*dt/0.0314 =', exp)
# E: sleeping
e,obj,node,m = fresh(gmod=0.0)
for i in range(101):
    e.call(L.UPDATE,[node,fbits(dt)]); m.update(dt)
    if i in (0,98,99,100): cmp('E idle tick %d'%i, e,obj,node,m)
a=[1.0,0,0]; e.call(L.ADD_ACC_ABS,[node,vecf(e,m.pos()),vecf(e,a)]); m.addAcc(m.pos(),a)
e.call(L.UPDATE,[node,fbits(dt)]); m.update(dt); cmp('E asleep + acc 1.0 (no wake)', e,obj,node,m)
a=[1.6,0,0]; e.call(L.ADD_ACC_ABS,[node,vecf(e,m.pos()),vecf(e,a)]); m.addAcc(m.pos(),a)
e.call(L.UPDATE,[node,fbits(dt)]); m.update(dt); cmp('E asleep + acc 1.6 (wake)', e,obj,node,m)
# F: soldier class never runs the wake/sleep counter
e,obj,node,m = fresh(gmod=0.0, classid=0x9493)
for i in range(150): e.call(L.UPDATE,[node,fbits(dt)])
print('F soldier sleepiness after 150 idle ticks:', L.readnode(e,node,obj)['sleep'])
# G: negative sleepiness = never wakes
e,obj,node,m = fresh()
e.w32(node+0x94,[0xffffffff]); a=[50.0,0,0]; e.call(L.ADD_ACC_ABS,[node,vecf(e,m.pos()),vecf(e,a)])
e.call(L.UPDATE,[node,fbits(dt)]); st=L.readnode(e,node,obj); print('G sleepiness -1 + acc 50: v=',st['v'],'sleep',struct.unpack('<i',struct.pack('<I',st['sleep']))[0])

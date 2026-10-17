"""The retail horse's lean against its turn, from the body axes, not eulers."""
import json, math, sys, collections
F=sys.argv[1]
ids={}; track=collections.defaultdict(list)
for line in open(F):
    try: d=json.loads(line)
    except: continue
    if d.get('k')=='o' and str(d.get('tmpl','')).startswith('Cavalry'): ids[d['id']]=d['tmpl']
    elif d.get('k')=='s':
        for r in d['o']:
            if r[0] in ids: track[r[0]].append((d['t'],*r[1:8]))
i=max(track, key=lambda k: len(track[k]))
rows=track[i]
def rot(q,v):
    qx,qy,qz,qw=q; vx,vy,vz=v
    tx=2*(qy*vz-qz*vy); ty=2*(qz*vx-qx*vz); tz=2*(qx*vy-qy*vx)
    return (vx+qw*tx+qy*tz-qz*ty, vy+qw*ty+qz*tx-qx*tz, vz+qw*tz+qx*ty-qy*tx)
S=15   # half-second smoothing at 30 Hz
print(f"{ids[i]} id {i}: t  speed  yawRate(deg/s)  lean(deg, +into the turn)  tilt(deg)")
out=[]
for n in range(S, len(rows)-S):
    t0,x0,y0,z0,*q0 = rows[n-S]
    t1,x1,y1,z1,*q1 = rows[n+S]
    t,x,y,z,*q = rows[n]
    dt=t1-t0
    if dt<=0: continue
    vx,vz=(x1-x0)/dt,(z1-z0)/dt
    sp=math.hypot(vx,vz)
    if sp<0.5: continue
    f0=rot(q0,(0,0,1)); f1=rot(q1,(0,0,1))
    a0=math.atan2(f0[0],f0[2]); a1=math.atan2(f1[0],f1[2])
    dyaw=((a1-a0+math.pi)%(2*math.pi)-math.pi)/dt
    up=rot(q,(0,1,0))
    hx,hz=vx/sp,vz/sp
    rx,rz=hz,-hx                       # horizontal right of travel
    lean=math.degrees(math.asin(max(-1,min(1,up[0]*rx+up[2]*rz))))
    tilt=math.degrees(math.acos(max(-1,min(1,up[1]))))
    # +lean means the top tips right; turning right is dyaw>0 in this frame
    into = lean if dyaw>0 else -lean
    out.append((t,sp,math.degrees(dyaw),into,tilt))
fast=[r for r in out if r[1]>4 and abs(r[2])>8]
print(f"  samples moving: {len(out)}; at speed (>4 m/s) and turning (>8 deg/s): {len(fast)}")
step=max(1,len(out)//30)
for r in out[::step]: print("  %6.2f  %5.2f  %8.1f  %8.2f  %6.2f" % r)
if fast:
    print("\n  AT SPEED AND TURNING:")
    for r in fast[::max(1,len(fast)//15)]: print("  %6.2f  %5.2f  %8.1f  %8.2f  %6.2f" % r)
    m=sum(r[3] for r in fast)/len(fast)
    print(f"\n  mean lean into the turn at speed: {m:+.2f} deg  (negative = leaning OUT)")

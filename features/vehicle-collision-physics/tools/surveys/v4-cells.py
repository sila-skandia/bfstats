#!/usr/bin/env python3
"""v4-cells.py: independent replay of Bf1942/Game/MaterialManagerSettings.con with engine semantics read from objdump:
 - Material ctor 0x08174550: defGroup=-1 attGroup=-1 damage=0 friction=1 elasticity=0 resistance=0.01
 - MMCell ctor 0x081745f0: damageMod=1.0
 - damageMod / setEffectTemplate -> getCreateCell() (creates when att&def != -1)
 - setCell def f -> getCreateCell(attGroup, def)
 - getDamageMod(a,d): mat a (fallback mat 0) .attGroup ; mat d (fallback mat 0) .defGroup ; getCell -> cell.damageMod else defaultDamageMod 0.0
"""
import sys, re, json, pickle
from pathlib import Path
ROOT=Path(sys.argv[1])  # directory holding Bf1942/Game extracted
START='materialManagerSettings.con'
FLOAT=re.compile(r'^[+-]?(\d+\.?\d*([eE][+-]?\d+)?|\.\d+([eE][+-]?\d+)?)')
def atof(s):
    m=FLOAT.match(s.strip())
    return float(m.group(0)) if m else 0.0
class MM:
    def __init__(s):
        s.mats={}; s.cells={}; s.cur=None; s.att=-1; s.deff=-1
        s.writes=0; s.effonly=set(); s.log=[]; s.odd=[]
        s.files=[]; s.missing=[]; s.overwrites=[]
    def mat(s,i):
        if i not in s.mats:
            s.mats[i]=dict(defGroup=-1,attGroup=-1,damage=0.0,friction=1.0,elasticity=0.0,resistance=0.01,authored=set())
        s.cur=i
    def cell(s,a,d,create=True):
        if a==-1 or d==-1: return None
        k=(a,d)
        if k not in s.cells:
            if not create: return None
            s.cells[k]=dict(damageMod=1.0,dm_authored=False,effects=[],src=[])
        return s.cells[k]
mm=MM()
def find_ci(base:Path, rel:str):
    parts=[p for p in rel.replace('\\','/').split('/') if p]
    cur=base
    for p in parts:
        nxt=None
        if cur.is_dir():
            for c in cur.iterdir():
                if c.name.lower()==p.lower(): nxt=c;break
        if nxt is None: return None
        cur=nxt
    return cur
def run(path:Path, depth=0):
    mm.files.append(str(path.relative_to(ROOT)))
    inrem=False
    for ln,line in enumerate(path.read_text(encoding='latin-1').splitlines(),1):
        s=line.strip()
        if not s: continue
        t=s.split()
        w=t[0].lower()
        if w=='beginrem': inrem=True; continue
        if w=='endrem': inrem=False; continue
        if inrem or w=='rem': continue
        if w in('run','include'):
            tgt=t[1]
            if not tgt.lower().endswith('.con'): tgt+='.con'
            p=find_ci(path.parent,tgt)
            if p is None: mm.missing.append((str(path.name),ln,t[1])); continue
            run(p,depth+1); continue
        if not w.startswith('materialmanager.'):
            mm.odd.append((path.name,ln,s)); continue
        prop=w.split('.',1)[1]; args=t[1:]
        where=f'{path.name}:{ln}'
        if prop=='material': mm.mat(int(atof(args[0])))
        elif prop in('materialattgroup','materialdefgroup','materialdamage','materialfriction','materialelasticity','materialresistance'):
            m=mm.mats[mm.cur]; key={'materialattgroup':'attGroup','materialdefgroup':'defGroup','materialdamage':'damage','materialfriction':'friction','materialelasticity':'elasticity','materialresistance':'resistance'}[prop]
            v=atof(args[0]); m[key]=int(v) if key.endswith('Group') else v; m['authored'].add(key)
        elif prop=='attgroup': mm.att=int(atof(args[0]))
        elif prop=='defgroup': mm.deff=int(atof(args[0]))
        elif prop=='damagemod':
            c=mm.cell(mm.att,mm.deff)
            if c is None: mm.odd.append((path.name,ln,'damageMod with no context')); continue
            if not re.fullmatch(r'[+-]?\d+(\.\d*)?|\.\d+',args[0]): mm.odd.append((path.name,ln,s))
            v=atof(args[0])
            if c['dm_authored'] and c['damageMod']!=v: mm.overwrites.append(((mm.att,mm.deff),c['damageMod'],v,where))
            c['damageMod']=v; c['dm_authored']=True; c['src'].append(where); mm.writes+=1
        elif prop=='setcell':
            d=int(atof(args[0])); v=atof(args[1]); c=mm.cell(mm.att,d)
            if c is None: mm.odd.append((path.name,ln,'setCell no att')); continue
            if c['dm_authored'] and c['damageMod']!=v: mm.overwrites.append(((mm.att,d),c['damageMod'],v,where))
            c['damageMod']=v; c['dm_authored']=True; c['src'].append(where+'(setCell)'); mm.writes+=1
        elif prop=='seteffecttemplate':
            c=mm.cell(mm.att,mm.deff)
            if c is None: mm.odd.append((path.name,ln,'setEffectTemplate no ctx')); continue
            c['effects'].append((args[0], atof(args[1]) if len(args)>1 else None, where))
        else: mm.odd.append((path.name,ln,s))
run(find_ci(ROOT,START))
def getDamageMod(a,d,default=0.0):
    ma=mm.mats.get(a) or mm.mats.get(0); md=mm.mats.get(d) or mm.mats.get(0)
    if ma is None or md is None: return default,'nomat'
    c=mm.cells.get((ma['attGroup'],md['defGroup'])) if ma['attGroup']!=-1 and md['defGroup']!=-1 else None
    if c is None: return default,'NOCELL->default'
    return c['damageMod'],('authored '+c['src'][-1] if c['dm_authored'] else 'CREATED-BY-EFFECT-ONLY(1.0)')
def dmgFor(i):
    m=mm.mats.get(i) or mm.mats.get(0); return m['damage'] if m else 0.0
if __name__=='__main__':
    print('files run:',len(mm.files)); print('missing run targets:',len(mm.missing),[m[2] for m in mm.missing])
    print('materials:',len(mm.mats),'ids',min(mm.mats),'..',max(mm.mats))
    print('damageMod/setCell writes:',mm.writes,'distinct cells:',len(mm.cells),'with authored damageMod:',sum(c['dm_authored'] for c in mm.cells.values()))
    eo=[k for k,c in mm.cells.items() if not c['dm_authored']]
    print('cells created by setEffectTemplate only (damageMod stays 1.0):',len(eo),eo[:20])
    print('overwrites with a different value:',len(mm.overwrites))
    for o in mm.overwrites[:15]: print('   ',o)
    print('odd lines:',len(mm.odd))
    for o in mm.odd[:20]: print('   ',o)
    ng=[(i,m['attGroup'],m['defGroup']) for i,m in sorted(mm.mats.items()) if m['attGroup']!=i or m['defGroup']!=i]
    print('materials whose att/def group != id:',ng)
    pickle.dump(dict(mats=mm.mats,cells=mm.cells),open('v4-mm.pkl','wb'))

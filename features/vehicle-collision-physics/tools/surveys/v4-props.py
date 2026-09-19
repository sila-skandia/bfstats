#!/usr/bin/env python3
"""v4-props.py <mod>...: per-template authored values of anglemod/inertiamodifier/damagemod/speedmod across every archive; honours rem/beginrem; tracks create+active."""
import sys,re,os
from pathlib import Path
from collections import Counter,defaultdict
sys.path.insert(0, str(Path.home()/'.claude/skills/bf1942-map-images/scripts'))
from extract_map_images import RfaArchive
MODS=Path.home()/'.wine/drive_c/EA Games/Battlefield 1942/Mods'
W={'anglemod','inertiamodifier','damagemod','speedmod','mass','hitpoints','hasarmor'}
for mod in sys.argv[1:]:
    rows=defaultdict(dict); types={}
    for root,dirs,files in os.walk(MODS/mod):
        for fn in sorted(files):
            if not fn.lower().endswith('.rfa'): continue
            p=Path(root)/fn; a=RfaArchive(p)
            for name in a.entries:
                if not name.lower().endswith('.con'): continue
                if '/vehicles/' not in name.lower(): continue
                cur=None; inrem=False
                for line in a.read(name).decode('latin-1').splitlines():
                    t=line.split()
                    if not t: continue
                    w=t[0].lower()
                    if w=='beginrem': inrem=True; continue
                    if w=='endrem': inrem=False; continue
                    if inrem or w=='rem': continue
                    if w=='objecttemplate.create' and len(t)>2: cur=(p.name,name.rsplit('/',1)[0],t[2].lower()); types[cur]=t[1]; continue
                    if w=='objecttemplate.active' and len(t)>1: cur=(p.name,name.rsplit('/',1)[0],t[1].lower()); continue
                    if w.startswith('objecttemplate.') and cur:
                        k=w.split('.',1)[1]
                        if k in W and len(t)>1: rows[cur][k]=t[1]
            a.close()
    print('=====',mod)
    cat=Counter(); am=Counter(); im=Counter(); dm=[]
    for key,pr in sorted(rows.items()):
        if 'damagemod' in pr: dm.append((key,pr))
        if types.get(key,'').lower()!='playercontrolobject' or 'mass' not in pr: continue
        if key[0].lower()!='objects.rfa': continue
        parts=key[1].lower().split('/'); c=parts[parts.index('vehicles')+1] if 'vehicles' in parts else '?'
        cat[c]+=1
        if 'anglemod' in pr: am[c]+=1
        if 'inertiamodifier' in pr: im[c]+=1
    print(' PCO roots with mass (Objects.rfa only) by category:',dict(cat))
    print(' ... authoring angleMod:',dict(am),' inertiaModifier:',dict(im))
    print(' templates authoring damageMod:')
    for k,pr in dm: print('    ',k,types.get(k),pr)

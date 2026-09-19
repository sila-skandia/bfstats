#!/usr/bin/env python3
"""v4-sm.py <sm entry names...>: independent minimal .sm collision reader. Histograms FACE material byte AND the per-vertex 4th word (as u16,u16)."""
import sys, struct
from pathlib import Path
from collections import Counter
sys.path.insert(0, str(Path.home()/'.claude/skills/bf1942-map-images/scripts'))
from extract_map_images import RfaArchive
MODS=Path.home()/'.wine/drive_c/EA Games/Battlefield 1942/Mods'
a=RfaArchive(MODS/'bf1942/Archives/standardMesh.rfa')
low={k.lower():k for k in a.entries}
for want in sys.argv[1:]:
    k=low['standardmesh/'+want.lower()]
    d=a.read(k); p=0
    ver,zero=struct.unpack_from('<II',d,p); p+=8
    p+=24
    if ver>9: p+=1
    (ncol,)=struct.unpack_from('<I',d,p); p+=4
    print(f'== {k} version {ver} collision layers {ncol}')
    for li in range(ncol):
        (size,)=struct.unpack_from('<I',d,p); p+=4; end=p+size
        u1,u2,nv=struct.unpack_from('<III',d,p); p+=12
        vm=Counter(); vu=Counter()
        for i in range(nv):
            x,y,z,m,u=struct.unpack_from('<3fHH',d,p); p+=16
            vm[m]+=1; vu[u]+=1
        (nf,)=struct.unpack_from('<I',d,p); p+=4
        fm=Counter(); ff=Counter()
        for i in range(nf):
            i0,i1,i2,m,fl=struct.unpack_from('<3hBB',d,p); p+=8
            assert 0<=min(i0,i1,i2) and max(i0,i1,i2)<nv
            fm[m]+=1; ff[fl]+=1
        print(f'  layer {li}: hdr=({u1},{u2}) verts {nv} faces {nf}')
        print(f'     face material: {dict(sorted(fm.items()))}  face flags: {dict(sorted(ff.items()))}')
        print(f'     vertex u16[0] : {dict(sorted(vm.items()))}  vertex u16[1]: {dict(sorted(vu.items()))}')
        p=end

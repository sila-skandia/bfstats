#!/usr/bin/env python3
"""r3-x87.py START STOP [init-stack comma list, top first] [-v]
Symbolic x87 tracer for straight-line lnxded code, decoding from RAW BYTES so the
AT&T fsub/fsubr/fdiv/fdivr mnemonic swap cannot bite. Prints every store, compare, call and jump."""
import sys, subprocess, re
BIN='/home/dylan/projects/public/bf42plus/bf1942_lnxded.static'
start,stop=sys.argv[1],sys.argv[2]
class Stk(list):
    n=0
    def _grow(self,i):
        while len(self)<=i:
            self.append('in%d'%Stk.n); Stk.n+=1
    def __getitem__(self,i):
        if isinstance(i,int): self._grow(i)
        return list.__getitem__(self,i)
    def __setitem__(self,i,v):
        if isinstance(i,int): self._grow(i)
        list.__setitem__(self,i,v)
    def pop(self,i=0):
        self._grow(i); return list.pop(self,i)
st=Stk([s for s in (sys.argv[3].split(',') if len(sys.argv)>3 and sys.argv[3]!='-' else []) if s])
fcalls=set()
for a in sys.argv:
    if a.startswith('-c='): fcalls=set(x.lower().lstrip('0x') for x in a[3:].split(','))
verbose='-v' in sys.argv
out=subprocess.run(['objdump','-d','--start-address='+start,'--stop-address='+stop,BIN],capture_output=True,text=True).stdout
mem={}
def P(e): return e if re.fullmatch(r'[\w\.\[\]\(\)%\-\+x:$]+',e) and not any(c in e for c in ' ') else '('+e+')'
def load(op):
    return mem.get(op,'['+op+']')
def store(op,e,addr):
    if len(e)>60:
        print(f'  {addr}: {op} := {e}'); mem[op]='<'+op+'>'
    else:
        print(f'  {addr}: {op} := {e}'); mem[op]=e
def binop(o,a,b): return f'{P(a)} {o} {P(b)}'
for line in out.splitlines():
    m=re.match(r'\s*([0-9a-f]+):\t((?:[0-9a-f]{2} )+)\s*\t(.*)',line)
    if not m: continue
    addr=m.group(1); by=[int(x,16) for x in m.group(2).split()]; txt=m.group(3).strip()
    txt=re.sub(r'\s*<.*','',txt)
    mn=txt.split()[0]; ops=txt[len(mn):].strip()
    b0=by[0]
    if b0 in (0xd8,0xd9,0xda,0xdb,0xdc,0xdd,0xde,0xdf) and len(by)>=2:
        b1=by[1]; mod=b1>>6; reg=(b1>>3)&7; rm=b1&7
        if mod==3:
            i=rm
            if b0==0xd8:
                if reg==0: st[0]=binop('+',st[0],st[i])
                elif reg==1: st[0]=binop('*',st[0],st[i])
                elif reg==2: print(f'  {addr}: CMP st0={st[0]}  vs  st{i}={st[i]}')
                elif reg==3: print(f'  {addr}: CMP st0={st[0]}  vs  st{i}={st[i]} (pop)'); st.pop(0)
                elif reg==4: st[0]=binop('-',st[0],st[i])
                elif reg==5: st[0]=binop('-',st[i],st[0])
                elif reg==6: st[0]=binop('/',st[0],st[i])
                elif reg==7: st[0]=binop('/',st[i],st[0])
            elif b0==0xd9:
                if reg==0: st.insert(0,st[i])
                elif reg==1: st[0],st[i]=st[i],st[0]
                elif b1==0xe0: st[0]='-'+P(st[0])
                elif b1==0xe1: st[0]='abs('+st[0]+')'
                elif b1==0xe8: st.insert(0,'1.0')
                elif b1==0xee: st.insert(0,'0.0')
                elif b1==0xfa: st[0]='sqrt('+st[0]+')'
                elif b1==0xe4: print(f'  {addr}: FTST st0={st[0]} vs 0')
                else: print(f'  {addr}: ?? {txt}')
            elif b0==0xda:
                if b1==0xe9: print(f'  {addr}: CMP st0={st[0]}  vs  st1={st[1]} (pop2)'); st.pop(0); st.pop(0)
                else: print(f'  {addr}: ?? {txt}')
            elif b0==0xdc or b0==0xde:
                pop=(b0==0xde)
                if b0==0xde and b1==0xd9:
                    print(f'  {addr}: CMP st0={st[0]}  vs  st1={st[1]} (pop2)'); st.pop(0); st.pop(0); continue
                if reg==0: st[i]=binop('+',st[i],st[0])
                elif reg==1: st[i]=binop('*',st[i],st[0])
                elif reg==4: st[i]=binop('-',st[0],st[i])
                elif reg==5: st[i]=binop('-',st[i],st[0])
                elif reg==6: st[i]=binop('/',st[0],st[i])
                elif reg==7: st[i]=binop('/',st[i],st[0])
                else: print(f'  {addr}: ?? {txt}')
                if pop: st.pop(0)
            elif b0==0xdd:
                if reg==2: st[i]=st[0]
                elif reg==3:
                    st[i]=st[0]; st.pop(0)
                elif reg==4: print(f'  {addr}: CMP st0={st[0]}  vs  st{i}={st[i]}')
                elif reg==5: print(f'  {addr}: CMP st0={st[0]}  vs  st{i}={st[i]} (pop)'); st.pop(0)
                elif reg==0: pass
                else: print(f'  {addr}: ?? {txt}')
            elif b0==0xdf:
                if b1==0xe0: pass
                else: print(f'  {addr}: ?? {txt}')
            else: print(f'  {addr}: ?? {txt}')
        else:
            op=ops
            if b0 in (0xd8,0xdc):
                v=load(op)
                if reg==0: st[0]=binop('+',st[0],v)
                elif reg==1: st[0]=binop('*',st[0],v)
                elif reg==2: print(f'  {addr}: CMP st0={st[0]}  vs  {v}')
                elif reg==3: print(f'  {addr}: CMP st0={st[0]}  vs  {v} (pop)'); st.pop(0)
                elif reg==4: st[0]=binop('-',st[0],v)
                elif reg==5: st[0]=binop('-',v,st[0])
                elif reg==6: st[0]=binop('/',st[0],v)
                elif reg==7: st[0]=binop('/',v,st[0])
            elif b0 in (0xd9,0xdd):
                if reg==0: st.insert(0,load(op))
                elif reg==2: store(op,st[0],addr)
                elif reg==3: store(op,st[0],addr); st.pop(0)
                elif b0==0xd9 and reg in (5,7): pass
                elif b0==0xdd and reg==7: pass
                else: print(f'  {addr}: ?? {txt}')
            elif b0 in (0xdb,0xdf) and reg==0: st.insert(0,'int('+load(op)+')')
            elif b0 in (0xdb,0xdf) and reg in (2,3):
                store(op,'toint('+st[0]+')',addr)
                if reg==3: st.pop(0)
            elif b0==0xda:
                v='int('+load(op)+')'
                if reg==1: st[0]=binop('*',st[0],v)
                elif reg==0: st[0]=binop('+',st[0],v)
                else: print(f'  {addr}: ?? {txt}')
            else: print(f'  {addr}: ?? {txt}')
        if verbose: print(f'     {addr} {txt:40s} | '+' | '.join(st))
    else:
        if mn=='call' and addr in fcalls:
            st.insert(0,'ret@'+addr)
        if mn.startswith('j') or mn in ('call','ret','test','cmp','and','xor','sahf','xorb','andb','orb') or mn.startswith('cmp') or mn.startswith('test'):
            print(f'  {addr}: {txt}')
        elif mn.startswith('mov') and ops.count(',')>=1 and '(%ebp)' in ops.split(',')[-1] and not ops.startswith('$'):
            src,dst=ops.rsplit(',',1) if ops.count(',')==1 else (ops[:ops.rfind(',')],ops[ops.rfind(',')+1:])
            # register copy of a float slot: track through registers
            mem[dst]=mem.get(src,mem.get('reg:'+src,'['+src+']'))
            if verbose: print(f'     {addr}: {dst} <- {mem[dst]}')
        elif mn.startswith('mov') and ops.count(',')==1:
            src,dst=ops.split(',')
            if dst.startswith('%') and '(' in src:
                mem['reg:'+dst]=mem.get(src,'['+src+']')
            elif dst.startswith('%'):
                mem.pop('reg:'+dst,None)
print('final stack:',st)

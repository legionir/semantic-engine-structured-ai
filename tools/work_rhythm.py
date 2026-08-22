#!/usr/bin/env python3
"""Work-rhythm analyzer: extracts the ORDER and transitions of work phases
(discover -> read -> change -> verify -> plan -> memory) and the redundant
re-read / API-probe waste. Usage: python3 work_rhythm.py <session.json>
"""
import json,sys,os,re
from collections import Counter

PHASES = {
  'discover': {'fs_list','fs_tree','search_start','search_get'},
  'read':     {'fs_read','fs_read_many','fs_stat','archive_get'},
  'change':   {'fs_write','fs_edit','fs_mkdir','fs_move','fs_delete'},
  'verify':   {'terminal_exec','process_start','process_read','git_status','git_diff','git_log'},
  'plan':     {'plan_get','plan_set','plan_update'},
  'memory':   {'memory_get','memory_set','archive_search','skill_get'},
}
PHASE_OF = {t:ph for ph,ts in PHASES.items() for t in ts}

def main(path):
    d=json.load(open(path)); ev=d['events']
    # ordered steps with phase
    steps=[]
    for e in ev:
        if e['type']=='tool:start':
            steps.append((e['seq'], e.get('name'), PHASE_OF.get(e.get('name'),'other')))
    # phase sequence (compressed)
    seq=[]
    for s in steps:
        if not seq or seq[-1]!=s[2]: seq.append(s[2])
    trans=Counter()
    for a,b in zip(seq,seq[1:]): trans[(a,b)]+=1
    phases=Counter(s[2] for s in steps)
    # waste: redundant re-reads
    readcount=Counter()
    for e in ev:
        if e['type']=='tool:start' and e.get('name')=='fs_read':
            a=e.get('arguments_preview') or ''
            m=re.search(r'"path"\s*:\s*"([^"]+)"', a)
            if m: readcount[m.group(1)]+=1
    re_reads={k:v for k,v in readcount.items() if v>=3}
    # waste: node -e API probes
    api_probes=sum(1 for e in ev if e['type']=='tool:start' and 'node -e' in (e.get('arguments_preview') or ''))
    print(f"=== WORK RHYTHM: {os.path.basename(path)} ===")
    print(f"steps={len(steps)} phase-transitions={len(seq)-1}")
    print(f"phase mix: {dict(phases)}")
    print("\nphase sequence:")
    print("  "+" → ".join(seq))
    print("\ntop phase transitions:")
    for (a,b),n in trans.most_common(10): print(f"   {a} → {b}: {n}")
    print(f"\nredundant re-reads (>=3x): {len(re_reads)} files, total extra reads={sum(v-1 for v in re_reads.values())}")
    for k,v in sorted(re_reads.items(),key=lambda x:-x[1]): print(f"   x{v} {k}")
    print(f"\nnode -e API-probe terminal calls: {api_probes}")

if __name__=='__main__':
    main(sys.argv[1])

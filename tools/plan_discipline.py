#!/usr/bin/env python3
"""Plan-discipline analyzer: does the agent follow the plan cycle
(plan_get at run start -> work -> plan_update with evidence)?
Uses seq boundaries of run:start to segment the session.
Usage: python3 plan_discipline.py <session.json>
"""
import json,sys,os

def main(path):
    d=json.load(open(path)); ev=d['events']
    # find run boundaries by seq
    bounds=[(e.get('seq'), e.get('run_id')) for e in ev if e['type']=='run:start']
    print(f"=== PLAN DISCIPLINE: {os.path.basename(path)} ===")
    print(f"runs in session: {len(bounds)}")
    for i,(start,rid) in enumerate(bounds):
        end = bounds[i+1][0] if i+1<len(bounds) else 10**9
        seg=[e for e in ev if start<=e.get('seq',0)<end]
        firsts=[]
        for e in seg:
            if e['type']=='tool:start': firsts.append(('tool',e.get('name')))
            elif e['type']=='agent:action': firsts.append(('action',e.get('action')))
            if len(firsts)>=4: break
        plan_get=any(e['type']=='tool:start' and e.get('name')=='plan_get' for e in seg)
        plan_upd=sum(1 for e in seg if e['type']=='tool:start' and e.get('name')=='plan_update')
        changed=sum(1 for e in seg if e['type']=='tool:start' and e.get('name') in ('fs_write','fs_edit'))
        verified=sum(1 for e in seg if e['type']=='tool:start' and e.get('name')=='terminal_exec')
        deleg=any(e['type']=='delegation:start' for e in seg)
        print(f"\n  run {rid[-14:]}  first_actions={firsts}")
        print(f"     plan_get_at_start={plan_get}  plan_update={plan_upd}  changes={changed}  verifies={verified}  delegated={deleg}")

if __name__=='__main__':
    main(sys.argv[1])

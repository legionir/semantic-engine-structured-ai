#!/usr/bin/env python3
"""Process analyzer for structured-ai session logs.

Reconstructs HOW the agent worked (decision flow, tool selection, work
rhythm, delegation, plan discipline, iteration efficiency) from the event
stream of a .agent/sessions/*.json file - not errors or commands.

Usage: python3 process_analyzer.py <session.json>
"""
import json, sys, os
from collections import Counter, defaultdict

PHASES = {
  'discover': {'fs_list','fs_tree','search_start','search_get'},
  'read':     {'fs_read','fs_read_many','fs_stat','archive_get'},
  'change':   {'fs_write','fs_edit','fs_mkdir','fs_move','fs_delete'},
  'verify':   {'terminal_exec','process_start','process_read','git_status','git_diff','git_log'},
  'plan':     {'plan_get','plan_set','plan_update'},
  'memory':   {'memory_get','memory_set','archive_search','skill_get'},
}
PHASE_OF = {t:ph for ph,ts in PHASES.items() for t in ts}

def build_flow(events):
    iters=[]; cur=[]
    for e in events:
        if e['type']=='agent:iteration' and cur: iters.append(cur); cur=[]
        cur.append(e)
    if cur: iters.append(cur)
    flow=[]
    for idx,evs in enumerate(iters):
        rec={'iter':idx+1,'agent':None,'action':None,'thinking_chars':0,
             'tools_started':[],'tools_ok':0,'tools_fail':0,'graph_shape':None,
             'malformed':None,'repaired':None}
        for e in evs:
            t=e['type']
            if t=='agent:iteration': rec['agent']=e.get('agent')
            elif t=='agent:thinking': rec['thinking_chars']=len(e.get('content') or '')
            elif t=='agent:action': rec['action']=e.get('action')
            elif t=='tool:graph': rec['graph_shape']=e.get('shape')
            elif t=='tool:start':
                rec['tools_started'].append(e.get('name'))
                rec['graph_shape']=rec.get('graph_shape') or e.get('shape')
            elif t=='tool:end':
                if e.get('success') is True: rec['tools_ok']+=1
                elif e.get('success') is False: rec['tools_fail']+=1
            elif t=='run:malformed': rec['malformed']=str(e.get('reason'))[:40]
            elif t=='response:repaired': rec['repaired']=e.get('repair')
        flow.append(rec)
    return flow

def analyze(events):
    flow=build_flow(events)
    iters=len(flow)
    actions=Counter(r['action'] for r in flow if r['action'])
    tools=Counter(t for r in flow for t in r['tools_started'])
    shapes=Counter(r['graph_shape'] for r in flow if r['graph_shape'])
    who=Counter(); who_fail=Counter()
    for e in events:
        if e['type']=='tool:start': who[e.get('agent')]+=1
        if e['type']=='tool:end' and e.get('success') is False: who_fail[e.get('agent')]+=1
    phases=Counter(PHASE_OF.get(t,'other') for r in flow for t in r['tools_started'])
    chg=phases['change']; ver=phases['verify']
    mal=sum(1 for e in events if e['type']=='run:malformed')
    return {
      'iterations':iters,'actions':dict(actions),'shapes':dict(shapes),
      'tools':dict(tools),'phases':dict(phases),
      'verify_change_ratio': round(ver/max(1,chg),2),
      'main_tool_starts':who.get('main_agent',0),
      'sub_tool_starts':sum(v for k,v in who.items() if k!='main_agent'),
      'malformed_pct': round(100*mal/max(1,iters),1),
      'work_distribution':dict(who),
    }

def report(path):
    d=json.load(open(path)); ev=d['events']
    r=analyze(ev)
    print(f"=== PROCESS ANALYSIS: {os.path.basename(path)} ===")
    print(f"iterations={r['iterations']}  actions={r['actions']}")
    print(f"graph shapes={r['shapes']}")
    print(f"phases (work type): {r['phases']}")
    print(f"verify/change ratio={r['verify_change_ratio']}")
    print(f"main vs sub tool-starts: main={r['main_tool_starts']} sub={r['sub_tool_starts']}")
    print(f"malformed iterations: {r['malformed_pct']}%")
    print("tools:", r['tools'])

if __name__=='__main__':
    report(sys.argv[1])

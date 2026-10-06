#!/usr/bin/env python3
import csv, re, pathlib
root=pathlib.Path(__file__).resolve().parents[2]
pattern=re.compile(r"TODO|FIXME|OUT_OF_SCOPE|@todo|@fixme|HACK|BUG|ERROR")
rows=[('file','path','line','tag','context')]
for p in root.rglob('*'):
    if p.is_file():
        try:
            text=p.read_text(encoding='utf-8', errors='ignore')
        except Exception:
            continue
        for i,l in enumerate(text.splitlines(),1):
            m=pattern.search(l)
            if m:
                rows.append((p.name,str(p.relative_to(root)),str(i),m.group(0),l.strip()))
out=pathlib.Path(root)/'audit'/'todo-triage.csv'
with out.open('w',newline='',encoding='utf-8') as f:
    writer=csv.writer(f)
    writer.writerows(rows)
print('wrote',len(rows)-1,'todo/fixme rows to',out)

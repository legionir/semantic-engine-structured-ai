#!/usr/bin/env python3
import sys
from pathlib import Path

def counts(path: str):
    p = Path(path)
    lines = p.read_text(encoding='utf-8').splitlines()
    if not lines:
        print('total 0')
        return
    header = lines[0].split('\t')
    try:
        idx = header.index('status')
    except ValueError:
        print('total', len(lines)-1)
        return
    counts = {}
    for line in lines[1:]:
        if not line.strip():
            continue
        parts = line.split('\t')
        status = parts[idx] if idx < len(parts) else ''
        counts[status] = counts.get(status, 0) + 1
    print('total', sum(counts.values()))
    for k, v in counts.items():
        print(k, v)

if __name__ == '__main__':
    if len(sys.argv) < 2:
        print('usage: counts.py <manifest.tsv>')
        sys.exit(1)
    counts(sys.argv[1])

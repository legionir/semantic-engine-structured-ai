from pathlib import Path

root = Path('.')
raw_dir = root / 'audit' / 'searches' / 'raw'
manifest = root / 'audit' / 'manifest'
manifest.mkdir(parents=True, exist_ok=True)

symbols_out = manifest / 'symbols.tsv'
entrypoints_out = manifest / 'entrypoints.tsv'

# Read raw files
raw_files = list(raw_dir.glob('*.tsv'))
entries = []
for rf in sorted(raw_files):
    name = rf.stem
    with rf.open('r', encoding='utf-8') as f:
        for line in f:
            line = line.strip()
            if not line:
                continue
            parts = line.split('\t')
            if len(parts) == 2:
                pat, path = parts
            else:
                pat = parts[0]
                path = parts[-1]
            entries.append((name, pat, path))

# Build symbol rows grouped by kind
from collections import defaultdict
by_kind = defaultdict(list)
for kind, pat, path in entries:
    by_kind[kind].append((path, pat))

# Helper to write TSV with deterministic IDs
def write_symbols(by_kind):
    header = 'id\tkind\tname\tdefined_at\tproducers\tconsumers\tstatus\tnotes\n'
    rows = []
    idx = 1
    for kind in sorted(by_kind.keys()):
        items = sorted(set(by_kind[kind]))
        for path, pat in items:
            name = Path(path).name
            id = f"SYM-{idx:05d}"
            defined_at = path
            producers = ''
            consumers = ''
            status = 'TODO'
            notes = pat
            rows.append((id, kind, name, defined_at, producers, consumers, status, notes))
            idx += 1
    with symbols_out.open('w', encoding='utf-8') as f:
        f.write(header)
        for r in rows:
            f.write('\t'.join(r) + '\n')
    print('wrote', len(rows), 'symbols to', symbols_out)
    return rows

# Entry points: use http_routes + websocket_graphql + cli as entrypoint candidates
def write_entrypoints(entries_by_kind):
    header = 'id\tcategory\tsource\tline\ttrigger\thandler\tworkflow\tstatus\n'
    rows = []
    idx = 1
    candidates = []
    for cat in ('http_routes','websocket_graphql','cli'):
        for path, pat in sorted(set(entries_by_kind.get(cat, []))):
            candidates.append((cat, path, pat))
    for cat, path, pat in candidates:
        id = f"EP-{idx:05d}"
        source = path
        line = ''
        trigger = cat
        handler = ''
        workflow = ''
        status = 'TODO'
        rows.append((id, cat, source, line, trigger, handler, workflow, status))
        idx += 1
    with entrypoints_out.open('w', encoding='utf-8') as f:
        f.write(header)
        for r in rows:
            f.write('\t'.join(r) + '\n')
    print('wrote', len(rows), 'entrypoints to', entrypoints_out)
    return rows

symbols = write_symbols(by_kind)
entrypoints = write_entrypoints(by_kind)

# Append a short summary to searches.log
log = root / 'audit' / 'searches' / 'searches.log'
with log.open('a', encoding='utf-8') as f:
    f.write(f"INGEST: symbols={len(symbols)} entrypoints={len(entrypoints)}\n")
print('ingest complete')

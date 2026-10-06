from pathlib import Path

root = Path('.')
entrypoints = root / 'audit' / 'manifest' / 'entrypoints.tsv'
symbols = root / 'audit' / 'manifest' / 'symbols.tsv'

exclude_patterns = ['node_modules', '\\node_modules\\', '/node_modules/', '\\dist\\', '/dist/', '.d.ts', '.d.mts', '.d.cts', '.map']
include_patterns = ['/src/', '\\src\\', '/bin/', '\\bin\\', '/web/', '\\web\\', 'test-fixture', '/agent/', '\\agent\\']

def classify_path(p):
    lp = p.lower()
    for ex in exclude_patterns:
        if ex in lp:
            # exception: if includes src under excluded, keep
            for inc in include_patterns:
                if inc in lp:
                    return 'KEEP'
            return 'OUT_OF_SCOPE'
    # prefer include patterns
    for inc in include_patterns:
        if inc in lp:
            return 'KEEP'
    # default: mark as REVIEW (keep but lower priority)
    return 'REVIEW'

# Process entrypoints
lines = entrypoints.read_text(encoding='utf-8').splitlines()
header = lines[0]
rows = [l.split('\t') for l in lines[1:] if l.strip()]
new_rows = []
outs = 0
keeps = 0
reviews = 0
for r in rows:
    src = r[2]
    cls = classify_path(src)
    if cls == 'OUT_OF_SCOPE':
        r[-1] = 'OUT_OF_SCOPE(node_module_or_generated)'
        outs += 1
    elif cls == 'KEEP':
        r[-1] = 'TODO'
        keeps += 1
    else:
        # REVIEW keep as TODO but note
        r[-1] = 'TODO(review)'
        reviews += 1
    new_rows.append(r)

# write back
with entrypoints.open('w', encoding='utf-8') as f:
    f.write(header + '\n')
    for r in new_rows:
        f.write('\t'.join(r) + '\n')
print('entrypoints processed:', len(new_rows), 'keeps', keeps, 'outs', outs, 'reviews', reviews)

# Process symbols similarly but only mark node_modules/dist as OUT_OF_SCOPE
sym_lines = symbols.read_text(encoding='utf-8').splitlines()
header = sym_lines[0]
srows = [l.split('\t') for l in sym_lines[1:] if l.strip()]
new_srows = []
outs = 0
keeps = 0
for r in srows:
    defined_at = r[3]
    cls = classify_path(defined_at)
    if cls == 'OUT_OF_SCOPE':
        r[6] = 'OUT_OF_SCOPE(node_module_or_generated)'
        outs += 1
    else:
        r[6] = 'TODO'
        keeps += 1
    new_srows.append(r)
with symbols.open('w', encoding='utf-8') as f:
    f.write(header + '\n')
    for r in new_srows:
        f.write('\t'.join(r) + '\n')
print('symbols processed:', len(new_srows), 'keeps', keeps, 'outs', outs)

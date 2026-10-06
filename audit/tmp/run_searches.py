import re
import sys
from pathlib import Path
from datetime import datetime
from audit.tmp.search_patterns import patterns

root = Path('.')
search_root_dirs = ['semantic-engine', 'structured-ai']

out_dir = Path('audit/searches')
log_file = out_dir / 'searches.log'
raw_dir = out_dir / 'raw'
raw_dir.mkdir(parents=True, exist_ok=True)

# helpers
def log(command, hits, note=''):
    t = datetime.utcnow().isoformat() + 'Z'
    line = f"{t} | {command} | hits={hits} | {note}\n"
    with open(log_file, 'a', encoding='utf-8') as f:
        f.write(line)

# run patterns
for name, pats in patterns.items():
    all_matches = []
    command_desc = f"python_search:{name}"
    for base in search_root_dirs:
        basep = Path(base)
        if not basep.exists():
            continue
        for p in basep.rglob('*.ts'):
            try:
                text = p.read_text(encoding='utf-8')
            except Exception:
                continue
            for pat in pats:
                if re.search(pat, text):
                    all_matches.append((str(p), pat))
        for p in basep.rglob('*.js'):
            try:
                text = p.read_text(encoding='utf-8')
            except Exception:
                continue
            for pat in pats:
                if re.search(pat, text):
                    all_matches.append((str(p), pat))
    # dedupe
    unique = sorted(set(all_matches))
    hits = len(unique)
    # write raw
    raw_file = raw_dir / f"{name}.tsv"
    with open(raw_file, 'w', encoding='utf-8') as f:
        for path, pat in unique:
            f.write(f"{pat}\t{path}\n")
    log(command_desc, hits)
    print(f"{name}: {hits} hits -> {raw_file}")

print('searches complete')

from pathlib import Path

root = Path('.').resolve()
exclude_dirs = {'.git', 'node_modules', 'dist', 'build', '.next', 'coverage', '.cache', '.turbo', '.vercel'}

dirs = set()
for path in sorted(root.rglob('*')):
    if not path.is_dir():
        continue
    rel = path.relative_to(root).as_posix()
    if rel == '.':
        continue
    if any(part in exclude_dirs for part in path.relative_to(root).parts):
        continue
    # Only include directories that contain at least one relevant file
    has_relevant = any(
        p.is_file() and '.git' not in p.parts and 'node_modules' not in p.parts and 'dist' not in p.parts
        for p in path.rglob('*')
    )
    if has_relevant:
        dirs.add(rel)

header = 'id\tpath\tpurpose\tstatus\tnotes\n'
with open('audit/manifest/dirs.tsv', 'w', encoding='utf-8') as f:
    f.write(header)
    for idx, d in enumerate(sorted(dirs), 1):
        purpose = ''
        notes = ''
        f.write(f"DIR-{idx:04d}\t{d}\t{purpose}\tTODO\t{notes}\n")

print('wrote', len(dirs), 'dirs to audit/manifest/dirs.tsv')

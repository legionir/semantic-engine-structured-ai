from pathlib import Path

root = Path('.')
exclude_dirs = {'.git', 'node_modules', 'dist', 'build', '.next', 'coverage', '.cache'}
exclude_files = {'.DS_Store', 'Thumbs.db'}

files = []
for path in sorted(root.rglob('*')):
    if not path.is_file():
        continue
    rel = path.relative_to(root).as_posix()
    if any(part in exclude_dirs for part in path.relative_to(root).parts):
        continue
    if path.name in exclude_files:
        continue
    try:
        lines = sum(1 for _ in path.open('r', encoding='utf-8', errors='ignore'))
    except Exception:
        lines = 0
    files.append((rel, lines))

print('count=' + str(len(files)))
for rel, lines in files[:20]:
    print(f'{rel}\t{lines}')
print('...')
for rel, lines in files[-10:]:
    print(f'{rel}\t{lines}')

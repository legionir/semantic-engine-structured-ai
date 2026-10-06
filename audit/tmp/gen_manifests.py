from pathlib import Path
import os

root = Path('.').resolve()
exclude_dirs = {'.git', 'node_modules', 'dist', 'build', '.next', 'coverage', '.cache', '.turbo', '.vercel'}
exclude_files = {'.DS_Store', 'Thumbs.db'}

# Tier rules: keywords in path or extension
tier_rules = [
    ('test', 'T3'),
    ('tests', 'T3'),
    ('__tests__', 'T3'),
    ('spec', 'T3'),
    ('docs', 'T3'),
    ('public', 'T3'),
    ('README', 'T3'),
    ('CHANGELOG', 'T3'),
    ('LICENSE', 'T3'),
    ('.d.ts', 'T3'),
    ('.json', 'T4'),
    ('.lock', 'T4'),
    ('.wasm', 'T4'),
    ('.png', 'T4'),
    ('.jpg', 'T4'),
    ('.svg', 'T4'),
    ('.ico', 'T4'),
    ('.woff', 'T4'),
    ('.woff2', 'T4'),
    ('.ttf', 'T4'),
    ('.eot', 'T4'),
    ('.map', 'T4'),
    ('tree-sitter-grammars', 'T4'),
    ('node_modules', 'T4'),
]

def guess_tier(rel, name):
    lower = rel.lower()
    for keyword, tier in tier_rules:
        if keyword.lower() in lower or name.lower().endswith(keyword.lower()):
            return tier
    return 'T2'

def guess_type_lang(rel, name):
    ext = Path(name).suffix.lower()
    lang_map = {
        '.ts': 'ts', '.tsx': 'ts', '.js': 'js', '.jsx': 'js', '.mjs': 'js', '.cjs': 'js',
        '.py': 'py', '.rb': 'rb', '.go': 'go', '.rs': 'rs', '.java': 'java', '.kt': 'kt',
        '.c': 'c', '.cpp': 'cpp', '.h': 'c', '.hpp': 'cpp', '.cs': 'cs', '.php': 'php',
        '.swift': 'swift', '.sql': 'sql', '.json': 'json', '.yaml': 'yaml', '.yml': 'yaml',
        '.md': 'md', '.txt': 'txt', '.sh': 'sh', '.bash': 'sh', '.ps1': 'ps1', '.bat': 'bat',
        '.dockerfile': 'dockerfile', '.proto': 'proto', '.graphql': 'graphql', '.gql': 'graphql',
        '.wasm': 'wasm', '.svg': 'svg', '.png': 'png', '.jpg': 'jpg', '.ico': 'ico',
        '.ttf': 'font', '.woff': 'font', '.woff2': 'font', '.eot': 'font',
        '.map': 'map', '.lock': 'lock', '.tsv': 'tsv', '.csv': 'csv',
    }
    lang = lang_map.get(ext, ext.replace('.', '') or 'unknown')
    if name == 'Dockerfile':
        return 'dockerfile', 'dockerfile'
    if name.lower() in {'makefile', 'rakefile', 'gemfile'}:
        return name.lower(), name.lower()
    if ext == '.dockerfile':
        return 'dockerfile', 'dockerfile'
    if ext in {'.ts', '.tsx'}:
        ftype = 'source'
    elif ext in {'.js', '.jsx', '.mjs', '.cjs'}:
        ftype = 'source'
    elif ext in {'.py', '.rb', '.go', '.rs', '.java', '.kt', '.c', '.cpp', '.h', '.hpp', '.cs', '.php', '.swift', '.sql', '.sh', '.bash', '.ps1', '.bat', '.proto', '.graphql'}:
        ftype = 'source'
    elif ext in {'.json', '.yaml', '.yml', '.toml', '.xml', '.ini', '.cfg', '.conf'}:
        ftype = 'config'
    elif ext in {'.md', '.txt', '.rst'}:
        ftype = 'doc'
    elif ext in {'.lock', '.map', '.wasm', '.png', '.jpg', '.svg', '.ico', '.ttf', '.woff', '.woff2', '.eot'}:
        ftype = 'generated'
    else:
        ftype = 'other'
    return ftype, lang

def guess_module(rel):
    parts = Path(rel).parts
    if len(parts) == 0:
        return 'root'
    # Use first two meaningful parts
    if parts[0] in {'semantic-engine', 'structured-ai', 'test-projects', 'tools', 'docs', 'audit'}:
        if len(parts) >= 2:
            return f"{parts[0]}/{parts[1]}"
        return parts[0]
    return parts[0]

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
    ftype, lang = guess_type_lang(rel, path.name)
    module = guess_module(rel)
    tier = guess_tier(rel, path.name)
    files.append((rel, lines, ftype, lang, module, tier))

# Write manifest
header = 'id\tpath\tlines\ttype\tlang\tmodule\ttier\tgenerated\ttest\trole\tdepth_required\tdepth_done\tranges_read\tstatus\tworkflows\tnotes\n'
with open('audit/manifest/files.tsv', 'w', encoding='utf-8') as f:
    f.write(header)
    for idx, (rel, lines, ftype, lang, module, tier) in enumerate(files, 1):
        generated = 'yes' if tier == 'T4' else 'no'
        test = 'yes' if '/test' in rel or '/tests' in rel or rel.startswith('test-') else 'no'
        role = ''
        depth_required = {
            'T1': 'L2+L3',
            'T2': 'L2',
            'T3': 'L1',
            'T4': 'L0',
        }.get(tier, 'L1')
        depth_done = ''
        ranges_read = ''
        status = 'TODO'
        workflows = ''
        notes = ''
        f.write(f"FILE-{idx:05d}\t{rel}\t{lines}\t{ftype}\t{lang}\t{module}\t{tier}\t{generated}\t{test}\t{role}\t{depth_required}\t{depth_done}\t{ranges_read}\t{status}\t{workflows}\t{notes}\n")

print('wrote', len(files), 'files to audit/manifest/files.tsv')

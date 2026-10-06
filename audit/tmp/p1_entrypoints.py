from pathlib import Path
import re
import datetime

root = Path('.').resolve()
entrypoints_path = root / 'audit' / 'manifest' / 'entrypoints.tsv'
log_path = root / 'audit' / 'searches.log'

patterns = {
    'http_route': [
        r"\.(get|post|put|patch|delete|all|use)\([^)]*req(?:uest)?[,)]",
        r"@(Controller|Get|Post|Put|Patch|Delete|MessagePattern|EventPattern|OnEvent|Cron|Process|Processor|SubscribeMessage)\b",
    ],
    'cli_command': [
        r"registerCommand|registerTextEditorCommand|yargs|commander|process\.argv|\.command\(|\.option\(|\.argument\(",
        r"bin/.*\.(ts|js|mjs|cjs|py|rb|go|rs|java|kt|c|cpp|h|hpp|cs|php|swift)",
    ],
    'event_handler': [
        r"@(EventPattern|MessagePattern|SubscribeMessage|KafkaListener|RabbitListener|JmsListener|EventListener)\b",
        r"\.on\(|addEventListener|socket\.on\(",
    ],
    'startup_bootstrap': [
        r"onModuleInit|OnApplicationBootstrap|@PostConstruct|lifespan|startup|beforeExit|SIGTERM|createServer|app\.listen|listen\(|main\(",
    ],
    'scheduled_job': [
        r"@Cron|@Scheduled|setInterval|cron\(|schedule\(",
    ],
    'webhook': [
        r"webhook|signature|hmac",
    ],
    'vscode_extension': [
        r"activate\(|deactivate\(|ExtensionContext|registerWebviewViewProvider|createWebviewPanel",
    ],
}

source_exts = {'.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs', '.json', '.yaml', '.yml', '.py', '.rb', '.go', '.rs', '.java', '.kt', '.c', '.cpp', '.h', '.hpp', '.cs', '.php', '.swift', '.sql', '.proto', '.graphql', '.gql', '.sh', '.bash', '.ps1', '.bat', '.md', '.toml', '.xml', '.ini', '.cfg', '.conf'}
max_file_bytes = 200 * 1024
scan_roots = [
    root / 'semantic-engine' / 'src',
    root / 'semantic-engine' / 'test',
    root / 'structured-ai' / 'src',
    root / 'structured-ai' / 'agent',
    root / 'structured-ai' / 'web',
    root / 'structured-ai' / 'bin',
]

entries = []

def scan():
    count = 0
    for scan_root in scan_roots:
        if not scan_root.exists():
            continue
        for path in sorted(scan_root.rglob('*')):
            if not path.is_file():
                continue
            if path.suffix.lower() not in source_exts:
                continue
            try:
                if path.stat().st_size > max_file_bytes:
                    continue
                text = path.read_text(encoding='utf-8', errors='ignore')
            except Exception:
                continue
            count += 1
            rel = path.relative_to(root).as_posix()
            for category, pats in patterns.items():
                for pat in pats:
                    for m in re.finditer(pat, text, re.IGNORECASE):
                        line_no = text[:m.start()].count('\n') + 1
                        line = text.splitlines()[line_no - 1].rstrip()
                        entries.append((category, rel, line_no, line, pat))
                        break
    print(f"scanned {count} files, found {len(entries)} entrypoint candidates")

scan()

# Deduplicate by (category, rel, line_no)
seen = set()
unique = []
for item in entries:
    key = (item[0], item[1], item[2])
    if key not in seen:
        seen.add(key)
        unique.append(item)

with entrypoints_path.open('w', encoding='utf-8') as f:
    f.write('id\tcategory\tsource\tline\ttrigger\thandler\tworkflow\tnotes\n')
    for idx, (category, rel, line_no, line, pat) in enumerate(unique, 1):
        trigger = line.strip()
        handler = ''
        if category == 'http_route':
            m = re.search(r"\.(get|post|put|patch|delete|all|use)\(['\"`]([^'\"`]+)['\"`]", line)
            if m:
                trigger = f"{m.group(1).upper()} {m.group(2)}"
                handler = rel
        elif category == 'cli_command':
            handler = rel
        elif category == 'event_handler':
            handler = rel
        elif category == 'startup_bootstrap':
            handler = rel
        elif category == 'scheduled_job':
            handler = rel
        elif category == 'webhook':
            handler = rel
        elif category == 'vscode_extension':
            handler = rel
        f.write(f"EP-{idx:05d}\t{category}\t{rel}:{line_no}\t{line_no}\t{trigger}\t{handler}\t\tTODO\n")

with log_path.open('a', encoding='utf-8') as log:
    log.write(f"\n## P1 entrypoint discovery {datetime.datetime.now().isoformat()}\n")
    log.write(f"total entrypoints={len(unique)}\n")
    by_cat = {}
    for item in unique:
        by_cat.setdefault(item[0], []).append(item)
    for category, items in by_cat.items():
        log.write(f"- {category}: {len(items)}\n")

print('wrote', len(unique), 'entrypoints to', entrypoints_path)

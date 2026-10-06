from pathlib import Path
import re
import datetime

root = Path('.').resolve()
log_path = root / 'audit' / 'searches.log'
projects = [root / 'semantic-engine', root / 'structured-ai']

patterns = {
    'http_routes': [
        r"@(Controller|Get|Post|Put|Patch|Delete|MessagePattern|EventPattern|OnEvent|Cron|Process|Processor|SubscribeMessage)\b",
        r"\.(get|post|put|patch|delete|all|use)\([^)]*req(?:uest)?[,)]",
    ],
    'python_routes': [
        r"@(app|router|bp)\.(route|get|post|put|patch|delete)\(",
        r"urlpatterns\s*=|path\(|re_path\(",
        r"@(shared_task|celery\.task|receiver)\(",
    ],
    'java_routes': [
        r"@(RestController|Controller|RequestMapping|GetMapping|PostMapping|KafkaListener|RabbitListener|JmsListener|Scheduled|EventListener|Transactional)",
    ],
    'go_routes': [
        r"http\.HandleFunc|\.Handle\(|\.(GET|POST|PUT|DELETE|PATCH)\(",
    ],
    'websocket_graphql': [
        r"WebSocket|socket\.on\(|@WebSocketGateway",
        r"Subscription|@Resolver|\.proto\b",
    ],
    'webhooks_cron_startup': [
        r"webhook|signature|hmac",
        r"cron|schedule|setInterval|@Scheduled",
        r"onModuleInit|OnApplicationBootstrap|@PostConstruct|lifespan|startup|beforeExit|SIGTERM",
    ],
    'config_env_flags': [
        r"process\.env\.|os\.environ|getenv|System\.getenv|@Value\(|Environment\.GetEnvironmentVariable",
        r"feature[_-]?flag|isEnabled\(|FEATURE_|flags\.",
    ],
    'db_migrations': [
        r"CREATE TABLE|ALTER TABLE|createTable|addColumn|dropColumn",
        r"\.(query|execute|raw)\(|\.transaction\(|BEGIN|COMMIT|ROLLBACK|FOR UPDATE",
    ],
    'concurrency_idempotency': [
        r"mutex|lock\(|synchronized|atomic|semaphore|idempot|dedup|retry|backoff|version\s*[:=]",
    ],
    'incomplete_markers': [
        r"TODO|FIXME|HACK|XXX|@deprecated|NotImplemented|unimplemented|pass\s*$",
    ],
    'state_fields': [
        r"\b(status|state|phase|stage)\b\s*(=|:|==)",
    ],
    'vscode_extension': [
        r"registerCommand|registerTextEditorCommand|createWebviewPanel|registerWebviewViewProvider|postMessage|onDidReceiveMessage|getConfiguration|registerCodeActionsProvider|registerCompletionItemProvider|setContext",
    ],
    'emit_publish_subscribe': [
        r"\b(emit|publish|subscribe|dispatch|enqueue|consume|addListener|on)\(",
    ],
    'queue_topic_channel': [
        r"(topic|queue|channel|exchange|routingKey|event)[A-Za-z_]*\s*[:=]",
    ],
}

source_exts = {'.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs', '.json', '.yaml', '.yml', '.py', '.rb', '.go', '.rs', '.java', '.kt', '.c', '.cpp', '.h', '.hpp', '.cs', '.php', '.swift', '.sql', '.proto', '.graphql', '.gql', '.sh', '.bash', '.ps1', '.bat', '.md', '.toml', '.xml', '.ini', '.cfg', '.conf'}
max_file_bytes = 100 * 1024
scan_roots = {
    'semantic-engine': [root / 'semantic-engine' / 'src', root / 'semantic-engine' / 'test'],
    'structured-ai': [root / 'structured-ai' / 'src', root / 'structured-ai' / 'agent', root / 'structured-ai' / 'web', root / 'structured-ai' / 'bin'],
}

entries = []

def scan_project(project_name: str, roots):
    hits = []
    count = 0
    for scan_root in roots:
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
            for label, pats in patterns.items():
                for pat in pats:
                    for m in re.finditer(pat, text, re.IGNORECASE):
                        line_no = text[:m.start()].count('\n') + 1
                        line = text.splitlines()[line_no - 1].rstrip()
                        hits.append((label, project_name, rel, line_no, line))
                        break  # one hit per pattern per file
    print(f"scanned {project_name}: {count} files, {len(hits)} hits")
    return hits

with log_path.open('a', encoding='utf-8') as log:
    log.write(f"\n## P1 discovery run {datetime.datetime.now().isoformat()}\n")
    for project in projects:
        name = project.name
        roots = scan_roots.get(name, [project])
        log.write(f"\n### Project: {name}\n")
        hits = scan_project(name, roots)
        log.write(f"total hits={len(hits)}\n")
        by_label = {}
        for item in hits:
            by_label.setdefault(item[0], []).append(item)
        for label, items in by_label.items():
            log.write(f"- {label}: {len(items)} hits\n")
            for kind, proj, rel, line_no, line in items[:20]:
                entries.append((kind, proj, rel, line_no, line))
            if len(items) > 20:
                log.write(f"  - truncated to first 20 hits\n")

# Append to symbols.tsv
symbols_path = root / 'audit' / 'manifest' / 'symbols.tsv'
existing = symbols_path.read_text(encoding='utf-8')
start_idx = 1
if existing.strip():
    try:
        start_idx = int(re.findall(r"SYM-(\d+)", existing)[-1]) + 1
    except Exception:
        start_idx = 1
with symbols_path.open('a', encoding='utf-8') as f:
    for i, (kind, project, rel, line_no, line) in enumerate(entries, start_idx):
        f.write(f"SYM-{i:05d}\t{kind}\t{line.strip()}\t{rel}:{line_no}\t\t\tTODO\t\n")

print('logged', len(entries), 'symbol hits to audit/manifest/symbols.tsv')

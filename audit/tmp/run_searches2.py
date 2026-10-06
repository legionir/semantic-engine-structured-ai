import re
from pathlib import Path
from datetime import datetime

root = Path('.')
search_root_dirs = ['semantic-engine', 'structured-ai']
out_dir = Path('audit/searches')
log_file = out_dir / 'searches.log'
raw_dir = out_dir / 'raw'
raw_dir.mkdir(parents=True, exist_ok=True)

patterns = {
    'http_routes': [
        r"\b(app|router|server)\.(get|post|put|patch|delete|all|use)\(",
        r"@Controller\b|@Get\b|@Post\b|@Put\b|@Delete\b|@Patch\b",
    ],
    'decorators': [
        r"@MessagePattern\b|@EventPattern\b|@OnEvent\b|@Cron\b|@Processor\b|@SubscribeMessage\b",
    ],
    'websocket_graphql': [
        r"WebSocket|socket\.on\(|Subscription|@WebSocketGateway|@Resolver",
    ],
    'events_queues': [
        r"\b(emit|publish|dispatch|enqueue|send|publishEvent)\b|\b(queue|topic|exchange)\b",
    ],
    'db_transactions': [
        r"\.transaction\(|\bBEGIN\b|\bCOMMIT\b|\bROLLBACK\b|\bFOR UPDATE\b|\bfor update\b|\.query\(|\.execute\(|\btransaction\b",
    ],
    'config_env': [
        r"process\.env\.|getenv\(|Environment\.GetEnvironmentVariable|SEMANTIC|AGENT_|MCP_",
    ],
    'state_fields': [
        r"\b(status|state|phase|stage)\b\s*(=|:|==)",
    ],
    'tests': [
        r"\bdescribe\(|\bit\(|\btest\(|\bjest\b|\bmocha\b|\bvitest\b",
    ],
    'cli': [
        r"commander|yargs|argparse|program\.command\(|program\.option\(|bin/",
    ],
}

# helper to log
def log(command, hits, note=''):
    t = datetime.utcnow().isoformat() + 'Z'
    line = f"{t} | {command} | hits={hits} | {note}\n"
    with open(log_file, 'a', encoding='utf-8') as f:
        f.write(line)

print('starting searches')
for name, pats in patterns.items():
    matches = []
    for base in search_root_dirs:
        basep = Path(base)
        if not basep.exists():
            continue
        for ext in ('.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs', '.py', '.java', '.go'):
            for p in basep.rglob(f'*{ext}'):
                try:
                    text = p.read_text(encoding='utf-8')
                except Exception:
                    continue
                for pat in pats:
                    if re.search(pat, text):
                        matches.append((str(p), pat))
    unique = sorted(set(matches))
    hits = len(unique)
    raw_file = raw_dir / f"{name}.tsv"
    with open(raw_file, 'w', encoding='utf-8') as f:
        for path, pat in unique:
            f.write(f"{pat}\t{path}\n")
    log(f"python_search:{name}", hits)
    print(f"{name}: {hits} hits -> {raw_file}")
print('searches done')

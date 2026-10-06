# Patterns for entrypoints and symbols tailored to TypeScript/Node and Node-based projects
patterns = {
    'http_routes': [
        r"\.\b(app|router|server)\.(get|post|put|patch|delete|all|use)\(",
        r"@Controller\(|@Get\(|@Post\(|@Put\(|@Delete\(|@Patch\(",
    ],
    'decorators': [
        r"@MessagePattern\(|@EventPattern\(|@OnEvent\(|@Cron\(|@Processor\(|@SubscribeMessage\(",
    ],
    'websocket_graphql': [
        r"WebSocket|socket\.on\(|Subscription|@WebSocketGateway|@Resolver",
    ],
    'events_queues': [
        r"\b(emit|publish|dispatch|enqueue|enqueue\(|send|publishEvent)\(|\b(queue|topic|exchange)\b",
    ],
    'db_transactions': [
        r"\.transaction\(|BEGIN|COMMIT|ROLLBACK|for update|FOR UPDATE|execute\(|query\(|\.query\(",
    ],
    'config_env': [
        r"process\.env\.|getenv\(|Environment\.GetEnvironmentVariable|SEMANTIC|AGENT_|MCP_",
    ],
    'state_fields': [
        r"\b(status|state|phase|stage)\b\s*(=|:|==)",
    ],
    'tests': [
        r"\bdescribe\(|\bit\(|test\(|jest\.|mocha\.|ava\.|vitest\.",
    ],
    'cli': [
        r"commander|yargs|argparse|subcommand|program\.command\(|program\.option\(|bin/",
    ],
}

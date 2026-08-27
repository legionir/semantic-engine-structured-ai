/**
 * `semantic-engine worker` — فاز ۷, measured with a real process.
 *
 * The acceptance criteria that only a real process can prove:
 *
 *   - it starts on its own, with no Gateway;
 *   - `/internal/ready` is 503 until an index is loaded, then 200;
 *   - `POST /internal/shutdown` answers and the process exits 0;
 *   - the internal surface needs the token.
 */

import { ChildProcess, spawn } from 'child_process';
import * as fs from 'fs';
import * as http from 'http';
import * as os from 'os';
import * as path from 'path';

const PACKAGE_ROOT = path.join(__dirname, '..', '..', '..');
const BIN = path.join(PACKAGE_ROOT, 'bin', 'semantic-engine.js');
const built = fs.existsSync(path.join(PACKAGE_ROOT, 'dist', 'cli', 'main.js'));
const describeIfBuilt = built ? describe : describe.skip;

const TOKEN = 'worker-test-token';

interface Reply {
  status: number;
  json: Record<string, unknown>;
}

function call(
  socketPath: string,
  method: string,
  urlPath: string,
  headers: Record<string, string> = {}
): Promise<Reply> {
  return new Promise((resolve, reject) => {
    const req = http.request({ socketPath, path: urlPath, method, headers }, res => {
      const chunks: Buffer[] = [];
      res.on('data', chunk => chunks.push(chunk as Buffer));
      res.on('end', () => {
        const text = Buffer.concat(chunks).toString('utf8');
        let json: Record<string, unknown> = {};
        try {
          json = text === '' ? {} : (JSON.parse(text) as Record<string, unknown>);
        } catch {
          json = { raw: text };
        }
        resolve({ status: res.statusCode ?? 0, json });
      });
    });
    req.on('error', reject);
    req.end();
  });
}

async function waitForSocket(socketPath: string, timeoutMs = 60_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  let lastError: unknown = null;

  while (Date.now() < deadline) {
    if (fs.existsSync(socketPath)) {
      try {
        await call(socketPath, 'GET', '/internal/health', { Authorization: `Bearer ${TOKEN}` });
        return;
      } catch (error) {
        lastError = error;
      }
    }
    await new Promise(resolve => setTimeout(resolve, 200));
  }

  throw new Error(`worker did not come up on ${socketPath}: ${String(lastError)}`);
}

function exitOf(child: ChildProcess, timeoutMs = 30_000): Promise<number | null> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('worker did not exit')), timeoutMs);
    child.once('exit', code => {
      clearTimeout(timer);
      resolve(code);
    });
  });
}

describeIfBuilt('semantic-engine worker', () => {
  let base: string;
  let workspace: string;
  let dataDir: string;
  let socketPath: string;
  let child: ChildProcess | null = null;

  beforeEach(() => {
    base = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'se-worker-')));
    workspace = path.join(base, 'app');
    dataDir = path.join(base, 'data');
    socketPath = path.join(base, 'run', 'worker.sock');
    fs.mkdirSync(path.join(workspace, 'src'), { recursive: true });
    fs.writeFileSync(path.join(workspace, 'src', 'a.ts'), 'export function a(): number { return 1; }\n');
  });

  afterEach(async () => {
    if (child && child.exitCode === null) child.kill('SIGKILL');
    child = null;
    fs.rmSync(base, { recursive: true, force: true });
  });

  const startWorker = (extra: string[] = []): ChildProcess => {
    const spawned = spawn(
      process.execPath,
      [
        BIN,
        'worker',
        '--root',
        workspace,
        '--data-dir',
        dataDir,
        '--project-id',
        'prj-worker-00000000',
        '--socket',
        socketPath,
        '--token',
        TOKEN,
        '--no-watch',
        ...extra,
      ],
      { cwd: PACKAGE_ROOT, stdio: ['ignore', 'pipe', 'pipe'] }
    );
    child = spawned;
    return spawned;
  };

  it('serves one project over a Unix socket and shuts down cleanly', async () => {
    const spawned = startWorker();
    await waitForSocket(socketPath);

    const auth = { Authorization: `Bearer ${TOKEN}` };

    const ready = await call(socketPath, 'GET', '/internal/ready', auth);
    expect(ready.status).toBe(200);
    expect(ready.json['ready']).toBe(true);
    expect(ready.json['projectId']).toBe('prj-worker-00000000');

    const health = await call(socketPath, 'GET', '/internal/health', auth);
    expect(health.status).toBe(200);
    expect(health.json['state']).toBe('ready');
    expect(health.json['indexState']).toBe('fresh');
    expect(health.json['pid']).toBe(spawned.pid);
    expect(typeof health.json['files']).toBe('number');
    expect(typeof health.json['memoryMb']).toBe('number');

    const metrics = await call(socketPath, 'GET', '/internal/metrics', auth);
    expect(metrics.status).toBe(200);
    for (const key of [
      'worker_uptime_seconds',
      'worker_memory_bytes',
      'worker_files_total',
      'worker_symbols_total',
      'worker_index_state',
    ]) {
      expect(metrics.json).toHaveProperty(key);
    }

    /* The internal surface is not open. */
    const anonymous = await call(socketPath, 'GET', '/internal/ready');
    expect(anonymous.status).toBe(401);

    const reloaded = await call(socketPath, 'POST', '/internal/reload', auth);
    expect(reloaded.status).toBe(200);
    expect(reloaded.json['ok']).toBe(true);

    const exiting = exitOf(spawned);
    const shutdown = await call(socketPath, 'POST', '/internal/shutdown', auth);
    expect(shutdown.status).toBe(200);
    expect(shutdown.json['shuttingDown']).toBe(true);

    expect(await exiting).toBe(0);
    /* The socket file does not outlive the worker. */
    expect(fs.existsSync(socketPath)).toBe(false);
  }, 180_000);

  it('is not ready until an index exists', async () => {
    const spawned = startWorker(['--skip-initial-index']);

    /* Wait for the socket itself, not for readiness. */
    const deadline = Date.now() + 60_000;
    while (Date.now() < deadline && !fs.existsSync(socketPath)) {
      await new Promise(resolve => setTimeout(resolve, 200));
    }
    expect(fs.existsSync(socketPath)).toBe(true);

    const auth = { Authorization: `Bearer ${TOKEN}` };
    let ready: Reply | null = null;
    const stableDeadline = Date.now() + 30_000;
    while (Date.now() < stableDeadline) {
      try {
        ready = await call(socketPath, 'GET', '/internal/ready', auth);
        break;
      } catch {
        await new Promise(resolve => setTimeout(resolve, 200));
      }
    }

    expect(ready).not.toBeNull();
    expect(ready!.status).toBe(503);
    expect(ready!.json['ready']).toBe(false);
    expect(ready!.json['indexState']).toBe('missing');
    expect(ready!.json['state']).toBe('starting');

    const exiting = exitOf(spawned);
    await call(socketPath, 'POST', '/internal/shutdown', auth);
    expect(await exiting).toBe(0);
  }, 180_000);

  it('stops cleanly on SIGTERM too', async () => {
    const spawned = startWorker();
    await waitForSocket(socketPath);

    const exiting = exitOf(spawned);
    spawned.kill('SIGTERM');
    expect(await exiting).toBe(0);
  }, 180_000);
});

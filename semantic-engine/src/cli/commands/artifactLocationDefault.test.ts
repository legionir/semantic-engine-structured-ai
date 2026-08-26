/**
 * فاز ۱ must not change what the CLI writes.
 *
 * The data-directory resolver exists now, but `semanticEngine.artifactLocation`
 * still defaults to `in-root`, so `semantic-engine index --root <dir>` has to
 * keep producing `<dir>/.semantic-engine/…` — and must not start writing into
 * a configured data directory before فاز ۴ flips the default on purpose.
 *
 * This drives the real command handler, not a copy of it.
 */

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { parseArgs } from '../args';
import { createLoggerFromEnv } from '../../host/Logger';
import { runIndex } from './index-command';

interface IndexJson {
  readonly ok?: boolean;
  readonly indexPath?: string;
  readonly blueprintPath?: string;
}

describe('index — artifact location is unchanged while `in-root` is the default', () => {
  let base: string;
  let dataRoot: string;
  let savedDataDir: string | undefined;

  beforeEach(() => {
    base = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'se-index-location-')));
    dataRoot = path.join(base, 'data-dir');
    savedDataDir = process.env['SEMANTIC_ENGINE_DATA_DIR'];
    process.env['SEMANTIC_ENGINE_DATA_DIR'] = dataRoot;

    const src = path.join(base, 'app', 'src');
    fs.mkdirSync(src, { recursive: true });
    fs.writeFileSync(path.join(src, 'a.ts'), 'export function hello(): string { return "hi"; }\n');
  });

  afterEach(() => {
    if (savedDataDir === undefined) delete process.env['SEMANTIC_ENGINE_DATA_DIR'];
    else process.env['SEMANTIC_ENGINE_DATA_DIR'] = savedDataDir;
    fs.rmSync(base, { recursive: true, force: true });
  });

  const logger = () => createLoggerFromEnv({ SEMANTIC_ENGINE_LOG_LEVEL: 'error' }, { stdio: true });

  it('writes the index and blueprint inside the workspace root', async () => {
    const root = path.join(base, 'app');
    const result = await runIndex(parseArgs(['index', '--root', root, '--no-git']), {
      cwd: base,
      logger: logger(),
    });

    expect(result.error).toBeUndefined();
    expect(result.code).toBe(0);

    const json = result.json as IndexJson;
    expect(json.ok).toBe(true);
    expect(json.indexPath).toBe(path.join(root, '.semantic-engine', 'project-index.json'));
    expect(fs.existsSync(json.indexPath!)).toBe(true);
    expect(fs.existsSync(path.join(root, '.semantic-engine', 'blueprint.json'))).toBe(true);

    /* Nothing leaks into the data directory before the flip is implemented. */
    expect(fs.existsSync(dataRoot)).toBe(false);
  });

  it('still honours an explicit absolute --out', async () => {
    const root = path.join(base, 'app');
    const out = path.join(base, 'elsewhere');

    const result = await runIndex(parseArgs(['index', '--root', root, '--no-git', '--out', out]), {
      cwd: base,
      logger: logger(),
    });

    expect(result.code).toBe(0);
    const json = result.json as IndexJson;
    expect(json.indexPath).toBe(path.join(out, 'project-index.json'));
    expect(fs.existsSync(json.indexPath!)).toBe(true);
    expect(fs.existsSync(path.join(root, '.semantic-engine'))).toBe(false);
  });
});

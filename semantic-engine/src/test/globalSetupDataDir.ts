/**
 * Jest globalSetup — keep the *real* process environment away from the
 * developer's data directory.
 *
 * Why this is not (only) `setupFiles`: inside a jest sandbox `process.env` is a
 * copy, so a value assigned there never reaches `child_process`. Measured while
 * landing فاز ۴:
 *
 * ```text
 * PROBE in-process=/tmp/se-jest-data-PolunM child=(unset)
 * ```
 *
 * Suites that spawn the real CLI (`cli.test.ts`, `serve-watch.test.ts`)
 * therefore ran `doctor`/`ui`/`watch` against `~/.local/share/semantic-engine`.
 * `globalSetup` runs in the parent process, before workers are forked, so both
 * the workers and their children inherit the temporary directory.
 *
 * `setupFiles` stays as the in-sandbox half of the same guard.
 */

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { execFileSync } from 'child_process';

export default async function globalSetupDataDir(): Promise<void> {
  /*
  | The on-disk test fixture is generated, not committed (scripts/gen-fixture
  | -js). `npm test` makes it via `pretest`, but a direct `jest`/`npx jest`
  | invocation skipped that step and several suites (cli, scanner, export,
  | blueprint) then failed with empty indexes — a broken first impression
  | that looks like product regressions. Generate it here, which every jest
  | entry point runs.
  */
  const fixtureRoot = path.resolve(__dirname, '..', '..', 'test-fixture');
  if (!fs.existsSync(path.join(fixtureRoot, 'src', 'app.ts'))) {
    execFileSync(process.execPath, [
      path.resolve(__dirname, '..', '..', 'scripts', 'gen-fixture.js'),
    ], { stdio: 'inherit' });
  }

  if (process.env['SEMANTIC_ENGINE_DATA_DIR']) return;

  const dataRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'se-jest-data-'));
  process.env['SEMANTIC_ENGINE_DATA_DIR'] = dataRoot;

  if (!process.env['XDG_DATA_HOME']) {
    process.env['XDG_DATA_HOME'] = path.join(dataRoot, 'xdg');
  }
}

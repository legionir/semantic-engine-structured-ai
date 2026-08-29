/**
 * فاز ۲ — the collision that made one project disappear.
 *
 * Before this phase `registerProject` derived the id from `basename` and keyed
 * its map by that id, so two checkouts named `app` produced the same id and the
 * second registration silently replaced the first. Measured while auditing the
 * plan:
 *
 * ```text
 * ids: prj-app prj-app | listProjects().length → 1
 * ```
 */

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { ProjectService } from './ProjectService';
import { ProjectRegistry, REGISTRY_FILE } from '../core/config/ProjectRegistry';
import { projectIdFor } from '../core/config/ProjectIdentity';

function makeProject(base: string, ...parts: string[]): string {
  const root = path.join(base, ...parts);
  fs.mkdirSync(path.join(root, 'src'), { recursive: true });
  fs.writeFileSync(path.join(root, 'src', 'a.ts'), 'export const a = 1;\n');
  return fs.realpathSync(root);
}

describe('ProjectService — project identity and registration', () => {
  let base: string;

  beforeEach(() => {
    base = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'se-project-service-')));
  });

  afterEach(() => {
    fs.rmSync(base, { recursive: true, force: true });
  });

  it('keeps two projects named `app` as two projects', () => {
    const clientA = makeProject(base, 'client-a', 'app');
    const clientB = makeProject(base, 'client-b', 'app');

    const service = new ProjectService(base);
    const a = service.registerProject(clientA);
    const b = service.registerProject(clientB);

    expect(a.id).not.toBe(b.id);
    expect(a.id).toBe(projectIdFor(path.basename(clientA), clientA));
    expect(service.listProjects()).toHaveLength(2);
    expect(service.getProject(a.id)?.rootPath).toBe(clientA);
    expect(service.getProject(b.id)?.rootPath).toBe(clientB);
    service.dispose();
  });

  it('registers the same root once, however often it is asked', () => {
    const root = makeProject(base, 'app');
    const service = new ProjectService(base);

    const first = service.registerProject(root);
    const second = service.registerProject(root);

    expect(second.id).toBe(first.id);
    expect(service.listProjects()).toHaveLength(1);
    service.dispose();
  });

  it('honours an explicit id and resolves every alias to the same project', () => {
    /* `serve` registers the workspace under three ids so the UI can ask for
       `project=current`; all of them must keep working, but the project must
       appear only once. */
    const root = makeProject(base, 'app');
    const service = new ProjectService(base);

    const byBasename = service.registerProject(root, 'app', 'App');
    const byPrefixed = service.registerProject(root, 'prj-app', 'App');
    const current = service.registerProject(root, 'current', 'App');

    expect(byBasename.id).toBe('app');
    expect(byPrefixed.id).toBe('app');
    expect(current.id).toBe('app');
    expect(service.listProjects()).toHaveLength(1);
    expect(service.listProjects()[0]!.aliases).toEqual(
      expect.arrayContaining(['app', 'prj-app', 'current'])
    );

    for (const alias of ['app', 'prj-app', 'current']) {
      expect(service.getProject(alias)?.rootPath).toBe(root);
    }
    service.dispose();
  });

  it('persists through a registry without writing into the source tree', () => {
    const root = makeProject(base, 'app');
    const dataRoot = path.join(base, 'data');
    const service = new ProjectService(base, {
      registry: new ProjectRegistry({ dataRoot }),
    });

    const project = service.registerProject(root, undefined, 'App');

    expect(fs.existsSync(path.join(dataRoot, REGISTRY_FILE))).toBe(true);
    expect(project.id).toBe(projectIdFor('App', root));
    /* Nothing generated inside the checkout. */
    expect(fs.readdirSync(root)).toEqual(['src']);

    /*
    | A fresh service starts with an empty in-memory map — hydrating it from
    | the registry is the Gateway's job (فاز ۹) — but the registry kept the
    | record, so re-registering the same root yields the very same id.
    */
    service.dispose();
    const persisted = new ProjectRegistry({ dataRoot });
    expect(persisted.list()).toHaveLength(1);
    expect(persisted.list()[0]!.id).toBe(project.id);

    const reopened = new ProjectService(base, { registry: persisted });
    expect(reopened.listProjects()).toHaveLength(0);
    expect(reopened.registerProject(root).id).toBe(project.id);
    expect(reopened.listProjects()).toHaveLength(1);
    reopened.dispose();
  });

  it('still tolerates a root that is not there yet', () => {
    const service = new ProjectService(base, {
      registry: new ProjectRegistry({ dataRoot: path.join(base, 'data') }),
    });

    const missing = path.join(base, 'not-created-yet');
    const project = service.registerProject(missing, 'pending', 'Pending');

    expect(project.status).toBe('missing');
    expect(project.id).toBe('pending');
    expect(service.listProjects()).toHaveLength(1);
    service.dispose();
  });
});

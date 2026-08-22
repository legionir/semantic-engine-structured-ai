import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Build } from '../entities/build.entity';
import { Project } from '../../projects/entities/project.entity';
import * as path from 'path';
import * as fs from 'fs';

@Injectable()
export class BuildService {
  constructor(
    @InjectRepository(Build)
    private buildRepository: Repository<Build>,
    @InjectRepository(Project)
    private projectRepository: Repository<Project>,
  ) {}

  async create(
    projectId: string,
    userId: string,
    options: {
      buildType?: string;
      targetPlatform?: string;
      config?: Build['config'];
    } = {},
  ): Promise<Build> {
    const project = await this.projectRepository.findOne({ where: { id: projectId } });
    if (!project) {
      throw new Error(`Project with id ${projectId} not found`);
    }

    // Get the next build number for this project
    const lastBuild = await this.buildRepository.findOne({
      where: { projectId },
      order: { buildNumber: 'DESC' },
    });
    const buildNumber = (lastBuild?.buildNumber ?? 0) + 1;

    const build = this.buildRepository.create({
      projectId,
      buildNumber,
      buildType: options.buildType ?? 'development',
      targetPlatform: options.targetPlatform ?? 'web',
      config: options.config ?? { minify: true, sourceMaps: false, optimizeAssets: true, pwaEnabled: false },
      status: 'queued',
      createdById: userId,
    });

    return this.buildRepository.save(build);
  }

  async findAll(projectId: string): Promise<Build[]> {
    return this.buildRepository.find({
      where: { projectId },
      order: { buildNumber: 'DESC' },
    });
  }

  async findOne(id: string): Promise<Build> {
    return this.buildRepository.findOne({ where: { id } });
  }

  async updateStatus(id: string, status: string, log?: string): Promise<Build> {
    const build = await this.findOne(id);
    if (!build) {
      throw new Error(`Build with id ${id} not found`);
    }
    build.status = status;
    if (log) {
      build.logs = build.logs ? `${build.logs}\n${log}` : log;
    }
    return this.buildRepository.save(build);
  }

  async startBuild(id: string): Promise<Build> {
    const build = await this.findOne(id);
    if (!build) {
      throw new Error(`Build with id ${id} not found`);
    }

    build.status = 'building';
    await this.buildRepository.save(build);

    try {
      const result = await this.performBuild(build);
      build.status = 'completed';
      build.output = result.output;
      build.buildPath = result.buildPath;
      build.outputUrl = result.outputUrl;
      build.logs = (build.logs ?? '') + '\nBuild completed successfully.';
      return this.buildRepository.save(build);
    } catch (err) {
      build.status = 'failed';
      build.error = err.message;
      build.logs = (build.logs ?? '') + `\nBuild failed: ${err.message}`;
      return this.buildRepository.save(build);
    }
  }

  private async performBuild(build: Build): Promise<{
    output: Build['output'];
    buildPath: string;
    outputUrl: string;
  }> {
    const project = await this.projectRepository.findOne({ where: { id: build.projectId } });
    if (!project) {
      throw new Error('Project not found');
    }

    // Build output directory
    const buildDir = path.join(
      process.cwd(),
      'builds',
      build.projectId,
      `build-${build.buildNumber}`,
    );
    fs.mkdirSync(buildDir, { recursive: true });

    const files: Build['output']['files'] = [];

    // --- Generate index.html ---
    const scenes = project.scenes ?? [];
    const html = this.generateHtml(project, build);
    fs.writeFileSync(path.join(buildDir, 'index.html'), html, 'utf-8');
    files.push({ path: 'index.html', size: Buffer.byteLength(html, 'utf-8'), type: 'text/html' });

    // --- Generate main.js (runtime bundle) ---
    const js = this.generateRuntimeBundle(project, build);
    fs.writeFileSync(path.join(buildDir, 'main.js'), js, 'utf-8');
    files.push({ path: 'main.js', size: Buffer.byteLength(js, 'utf-8'), type: 'application/javascript' });

    // --- Generate style.css ---
    const css = this.generateStyles();
    fs.writeFileSync(path.join(buildDir, 'style.css'), css, 'utf-8');
    files.push({ path: 'style.css', size: Buffer.byteLength(css, 'utf-8'), type: 'text/css' });

    // --- PWA assets if enabled ---
    if (build.config?.pwaEnabled) {
      const manifest = this.generateManifest(project);
      fs.writeFileSync(path.join(buildDir, 'manifest.json'), JSON.stringify(manifest, null, 2), 'utf-8');
      files.push({ path: 'manifest.json', size: Buffer.byteLength(JSON.stringify(manifest), 'utf-8'), type: 'application/json' });

      const sw = this.generateServiceWorker();
      fs.writeFileSync(path.join(buildDir, 'sw.js'), sw, 'utf-8');
      files.push({ path: 'sw.js', size: Buffer.byteLength(sw, 'utf-8'), type: 'application/javascript' });
    }

    // --- Scene data as JSON ---
    const sceneData = JSON.stringify({ scenes, projectName: project.name }, null, 2);
    fs.writeFileSync(path.join(buildDir, 'scene.json'), sceneData, 'utf-8');
    files.push({ path: 'scene.json', size: Buffer.byteLength(sceneData, 'utf-8'), type: 'application/json' });

    const totalSize = files.reduce((sum, f) => sum + f.size, 0);

    return {
      output: { files, totalSize },
      buildPath: buildDir,
      outputUrl: `/builds/${build.projectId}/build-${build.buildNumber}/index.html`,
    };
  }

  private generateHtml(project: Project, build: Build): string {
    const pwaTags = build.config?.pwaEnabled
      ? `<link rel="manifest" href="manifest.json">
<script>
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('sw.js');
  });
}
</script>`
      : '';

    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${this.escapeHtml(project.name)}</title>
  <link rel="stylesheet" href="style.css">
  ${pwaTags}
</head>
<body>
  <div id="app"></div>
  <script src="main.js"></script>
</body>
</html>`;
  }

  private generateRuntimeBundle(project: Project, build: Build): string {
    const isMinified = build.config?.minify ?? true;
    const scenes = project.scenes ?? [];

    let code = `
(function() {
  'use strict';

  const APP = {
    name: ${JSON.stringify(project.name)},
    version: ${JSON.stringify(project.config?.version ?? '1.0.0')},
    scenes: ${JSON.stringify(scenes)},
    config: ${JSON.stringify(project.config ?? {})},
  };

  function init() {
    const app = document.getElementById('app');
    if (!app) return;

    app.innerHTML = '<div class="web-engine-root">' +
      '<div class="engine-header">' +
        '<h1>' + escapeHtml(APP.name) + '</h1>' +
        '<span class="engine-version">v' + escapeHtml(String(APP.version)) + '</span>' +
      '</div>' +
      '<div class="engine-canvas">' +
        '<canvas id="game-canvas"></canvas>' +
      '</div>' +
      '<div class="engine-status">' +
        '<span>Scene: ' + escapeHtml(String(APP.scenes[0]?.name || 'Untitled')) + '</span>' +
      '</div>' +
    '</div>';

    console.log('[Web Engine] Runtime initialized:', APP.name);
    console.log('[Web Engine] Scenes:', APP.scenes.length);
  }

  function escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
`;

    if (isMinified) {
      code = code
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/\/\/[^\n]*/g, '')
        .replace(/\n\s*/g, '')
        .replace(/\s{2,}/g, ' ')
        .replace(/\s*([{}();,:])\s*/g, '$1');
    }

    return code;
  }

  private generateStyles(): string {
    return `/* Web Engine Runtime Styles */
* { margin: 0; padding: 0; box-sizing: border-box; }

html, body {
  width: 100%;
  height: 100%;
  overflow: hidden;
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
  background: #1a1a2e;
  color: #e0e0e0;
}

#app {
  width: 100%;
  height: 100%;
  display: flex;
  flex-direction: column;
}

.web-engine-root {
  display: flex;
  flex-direction: column;
  height: 100%;
}

.engine-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 12px 20px;
  background: #16213e;
  border-bottom: 1px solid #0f3460;
}

.engine-header h1 {
  font-size: 18px;
  font-weight: 600;
  color: #e94560;
}

.engine-version {
  font-size: 12px;
  color: #888;
  background: #0f3460;
  padding: 2px 8px;
  border-radius: 4px;
}

.engine-canvas {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  background: #0f0f23;
}

.engine-canvas canvas {
  display: block;
  width: 100%;
  height: 100%;
}

.engine-status {
  padding: 8px 20px;
  background: #16213e;
  border-top: 1px solid #0f3460;
  font-size: 12px;
  color: #888;
}
`;
  }

  private generateManifest(project: Project): Record<string, unknown> {
    return {
      name: project.name,
      short_name: (project.name ?? 'WebEngine').slice(0, 12),
      description: project.description ?? 'Web Engine Project',
      start_url: '.',
      display: 'standalone',
      background_color: '#1a1a2e',
      theme_color: '#16213e',
      orientation: 'landscape',
      icons: [
        { src: '/icon-192.png', sizes: '192x192', type: 'image/png' },
        { src: '/icon-512.png', sizes: '512x512', type: 'image/png' },
      ],
    };
  }

  private generateServiceWorker(): string {
    return `const CACHE_NAME = 'web-engine-v1';
const ASSETS = [
  './',
  './index.html',
  './main.js',
  './style.css',
  './manifest.json',
  './scene.json',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(ASSETS);
    })
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => {
      return Promise.all(
        keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k))
      );
    })
  );
});

self.addEventListener('fetch', (event) => {
  event.respondWith(
    caches.match(event.request).then((cached) => {
      return cached || fetch(event.request).then((response) => {
        return caches.open(CACHE_NAME).then((cache) => {
          cache.put(event.request, response.clone());
          return response;
        });
      });
    })
  );
});
`;
  }

  private escapeHtml(str: string): string {
    return str
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }
}

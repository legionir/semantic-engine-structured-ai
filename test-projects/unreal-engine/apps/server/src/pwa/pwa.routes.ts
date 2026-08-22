import { FastifyInstance } from 'fastify';
import path from 'path';
import fs from 'fs';
import { PwaService } from './pwa.service';

export const registerPwaRoutes = (server: FastifyInstance) => {
  const pwaService = new PwaService();

  // Serve manifest.json
  server.get('/manifest.json', async (req, res) => {
    try {
      const manifest = pwaService.generateManifest({
        name: 'Web Engine',
        description: 'Web-native 3D engine and visual editor',
        themeColor: '#16213e',
        backgroundColor: '#1a1a2e',
        display: 'standalone',
        orientation: 'landscape',
      });
      res.header('Content-Type', 'application/json');
      res.header('Cache-Control', 'public, max-age=3600');
      res.send(manifest);
    } catch (error) {
      res.code(500).send({ error: error.message });
    }
  });

  // Serve service worker
  server.get('/sw.js', async (req, res) => {
    try {
      const sw = pwaService.generateServiceWorker({
        cacheName: 'web-engine-pwa-v1',
        staticAssets: [
          '/', '/index.html', '/main.js', '/style.css', '/manifest.json',
          '/icon-192.png', '/icon-512.png',
        ],
        offlineFallback: '/index.html',
      });
      res.header('Content-Type', 'application/javascript');
      res.header('Cache-Control', 'no-cache');
      res.send(sw);
    } catch (error) {
      res.code(500).send({ error: error.message });
    }
  });

  // Serve generated PWA icons (simple SVG placeholders)
  server.get('/icon-192.png', async (req, res) => {
    try {
      const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="192" height="192" viewBox="0 0 192 192">
  <rect width="192" height="192" fill="#16213e"/>
  <text x="96" y="120" font-size="80" text-anchor="middle" fill="#e94560" font-family="Arial">WE</text>
</svg>`;
      res.header('Content-Type', 'image/svg+xml');
      res.header('Cache-Control', 'public, max-age=86400');
      res.send(svg);
    } catch (error) {
      res.code(500).send({ error: error.message });
    }
  });

  // Serve 512x512 icon
  server.get('/icon-512.png', async (req, res) => {
    try {
      const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512" viewBox="0 0 512 512">
  <rect width="512" height="512" fill="#16213e"/>
  <text x="256" y="320" font-size="200" text-anchor="middle" fill="#e94560" font-family="Arial">WE</text>
</svg>`;
      res.header('Content-Type', 'image/svg+xml');
      res.header('Cache-Control', 'public, max-age=86400');
      res.send(svg);
    } catch (error) {
      res.code(500).send({ error: error.message });
    }
  });

  // Serve builds output directory statically
  server.get('/builds/*', async (req, res) => {
    try {
      const buildPath = path.join(process.cwd(), 'builds');
      const requestedPath = (req.params as any)['*'] as string;
      const filePath = path.join(buildPath, requestedPath);

      // Security: prevent directory traversal
      if (!filePath.startsWith(buildPath)) {
        res.code(403).send({ error: 'Forbidden' });
        return;
      }

      if (!fs.existsSync(filePath)) {
        res.code(404).send({ error: 'File not found' });
        return;
      }

      const stat = fs.statSync(filePath);
      if (stat.isDirectory()) {
        // Serve index.html from directory
        const indexPath = path.join(filePath, 'index.html');
        if (fs.existsSync(indexPath)) {
          const content = fs.readFileSync(indexPath, 'utf-8');
          res.header('Content-Type', 'text/html');
          res.send(content);
          return;
        }
        res.code(404).send({ error: 'Not found' });
        return;
      }

      const ext = path.extname(filePath).toLowerCase();
      const mimeMap: Record<string, string> = {
        '.html': 'text/html',
        '.js': 'application/javascript',
        '.css': 'text/css',
        '.json': 'application/json',
        '.png': 'image/png',
        '.jpg': 'image/jpeg',
        '.jpeg': 'image/jpeg',
        '.svg': 'image/svg+xml',
        '.ico': 'image/x-icon',
        '.wasm': 'application/wasm',
        '.glb': 'model/gltf-binary',
        '.gltf': 'model/gltf+json',
      };

      const mime = mimeMap[ext] || 'application/octet-stream';
      const content = fs.readFileSync(filePath);
      res.header('Content-Type', mime);
      res.send(content);
    } catch (error) {
      res.code(500).send({ error: error.message });
    }
  });
};

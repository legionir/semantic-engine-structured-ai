export interface WebAppManifest {
  name: string;
  short_name: string;
  description: string;
  start_url: string;
  display: 'standalone' | 'fullscreen' | 'minimal-ui' | 'browser';
  background_color: string;
  theme_color: string;
  orientation: 'portrait' | 'landscape' | 'any';
  icons: Array<{ src: string; sizes: string; type: string }>;
  categories?: string[];
  screenshots?: Array<{ src: string; sizes: string; type: string; form_factor?: 'narrow' | 'wide' }>;
  prefer_related_applications?: boolean;
  related_applications?: Array<{ platform: string; url: string }>;
  scope?: string;
}

/**
 * Generate a Web App Manifest for a project.
 */
export function generateManifest(options: {
  name: string;
  description?: string;
  themeColor?: string;
  backgroundColor?: string;
  display?: WebAppManifest['display'];
  orientation?: WebAppManifest['orientation'];
  icons?: WebAppManifest['icons'];
  scope?: string;
  startUrl?: string;
}): WebAppManifest {
  return {
    name: options.name,
    short_name: options.name.slice(0, 12),
    description: options.description ?? 'Web Engine Project',
    start_url: options.startUrl ?? '.',
    display: options.display ?? 'standalone',
    background_color: options.backgroundColor ?? '#1a1a2e',
    theme_color: options.themeColor ?? '#16213e',
    orientation: options.orientation ?? 'landscape',
    icons: options.icons ?? [
      { src: '/icon-192.png', sizes: '192x192', type: 'image/png' },
      { src: '/icon-512.png', sizes: '512x512', type: 'image/png' },
    ],
    scope: options.scope ?? '.',
    categories: ['games', 'productivity'],
  };
}

import { defineConfig } from 'wxt';

// See https://wxt.dev/api/config.html
export default defineConfig({
  manifest: {
    name: 'Wayfinder',
    description: 'A floating evidence-first guide that maps and explains public GitHub repositories.',
    permissions: ['storage'],
    host_permissions: [
      'https://github.com/*',
      'http://localhost:8787/*',
      'https://wayfinder-api.hopit-robert.workers.dev/*',
    ],
  },
});

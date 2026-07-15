import { defineConfig } from 'wxt';

// See https://wxt.dev/api/config.html
export default defineConfig({
  manifest: {
    name: 'Wayfinder',
    description: 'A floating on-page agent that points out, explains, and maps any GitHub repository.',
    permissions: ['storage'],
    host_permissions: [
      'https://github.com/*',
      'http://localhost:8787/*',
      'https://wayfinder-api.hopit-robert.workers.dev/*',
    ],
  },
});

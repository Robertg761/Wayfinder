import { defineConfig } from 'wxt';

// See https://wxt.dev/api/config.html
export default defineConfig({
  modules: ['@wxt-dev/module-react'],
  manifest: {
    name: 'Wayfinder',
    description: 'A floating guide that points out, explains, and maps any GitHub repository.',
    permissions: ['sidePanel', 'storage', 'tabs'],
    host_permissions: [
      'https://github.com/*',
      'http://localhost:8787/*',
      'https://wayfinder-api.hopit-robert.workers.dev/*',
    ],
    action: {
      default_title: 'Open Wayfinder',
    },
  },
});

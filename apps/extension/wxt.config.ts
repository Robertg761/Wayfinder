import { defineConfig } from 'wxt';

// See https://wxt.dev/api/config.html
export default defineConfig({
  modules: ['@wxt-dev/module-react'],
  manifest: {
    name: 'Wayfinder',
    description: 'Turn any GitHub repository into a guided, interactive code tour.',
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

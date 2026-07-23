import { defineConfig } from 'wxt';
import { WAYFINDER_DEV_API_URL, WAYFINDER_PROD_API_URL } from '@wayfinder/contracts';

// See https://wxt.dev/api/config.html
export default defineConfig({
  manifest: ({ mode }) => ({
    name: 'Wayfinder',
    description: 'A floating evidence-first guide that maps and explains public GitHub repositories.',
    permissions: ['storage'],
    host_permissions: [
      'https://github.com/*',
      // The local Worker origin is a development convenience only; production
      // builds must not request access to anything on localhost.
      ...(mode === 'development' ? [`${WAYFINDER_DEV_API_URL}/*`] : []),
      `${WAYFINDER_PROD_API_URL}/*`,
    ],
  }),
});

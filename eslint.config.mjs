import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    ignores: [
      '**/dist/**',
      '**/.output/**',
      '**/.wxt/**',
      '**/node_modules/**',
      '**/coverage/**',
    ],
  },
  ...tseslint.configs.recommended,
  {
    rules: {
      '@typescript-eslint/no-unused-vars': ['error', {
        argsIgnorePattern: '^_',
        varsIgnorePattern: '^_',
        caughtErrors: 'none',
      }],
      // The Worker and extension interoperate with untyped platform surfaces
      // (Cloudflare bindings, DOM retargeting); explicit casts through
      // unknown are the accepted pattern instead of bare any.
      '@typescript-eslint/no-explicit-any': 'error',
    },
  },
);

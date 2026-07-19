import { mkdir, readFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const sourcePath = join(repositoryRoot, 'docs/assets/wayfinder-mark.svg');
const outputDirectory = join(repositoryRoot, 'apps/extension/public/icon');
const sizes = [16, 32, 48, 96, 128];

await mkdir(outputDirectory, { recursive: true });
const source = await readFile(sourcePath, 'utf8');
const browser = await chromium.launch({ headless: true });

try {
  for (const size of sizes) {
    const context = await browser.newContext({
      deviceScaleFactor: 1,
      viewport: { width: size, height: size },
    });
    const page = await context.newPage();
    await page.setContent(`
      <style>
        html, body { width: 100%; height: 100%; margin: 0; background: transparent; overflow: hidden; }
        svg { display: block; width: 100%; height: 100%; }
      </style>
      ${source}
    `);
    await page.screenshot({
      path: join(outputDirectory, `${size}.png`),
      omitBackground: true,
    });
    await context.close();
  }
} finally {
  await browser.close();
}

console.log(`Rendered Wayfinder extension icons: ${sizes.join(', ')} px`);

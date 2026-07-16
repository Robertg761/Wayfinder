import { describe, expect, it, vi } from 'vitest';
import { copyText } from './copy-text';

describe('copyText', () => {
  it('copies the exact value and reports success', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);

    await expect(copyText('pnpm install', { writeText })).resolves.toBe(true);
    expect(writeText).toHaveBeenCalledWith('pnpm install');
  });

  it('reports failure when the clipboard rejects the write', async () => {
    const writeText = vi.fn().mockRejectedValue(new Error('permission denied'));

    await expect(copyText('pnpm install', { writeText })).resolves.toBe(false);
  });

  it('allows a successful retry after a clipboard failure', async () => {
    const writeText = vi.fn()
      .mockRejectedValueOnce(new Error('permission denied'))
      .mockResolvedValueOnce(undefined);

    await expect(copyText('pnpm install', { writeText })).resolves.toBe(false);
    await expect(copyText('pnpm install', { writeText })).resolves.toBe(true);
    expect(writeText).toHaveBeenCalledTimes(2);
  });

  it('reports failure when no clipboard is available', async () => {
    await expect(copyText('pnpm install', null)).resolves.toBe(false);
  });
});

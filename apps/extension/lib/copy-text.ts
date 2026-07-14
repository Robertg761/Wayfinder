export interface ClipboardWriter {
  writeText(text: string): Promise<void>;
}

export async function copyText(
  value: string,
  clipboard: ClipboardWriter | null = globalThis.navigator?.clipboard ?? null,
): Promise<boolean> {
  if (!clipboard) return false;

  try {
    await clipboard.writeText(value);
    return true;
  } catch {
    return false;
  }
}

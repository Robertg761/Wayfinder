// Shared repository-path classification. find, tour, and file-context all
// rank or group files by extension and test-shape; keeping one definition
// stops the three copies from drifting apart again.

export const sourceExtensions = new Set([
  "c", "cc", "cjs", "cpp", "cs", "cts", "cxx", "go", "h", "hpp", "java", "js", "jsx", "kt", "mjs", "mts",
  "php", "py", "rb", "rs", "sh", "swift", "ts", "tsx", "vue",
]);

export function extension(path: string): string {
  const fileName = path.split("/").at(-1) ?? "";
  return fileName.includes(".") ? fileName.split(".").at(-1)?.toLowerCase() ?? "" : "";
}

export function isTestPath(path: string): boolean {
  return /(^|\/)(__tests__|test|tests|spec|specs|fixtures?)(\/|$)|\.(test|spec)\.|(^|\/)test_[^/]+\.[^.]+$|_test\.[^.]+$/i.test(path);
}

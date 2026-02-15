const TEST_PATTERNS = [
  /\.(test|spec)\.(ts|js|tsx|jsx|py|rs|go|java|rb|swift|kt)$/,
  /(^|\/)tests?\//,
  /\/__tests__\//,
  /^test_\w+\.py$/,
  /\/test_\w+\.py$/,
  /\w+_test\.py$/,
  /\w+_test\.go$/,
];

const SOURCE_EXTENSIONS = /\.(ts|js|tsx|jsx|py|rs|go|java|rb|swift|kt)$/;

const CONFIG_PATTERNS = [
  /\.config\.(ts|js|mjs|cjs)$/,
  /^\./, // dotfiles
  /package\.json$/,
  /tsconfig.*\.json$/,
];

export function isTestFile(path: string): boolean {
  return TEST_PATTERNS.some((p) => p.test(path));
}

export function isSourceFile(path: string): boolean {
  if (!SOURCE_EXTENSIONS.test(path)) return false;
  if (isTestFile(path)) return false;
  if (CONFIG_PATTERNS.some((p) => p.test(path))) return false;
  return true;
}

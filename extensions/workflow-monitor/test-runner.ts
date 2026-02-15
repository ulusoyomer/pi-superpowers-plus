const TEST_COMMANDS = [
  /\bnpm\s+test\b/,
  /\bnpx\s+(vitest|jest)\b/,
  /\bpytest\b/,
  /\bgo\s+test\b/,
  /\bcargo\s+test\b/,
  /\bjest\b/,
  /\bvitest\b/,
  /\bmocha\b/,
  /\brspec\b/,
  /\bphpunit\b/,
  /\bdotnet\s+test\b/,
];

const PASS_PATTERNS = [/\d+\s+(tests?\s+)?passed/i, /^ok\s+/m, /Tests:\s+\d+ passed/, /\d+ passing/, /BUILD SUCCESSFUL/];

const FAIL_PATTERNS = [/\bfailed\b/i, /^FAIL\b/m, /\d+ failing/, /BUILD FAILED/, /ERRORS!/];

export function parseTestCommand(command: string): boolean {
  return TEST_COMMANDS.some((p) => p.test(command));
}

export function parseTestResult(output: string, exitCode: number | undefined): boolean | null {
  const hasFail = FAIL_PATTERNS.some((p) => p.test(output));
  const hasPass = PASS_PATTERNS.some((p) => p.test(output));

  if (hasFail && !hasPass) return false;
  if (hasPass && !hasFail) return true;
  if (exitCode !== undefined) return exitCode === 0;
  return null;
}

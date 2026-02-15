import { describe, expect, test } from "vitest";
import { isSourceFile, isTestFile } from "../../../extensions/workflow-monitor/heuristics";

describe("isTestFile", () => {
  test("matches .test.ts files", () => {
    expect(isTestFile("src/utils.test.ts")).toBe(true);
  });
  test("matches .spec.ts files", () => {
    expect(isTestFile("src/utils.spec.ts")).toBe(true);
  });
  test("matches .test.js files", () => {
    expect(isTestFile("src/utils.test.js")).toBe(true);
  });
  test("matches files in __tests__/ directory", () => {
    expect(isTestFile("src/__tests__/utils.ts")).toBe(true);
  });
  test("matches files in tests/ directory", () => {
    expect(isTestFile("tests/utils.ts")).toBe(true);
  });
  test("matches files in test/ directory", () => {
    expect(isTestFile("test/utils.ts")).toBe(true);
  });
  test("matches test directory paths (exercises directory pattern, not filename)", () => {
    // These use non-.test filenames so only the directory pattern matches
    expect(isTestFile("tests/utils.ts")).toBe(true);
    expect(isTestFile("test/utils.ts")).toBe(true);
    expect(isTestFile("src/tests/utils.ts")).toBe(true);
    expect(isTestFile("src/test/utils.ts")).toBe(true);
    // Also verify .test.ts in test dirs still works
    expect(isTestFile("tests/foo.test.ts")).toBe(true);
    expect(isTestFile("src/tests/foo.test.ts")).toBe(true);
  });
  test("matches python test files (test_*.py)", () => {
    expect(isTestFile("test_utils.py")).toBe(true);
  });
  test("matches python test files (*_test.py)", () => {
    expect(isTestFile("utils_test.py")).toBe(true);
  });
  test("does not match regular source files", () => {
    expect(isTestFile("src/utils.ts")).toBe(false);
  });
  test("does not match config files", () => {
    expect(isTestFile("vitest.config.ts")).toBe(false);
  });
  test("does not match setup.py", () => {
    expect(isTestFile("setup.py")).toBe(false);
  });
});

describe("isSourceFile", () => {
  test("matches .ts files", () => {
    expect(isSourceFile("src/utils.ts")).toBe(true);
  });
  test("matches .py files", () => {
    expect(isSourceFile("src/main.py")).toBe(true);
  });
  test("matches .go files", () => {
    expect(isSourceFile("cmd/server.go")).toBe(true);
  });
  test("does not match test files", () => {
    expect(isSourceFile("src/utils.test.ts")).toBe(false);
  });
  test("does not match config files", () => {
    expect(isSourceFile("vitest.config.ts")).toBe(false);
  });
  test("does not match markdown", () => {
    expect(isSourceFile("README.md")).toBe(false);
  });
  test("does not match json", () => {
    expect(isSourceFile("package.json")).toBe(false);
  });
});

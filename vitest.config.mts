import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    alias: { vscode: fileURLToPath(new URL("./test/vscode.ts", import.meta.url)) },
    coverage: {
      provider: "v8",
      include: ["src/**/*.ts"],
      exclude: ["src/**/*.test.ts"],
      thresholds: { statements: 88, branches: 80, functions: 85, lines: 90 },
    },
  },
});

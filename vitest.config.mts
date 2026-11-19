import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    alias: { vscode: new URL("./test/vscode.ts", import.meta.url).pathname },
    coverage: { provider: "v8", include: ["src/**/*.ts"], exclude: ["src/**/*.test.ts"] },
  },
});

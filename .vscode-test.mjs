import { defineConfig } from "@vscode/test-cli";

// Runs the integration suite inside a real VS Code instance, so the code is exercised
// against the actual vscode API rather than the stub the unit tests use.
export default defineConfig({
  files: "out/test/integration/**/*.test.js",
  workspaceFolder: "./test/fixtures/workspace",
  mocha: {
    // tdd is what gives us suite() / test()
    ui: "tdd",
    timeout: 30_000,
  },
});

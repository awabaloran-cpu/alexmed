import path from "path";
import { defineConfig } from "vitest/config";

const projectRoot = path.resolve(import.meta.dirname);

export default defineConfig({
  root: projectRoot,
  // "automatic" matches Next.js's own JSX transform (no manual `React`
  // import in any component — see components/*.tsx) — needed once a test
  // imports a named export from a .tsx file (first done in PR4, testing
  // BookPageViewer's renderTextWithHighlights); esbuild's default classic
  // transform would otherwise require `React` in scope.
  esbuild: { jsx: "automatic" },
  resolve: {
    alias: {
      "@": projectRoot,
      "@shared": path.resolve(projectRoot, "shared"),
    },
  },
  test: {
    environment: "node",
    include: ["lib/**/*.test.ts", "**/*.test.ts"],
    exclude: ["node_modules/**", ".next/**"],
  },
});

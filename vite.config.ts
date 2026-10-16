// @lovable.dev/vite-tanstack-config already includes the following — do NOT add them manually
// or the app will break with duplicate plugins:
//   - TanStack devtools (dev-only, first), tanstackStart, viteReact, tailwindcss, tsConfigPaths,
//     nitro (build-only using cloudflare as a default target), VITE_* env injection, @ path alias,
//     React/TanStack dedupe, error logger plugins, and sandbox detection (port/host/strictPort).
// You can pass additional config via defineConfig({ vite: { ... }, etc... }) if needed.
import { defineConfig } from "@lovable.dev/vite-tanstack-config";
import { execSync } from "node:child_process";

// Build version: 1.0.<commit count> (+short hash), stamped automatically on every build.
function git(cmd: string) { try { return execSync(`git ${cmd}`, { stdio: ["ignore", "pipe", "ignore"] }).toString().trim(); } catch { return ""; } }
const BUILD_VERSION = `1.0.${git("rev-list --count HEAD") || "0"}`;
const BUILD_COMMIT = git("rev-parse --short HEAD") || "local";
const BUILD_DATE = new Date().toISOString().slice(0, 10);

export default defineConfig({
  tanstackStart: {
    // Redirect TanStack Start's bundled server entry to src/server.ts (our SSR error wrapper).
    // nitro/vite builds from this
    server: { entry: "server" },
  },
  // Use a stable, explicit browser dependency set. Late optimizer discoveries can
  // change React's module URL while an open preview still uses the old renderer.
  // Reject old optimizer hashes instead of serving new code under stale URLs.
  vite: {
    define: {
      __APP_VERSION__: JSON.stringify(BUILD_VERSION),
      __APP_COMMIT__: JSON.stringify(BUILD_COMMIT),
      __APP_BUILD_DATE__: JSON.stringify(BUILD_DATE),
    },
    optimizeDeps: {
      noDiscovery: true,
      ignoreOutdatedRequests: false,
      include: [
        "@supabase/supabase-js", "eventsource-parser", "@mlc-ai/web-llm", "exceljs", "xlsx",
        "@ai-sdk/anthropic", "@ai-sdk/openai", "@ai-sdk/openai-compatible", "ai",
        "@tanstack/react-query", "@tanstack/react-router > @tanstack/react-store",
        "@radix-ui/react-dialog", "@radix-ui/react-dropdown-menu",
        "@radix-ui/react-hover-card", "@radix-ui/react-select",
        "@radix-ui/react-separator", "@radix-ui/react-slot",
        "@radix-ui/react-switch", "@radix-ui/react-tooltip",
        "@streamdown/cjk", "@streamdown/code", "@streamdown/math", "@streamdown/mermaid",
        "streamdown", "use-stick-to-bottom", "motion/react", "lucide-react",
        "class-variance-authority", "clsx", "cmdk", "nanoid", "tailwind-merge",
      ],
    },
  },
});

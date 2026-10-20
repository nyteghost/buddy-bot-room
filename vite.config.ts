import { defineConfig } from "vite";
import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import viteReact from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import tsConfigPaths from "vite-tsconfig-paths";
import { nitro } from "nitro/vite";
import { execSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { selfHostedPlugin } from "./vite-self-hosted";

// Build version: 1.0.<commit count> (+short hash), stamped automatically on every build.
function git(cmd: string) { try { return execSync(`git ${cmd}`, { stdio: ["ignore", "pipe", "ignore"] }).toString().trim(); } catch { return ""; } }
// The Docker build has no git history (Portainer clones without it), so it writes .build-info.json from GitHub instead.
function stamp(): { count?: string; commit?: string } {
  try { return JSON.parse(readFileSync(".build-info.json", "utf8")); } catch { return {}; }
}
const info = stamp();
const SHALLOW = git("rev-parse --is-shallow-repository") !== "false";
const BUILD_VERSION = `1.0.${(!SHALLOW && git("rev-list --count HEAD")) || info.count || (SHALLOW ? "x" : "0")}`;
const BUILD_COMMIT = git("rev-parse --short HEAD") || info.commit || "local";
const BUILD_DATE = new Date().toISOString().slice(0, 10);

const selfHosted = process.env["BUDDY_SELF_HOSTED"] === "1";

export default defineConfig(({ command }) => ({
  plugins: [
    // Redirect TanStack Start's bundled server entry to src/server.ts (our SSR error wrapper).
    tanstackStart({ server: { entry: "server" } }),
    viteReact(),
    tailwindcss(),
    tsConfigPaths(),
    // Production builds only; the dev server doesn't need it.
    ...(command === "build" ? [nitro()] : []),
    // Docker dev server only: password gate + /__health (src/server.ts covers production builds).
    ...(selfHosted ? [selfHostedPlugin()] : []),
  ],
  resolve: { dedupe: ["react", "react-dom", "@tanstack/react-router", "@tanstack/react-query"] },
  // Self-hosting only (the Dockerfile sets this): accept any Host header so the dev server works
  // behind a reverse proxy or a LAN hostname.
  ...(process.env["BUDDY_ALLOW_ALL_HOSTS"] === "1" ? { server: { allowedHosts: true as const } } : {}),
  define: {
    __APP_VERSION__: JSON.stringify(BUILD_VERSION),
    __APP_COMMIT__: JSON.stringify(BUILD_COMMIT),
    __APP_BUILD_DATE__: JSON.stringify(BUILD_DATE),
    // True only in the self-hosted Docker build (the Dockerfile sets BUDDY_SELF_HOSTED=1): the UI shows "Local mode".
    __SELF_HOSTED__: JSON.stringify(selfHosted),
  },
  // Use a stable, explicit browser dependency set. Late optimizer discoveries can
  // change React's module URL while an open preview still uses the old renderer.
  // Reject old optimizer hashes instead of serving new code under stale URLs.
  optimizeDeps: {
    noDiscovery: true,
    ignoreOutdatedRequests: false,
    include: [
      "eventsource-parser", "@mlc-ai/web-llm", "exceljs", "xlsx",
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
}));

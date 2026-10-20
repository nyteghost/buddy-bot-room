// Builds public/stage-planner.html: the Stage Deck Planner as ONE file (code, styles and all) that runs offline
// in any browser, so it can be emailed to people without Pixel Pals. It bundles the same planner the Deck tab uses.
// Run:  node tools/standalone-deck/build.mjs   (needs the project's dependencies: react, esbuild, tailwindcss)
import { build } from "esbuild";
import { compile } from "tailwindcss";
import { createRequire } from "node:module";
import { readFileSync, writeFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "../..");
const require = createRequire(import.meta.url);

const js = await build({
  entryPoints: [join(here, "main.tsx")],
  bundle: true, write: false, minify: true, format: "iife", target: "es2020", jsx: "automatic",
  define: { "process.env.NODE_ENV": '"production"' },
  legalComments: "none",
  plugins: [{
    name: "alias",
    setup(b) {
      b.onResolve({ filter: /^lucide-react$/ }, () => ({ path: join(here, "stubs/lucide-react.tsx") }));
      b.onResolve({ filter: /^@\/components\/ui\/button$/ }, () => ({ path: join(here, "stubs/button.tsx") }));
      b.onResolve({ filter: /^@\// }, (a) => {
        const base = join(root, "src", a.path.slice(2));
        for (const ext of ["", ".tsx", ".ts", "/index.tsx", "/index.ts"]) { try { if (statSync(base + ext).isFile()) return { path: base + ext }; } catch { /* next */ } }
        return { errors: [{ text: `Can't find ${a.path}` }] };
      });
    },
  }],
});
const script = js.outputFiles[0].text.replace(/<\/script/gi, "<\\/script");

// Tailwind: scan the files that go into the page for class names, then compile just those.
const files = [join(root, "src/components/deck-planner/planner.tsx"), join(root, "src/components/deck-planner/stage-layout.tsx"), join(here, "main.tsx"), join(here, "stubs/button.tsx")];
const candidates = new Set();
for (const f of files) for (const t of readFileSync(f, "utf8").split(/[^A-Za-z0-9_\-:\/\[\]\.%#!@()=,&>*+']+/)) if (t) candidates.add(t);
const tw = dirname(require.resolve("tailwindcss/package.json"));
const compiler = await compile(readFileSync(join(here, "standalone.css"), "utf8"), {
  base: here,
  async loadStylesheet(id, base) {
    const path = id === "tailwindcss" ? join(tw, "index.css") : id.startsWith("tailwindcss/") ? join(tw, id.slice(12) + (id.endsWith(".css") ? "" : ".css")) : resolve(base, id);
    return { path, base: dirname(path), content: readFileSync(path, "utf8") };
  },
});
const css = compiler.build([...candidates]);

const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Stage Deck Planner</title>
<style>${css}</style>
</head>
<body>
<div id="root"></div>
<script>${script}</script>
</body>
</html>
`;
const out = join(root, "public/stage-planner.html");
writeFileSync(out, html);
console.log(`wrote ${out} (${(html.length / 1024).toFixed(0)} KB)`);

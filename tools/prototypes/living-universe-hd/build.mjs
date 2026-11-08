#!/usr/bin/env node
/**
 * Builds the isolated Living Universe HD camera lab into one self-contained HTML file:
 *   node tools/prototypes/living-universe-hd/build.mjs  →  tools/prototypes/living-universe-hd/dist/index.html
 * It bundles the app's real movement code (world-floor, world-wander, world-crowd, world-camera,
 * world-presentation) with placeholder art drawn in code. No assets, no network, not part of the app build;
 * delete this folder to remove it.
 */
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url)), root = join(here, "../../..");
const require = createRequire(import.meta.url);
let ts;
try { ts = require("typescript"); } catch { ts = require(process.env.TYPESCRIPT_PATH ?? "typescript"); }
const MODULES = ["world-floor", "world-wander", "world-crowd", "world-camera", "world-presentation"];
const bundle = MODULES.map(name => {
 const source = readFileSync(join(root, "src/lib", name + ".ts"), "utf8");
 const out = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText;
 return `__define(${JSON.stringify(name)},function(require,module,exports){${out}\n});`;
}).join("\n");
const loader = `const __mods={},__cache={};function __define(n,f){__mods[n]=f;}
function __require(n){n=n.replace(/^(@\\/lib\\/|\\.\\/)/,"");if(__cache[n])return __cache[n].exports;const m={exports:{}};__cache[n]=m;if(!__mods[n])throw new Error("lab: missing module "+n);__mods[n](__require,m,m.exports);return m.exports;}`;
const page = readFileSync(join(here, "page.html"), "utf8")
 .replace("/*__MODULES__*/", () => loader + "\n" + bundle)
 .replace("/*__LAB__*/", () => readFileSync(join(here, "lab.js"), "utf8"));
mkdirSync(join(here, "dist"), { recursive: true });
writeFileSync(join(here, "dist/index.html"), page);
console.log("wrote", join(here, "dist/index.html"), Math.round(page.length / 1024) + " KB");

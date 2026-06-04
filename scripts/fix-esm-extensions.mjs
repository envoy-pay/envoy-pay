/**
 * Post-process the ESM build so Node's native ESM loader can resolve relative
 * imports.
 *
 * `tsconfig.esm.json` uses `moduleResolution: "bundler"`, so tsc emits
 * extensionless specifiers like `export { X } from './client'`. CommonJS
 * `require` resolves those, but Node ESM throws ERR_MODULE_NOT_FOUND — it needs
 * an explicit `./client.js` (file) or `./client/index.js` (directory).
 *
 * This walks dist/esm and rewrites each relative specifier to the real path it
 * points at on disk. No dependency, no source changes — just the build output.
 */
import { readFileSync, writeFileSync, existsSync, readdirSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ESM_DIR = resolve(dirname(fileURLToPath(import.meta.url)), "..", "dist", "esm");

// Matches the specifier in `from '...'`, `import '...'`, and `import('...')`.
const SPECIFIER = /(\bfrom\s+|\bimport\s*\(\s*|\bimport\s+)(['"])(\.\.?\/[^'"]+)(\2)/g;

function jsFiles(dir) {
  const out = [];
  for (const entry of readdirSync(dir)) {
    const p = join(dir, entry);
    if (statSync(p).isDirectory()) out.push(...jsFiles(p));
    else if (p.endsWith(".js")) out.push(p);
  }
  return out;
}

function resolveSpecifier(fileDir, spec) {
  if (/\.(js|mjs|cjs|json)$/.test(spec)) return spec; // already explicit
  const target = resolve(fileDir, spec);
  if (existsSync(`${target}.js`)) return `${spec}.js`;
  if (existsSync(join(target, "index.js"))) return `${spec}/index.js`;
  return spec; // unresolved — reported below
}

let rewritten = 0;
const unresolved = [];

for (const file of jsFiles(ESM_DIR)) {
  const src = readFileSync(file, "utf8");
  const next = src.replace(SPECIFIER, (_m, pre, quote, spec, close) => {
    const fixed = resolveSpecifier(dirname(file), spec);
    if (fixed === spec && !/\.(js|mjs|cjs|json)$/.test(spec)) {
      unresolved.push(`${file}: '${spec}'`);
    }
    return `${pre}${quote}${fixed}${close}`;
  });
  if (next !== src) {
    writeFileSync(file, next);
    rewritten++;
  }
}

console.log(`fix-esm-extensions: rewrote ${rewritten} file(s) in dist/esm`);
if (unresolved.length) {
  console.error(
    `fix-esm-extensions: ${unresolved.length} specifier(s) could not be resolved:\n  ${unresolved.join("\n  ")}`,
  );
  process.exit(1);
}

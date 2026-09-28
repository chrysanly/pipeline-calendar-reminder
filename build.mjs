// Build a single self-contained dist/index.html so the app runs from file://
// (ES modules are blocked by CORS when you double-click index.html).
// Zero dependencies: `node build.mjs`.

import { readFileSync, writeFileSync, mkdirSync, readdirSync, copyFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { generateConfig } from './scripts/gen-config.mjs';

const root = dirname(fileURLToPath(import.meta.url));

// Dependency order: every module only uses names defined above it.
const MODULES = [
  'calendar.js', 'storage.js', 'reminders.js', 'phone-location.js', 'importer.js', 'dashboard.js',
  'firebase-config.js', 'cloud.js', 'records.js', 'history.js', 'transcript.js', 'groq.js', 'minutes.js',
  'record-store.js', 'theme.js', 'xlsx-loader.js', 'ui.js', 'topbar-ui.js', 'dashboard-ui.js', 'settings-ui.js', 'history-ui.js', 'minutes-ui.js', 'app.js'
];

// Inlined in this order, each where index.html links it.
const STYLESHEETS = ['tokens.css', 'components.css', 'styles.css', 'nav.css', 'dashboard.css', 'responsive.css', 'features.css'];

const IMPORT_RE = /^import\s+[\s\S]*?from\s+'\.\/[\w.-]+';?[ \t]*\r?\n/gm;
const EXPORT_RE = /^export\s+(?=(?:default\s+)?(?:async\s+)?(?:function|class|const|let|var)\b)/gm;

/** Names a module declares with `export` — used to catch collisions. */
function exportedNames(source) {
  const names = [];
  const re = /^export\s+(?:async\s+)?(?:function|class|const|let|var)\s+([A-Za-z_$][\w$]*)/gm;
  let match;
  while ((match = re.exec(source))) names.push(match[1]);
  return names;
}

function bundleJs() {
  const seen = new Map();
  const chunks = [];

  for (const file of MODULES) {
    const source = readFileSync(join(root, 'js', file), 'utf8');

    for (const name of exportedNames(source)) {
      if (seen.has(name)) {
        throw new Error(
          `Export name collision: "${name}" is exported by both ${seen.get(name)} and ${file}. ` +
          'The flat bundle cannot keep both — rename one.'
        );
      }
      seen.set(name, file);
    }

    const stripped = source.replace(IMPORT_RE, '').replace(EXPORT_RE, '').trim();
    chunks.push(`// ---- js/${file} ----\n${stripped}`);
  }

  const leftover = chunks.join('\n\n').match(/^\s*(?:import|export)\s/m);
  if (leftover) throw new Error(`Residual module syntax survived stripping: ${leftover[0].trim()}`);

  // A module script waits for the page's `defer` scripts (the Firebase SDK);
  // this inlined classic script would run first and miss them. DOMContentLoaded
  // fires only after every deferred script has run, so start the app there.
  return `(function () {\n'use strict';\n\nfunction start() {\n${chunks.join('\n\n')}\n}\n\n` +
    `if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);\nelse start();\n\n})();`;
}

function build() {
  // js/firebase-config.js is generated from .env (git-ignored): always fresh.
  generateConfig();
  const html = readFileSync(join(root, 'index.html'), 'utf8');
  const js = bundleJs();

  const linkRe = file => new RegExp(`[ \\t]*<link rel="stylesheet" href="css/${file.replace('.', '\\.')}">`);
  const SCRIPT_RE = /[ \t]*<script type="module" src="js\/app\.js"><\/script>/;
  const tags = [...STYLESHEETS.map(file => [linkRe(file), `stylesheet link to css/${file}`]), [SCRIPT_RE, 'module script tag']];

  for (const [re, what] of tags) {
    if (!re.test(html)) {
      throw new Error(`index.html no longer has the ${what} build.mjs inlines — update build.mjs.`);
    }
  }

  let out = html;
  for (const file of STYLESHEETS) {
    const css = readFileSync(join(root, 'css', file), 'utf8').trim();
    out = out.replace(linkRe(file), () => `  <style>\n${css}\n  </style>`);
  }
  out = out.replace(SCRIPT_RE, () => `  <script>\n${js}\n  </script>`);

  const dist = join(root, 'dist');
  mkdirSync(dist, { recursive: true });
  writeFileSync(join(dist, 'index.html'), out, 'utf8');
  copyAssets(dist);
  checkLocalReferences(out, dist);
  return out;
}

// Crawlers and browsers look for these at the site root, whatever the page links.
const ROOT_FILES = ['favicon.ico', 'robots.txt', 'sitemap.xml'];

/** assets/* → dist/assets/ (same paths as the source), plus ROOT_FILES → dist/. */
function copyAssets(dist) {
  const target = join(dist, 'assets');
  mkdirSync(target, { recursive: true });
  for (const file of readdirSync(join(root, 'assets'))) {
    copyFileSync(join(root, 'assets', file), join(target, file));
  }
  for (const file of ROOT_FILES) copyFileSync(join(root, 'assets', file), join(dist, file));
}

/** Relative href/src values in the page (not http:, data:, //, # …), without ?query/#hash. */
function localReferences(html) {
  return [...html.matchAll(/<(?:link|img|script)\b[^>]*?\s(?:href|src)="([^"]+)"/g)]
    .map(m => m[1])
    .filter(url => !/^(?:[a-z][a-z0-9+.-]*:|\/\/|#)/i.test(url))
    .map(url => url.split(/[?#]/)[0]);
}

/**
 * Every relative href/src the page asks for, every icon the manifest lists
 * (relative to the manifest) and the root files must exist in dist/, or the
 * build fails.
 */
function checkLocalReferences(html, dist) {
  const missing = localReferences(html).filter(ref => !existsSync(join(dist, ref)));
  const manifestFile = join(dist, 'assets', 'manifest.webmanifest');
  if (!existsSync(manifestFile)) missing.push('assets/manifest.webmanifest');
  else {
    for (const icon of JSON.parse(readFileSync(manifestFile, 'utf8')).icons || []) {
      if (!existsSync(join(dist, 'assets', icon.src))) missing.push(`assets/${icon.src} (manifest)`);
    }
  }
  for (const file of ROOT_FILES) if (!existsSync(join(dist, file))) missing.push(file);
  if (missing.length) {
    throw new Error(`dist/ is missing files the page references: ${missing.join(', ')}. Run \`npm run icons\`?`);
  }
}

const written = build();
console.log(`dist/index.html written (${written.length} bytes) — open it directly in a browser.`);

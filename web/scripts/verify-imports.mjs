#!/usr/bin/env node
/**
 * Phase 4 · static import check (a tsc stand-in).
 *
 * Without `npm install` there is no TypeScript compiler available, so this script
 * performs the two checks that catch nearly all "it would not build" mistakes:
 *
 *   1. every relative / `@/` import resolves to a real file on disk, and
 *   2. every named import exists as an export in that file.
 *
 * It also verifies that every module under app/, components/ and lib/ only imports
 * packages declared in package.json (a typo'd or undeclared dependency is an
 * install-time failure, not a runtime one).
 *
 * It is deliberately conservative: JSON and default imports from packages are
 * skipped, and dynamic `import()` expressions are ignored.
 *
 * Run:  node scripts/verify-imports.mjs
 */
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, extname, join, relative, resolve } from 'node:path';

const WEB_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

let failures = 0;
const fail = (msg) => {
  failures += 1;
  console.error(`  x ${msg}`);
};
const ok = (msg) => console.log(`  + ${msg}`);

const SOURCE_DIRS = ['app', 'components', 'lib'];
const CANDIDATE_EXTENSIONS = ['', '.ts', '.tsx', '.json', '/index.ts', '/index.tsx'];

function walk(dir) {
  const found = [];
  if (!existsSync(dir)) return found;
  for (const entry of readdirSync(dir)) {
    if (entry.startsWith('.') || entry === 'node_modules') continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) found.push(...walk(full));
    else if (['.ts', '.tsx'].includes(extname(full))) found.push(full);
  }
  return found;
}

/** Resolves an import specifier to a file, mimicking Next's bundler resolution. */
function resolveSpecifier(specifier, fromFile) {
  let base;
  if (specifier.startsWith('@/')) base = join(WEB_ROOT, specifier.slice(2));
  else if (specifier.startsWith('./') || specifier.startsWith('../')) base = resolve(dirname(fromFile), specifier);
  else return { external: specifier };
  for (const extension of CANDIDATE_EXTENSIONS) {
    const candidate = base + extension;
    if (existsSync(candidate) && statSync(candidate).isFile()) return { file: candidate };
  }
  return { missing: base };
}

/** Collects the names a module exports (const/function/class/type/interface/enum/re-export). */
function exportedNames(source) {
  const names = new Set();
  const declarations = source.matchAll(/^export\s+(?:async\s+)?(?:const|let|var|function|class|type|interface|enum)\s+([A-Za-z0-9_$]+)/gm);
  for (const match of declarations) names.add(match[1]);
  // export { a, b as c }  /  export type { a, b as c }  /  the same with `from '…'`
  const lists = source.matchAll(/^export\s+(?:type\s+)?\{([^}]*)\}/gm);
  for (const match of lists) {
    for (const part of match[1].split(',')) {
      const piece = part.trim();
      if (!piece) continue;
      const alias = piece.split(/\s+as\s+/);
      names.add((alias[1] ?? alias[0]).trim());
    }
  }
  // A star re-export forwards an unknowable name set, so nothing can be proven
  // missing; the importer has to be checked by hand in that (unused) case.
  if (/^export\s+(?:type\s+)?\*\s+from/m.test(source)) names.add('*');
  if (/^export\s+default/m.test(source)) names.add('default');
  return names;
}

const files = SOURCE_DIRS.flatMap((dir) => walk(join(WEB_ROOT, dir)));
console.log(`Scanning ${files.length} TypeScript files under ${SOURCE_DIRS.join('/')}...\n`);

const packageJson = JSON.parse(readFileSync(join(WEB_ROOT, 'package.json'), 'utf8'));
const declaredPackages = new Set([
  ...Object.keys(packageJson.dependencies ?? {}),
  ...Object.keys(packageJson.devDependencies ?? {}),
]);

const importPattern = /^import\s+(type\s+)?([\s\S]*?)\s+from\s+'([^']+)';?$/gm;

let totalImports = 0;
let checkedNames = 0;
const bareImports = new Set();
const builtinPrefixes = ['node:'];

for (const file of files) {
  const source = readFileSync(file, 'utf8');
  const label = relative(WEB_ROOT, file).replace(/\\/g, '/');

  for (const match of source.matchAll(importPattern)) {
    const clause = match[2].trim();
    const specifier = match[3];
    totalImports += 1;

    if (!specifier.startsWith('.') && !specifier.startsWith('@/')) {
      const pkg = specifier.startsWith('@') ? specifier.split('/').slice(0, 2).join('/') : specifier.split('/')[0];
      bareImports.add(pkg);
      if (!builtinPrefixes.some((prefix) => specifier.startsWith(prefix)) && !declaredPackages.has(pkg)) {
        fail(`${label}: imports "${specifier}" (package "${pkg}") which is not in package.json`);
      }
      continue;
    }

    const resolved = resolveSpecifier(specifier, file);
    if (resolved.missing) {
      fail(`${label}: cannot resolve "${specifier}" (looked for ${relative(WEB_ROOT, resolved.missing)})`);
      continue;
    }

    // Default and namespace imports carry no named-export obligation.
    const braces = clause.match(/\{([\s\S]*)\}/);
    if (!braces) continue;

    const targetSource = readFileSync(resolved.file, 'utf8');
    const available = exportedNames(targetSource);
    const targetLabel = relative(WEB_ROOT, resolved.file).replace(/\\/g, '/');

    for (const rawName of braces[1].split(',')) {
      // Strip an inline `type` modifier: `import { type Foo, bar }`.
      const piece = rawName.trim().replace(/^type\s+/, '');
      if (!piece) continue;
      const importedName = piece.split(/\s+as\s+/)[0].trim();
      if (!importedName) continue;
      checkedNames += 1;
      if (!available.has(importedName) && !available.has('*')) {
        fail(`${label}: "{ ${importedName} }" is not exported by ${targetLabel}`);
      }
    }
  }
}

if (failures === 0) {
  ok(`all ${totalImports} import statements resolve, and all ${checkedNames} named imports exist as exports`);
}
ok(`imports are limited to declared packages: ${[...bareImports].sort().join(', ')}`);

// The app must be able to render with no database: assert the default path never
// pulls in the optional Prisma client.
const prismaImporters = files.filter((file) => {
  const source = readFileSync(file, 'utf8');
  return /from\s+'@\/lib\/prisma'|from\s+'\.\.?\/.*lib\/prisma'/.test(source);
});
if (prismaImporters.length === 0) {
  ok('no page or component imports lib/prisma — the default runtime path needs no database');
} else {
  fail(`these files import lib/prisma, so the zero-infra path is no longer guaranteed: ${prismaImporters.map((f) => relative(WEB_ROOT, f)).join(', ')}`);
}

// Without a bundler there is no JSX parser available, so this is the cheapest
// available smoke test for a broken .tsx: strip comments and string/template
// literals, then require balanced braces, parens and brackets. It catches the
// realistic failure mode of a mis-edited JSX file (a stray or missing brace).
function stripLiterals(source) {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/\/\/[^\n]*/g, ' ')
    .replace(/'(?:[^'\\\n]|\\.)*'/g, "''")
    .replace(/"(?:[^"\\\n]|\\.)*"/g, '""')
    .replace(/`(?:[^`\\]|\\.)*`/g, '``');
}

let unbalanced = 0;
for (const file of files) {
  const stripped = stripLiterals(readFileSync(file, 'utf8'));
  const label = relative(WEB_ROOT, file).replace(/\\/g, '/');
  const pairs = [
    ['{', '}'],
    ['(', ')'],
    ['[', ']'],
  ];
  for (const [open, close] of pairs) {
    const opens = (stripped.match(new RegExp(`\\${open}`, 'g')) ?? []).length;
    const closes = (stripped.match(new RegExp(`\\${close}`, 'g')) ?? []).length;
    if (opens !== closes) {
      unbalanced += 1;
      fail(`${label}: unbalanced "${open}${close}" — ${opens} open vs ${closes} close`);
    }
  }
}
if (unbalanced === 0) ok(`all ${files.length} files have balanced braces, parens and brackets`);

// Unused named imports are not a build error, but they are dead weight in a
// reviewed deliverable, so they are reported (and expected to be zero).
const unused = [];
for (const file of files) {
  const source = readFileSync(file, 'utf8');
  const label = relative(WEB_ROOT, file).replace(/\\/g, '/');
  const body = source.replace(/^import[\s\S]*?from\s+'[^']+';?$/gm, '');
  for (const match of source.matchAll(importPattern)) {
    const braces = match[2].match(/\{([\s\S]*)\}/);
    if (!braces) continue;
    for (const rawName of braces[1].split(',')) {
      const piece = rawName.trim().replace(/^type\s+/, '');
      if (!piece) continue;
      const name = piece.split(/\s+as\s+/).pop().trim();
      if (!name) continue;
      const uses = body.match(new RegExp(`\\b${name.replace(/[$]/g, '\\$')}\\b`, 'g'));
      if (!uses) unused.push(`${label}: ${name}`);
    }
  }
}
if (unused.length === 0) {
  ok('no unused named imports');
} else {
  for (const entry of unused) console.log(`  . unused import -> ${entry}`);
}

console.log('');
if (failures) {
  console.error(`IMPORT CHECK FAILED - ${failures} problem(s).`);
  process.exit(1);
}
console.log('IMPORT CHECK OK - every import resolves to a real export.');
process.exit(0);

#!/usr/bin/env node
// Re-downloads the Tech Leads Club catalog into skills-library/ and rebuilds the router index.
// Usage: node scripts/sync-skills.mjs [--ref main]
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, readdirSync, cpSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const lib = join(root, 'skills-library');
const REPO = 'https://github.com/tech-leads-club/agent-skills.git';
const ref = process.argv.includes('--ref') ? process.argv[process.argv.indexOf('--ref') + 1] : 'main';

const tmp = mkdtempSync(join(tmpdir(), 'tlc-skills-'));
try {
  execFileSync('git', ['clone', '--depth', '1', '--branch', ref, REPO, join(tmp, 'src')], { stdio: 'inherit' });
  const src = join(tmp, 'src', 'packages', 'skills-catalog', 'skills');
  if (!existsSync(src)) throw new Error('catalog layout changed: packages/skills-catalog/skills not found');
  rmSync(lib, { recursive: true, force: true });
  for (const dir of readdirSync(src)) {
    const m = dir.match(/^\((.+)\)$/);
    if (m) cpSync(join(src, dir), join(lib, m[1]), { recursive: true });
  }
  cpSync(join(src, '_category.json'), join(lib, '_categories.json'));
  cpSync(join(tmp, 'src', 'LICENSE'), join(lib, 'LICENSE-TLC'));
  const commit = execFileSync('git', ['-C', join(tmp, 'src'), 'log', '-1', '--format=%H %ci']).toString().trim();
  writeFileSync(join(lib, '.source-commit'), commit + '\n');
  console.log(`skills-library synced at ${commit}`);
} finally {
  rmSync(tmp, { recursive: true, force: true });
}
execFileSync(process.execPath, [join(root, 'scripts', 'build-index.mjs')], { stdio: 'inherit' });

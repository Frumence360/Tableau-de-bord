#!/usr/bin/env node
/**
 * Installe le hook git pre-commit (garde-fou anti-secrets).
 * Usage : npm run setup-hooks
 *
 * Le hook n'est pas versionné par git (il vit dans .git/hooks/), donc ce script
 * le réinstalle à partir de sa copie versionnée dans scripts/pre-commit.
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const GIT_CANDIDATES = [
  'git',
  'C:\\Program Files\\Git\\cmd\\git.exe',
  'C:\\Program Files (x86)\\Git\\cmd\\git.exe',
  path.join(process.env.LOCALAPPDATA || '', 'Programs', 'Git', 'cmd', 'git.exe')
];

function resolveGit() {
  for (const c of GIT_CANDIDATES) {
    try {
      execSync(`"${c}" --version`, { stdio: 'ignore' });
      return c;
    } catch { /* suivant */ }
  }
  return null;
}

const git = resolveGit();
if (!git) {
  console.error('✖ git introuvable : impossible d\'installer le hook.');
  process.exit(1);
}

// Localise le dossier .git (utile aussi si le repo est un worktree).
const gitDir = execSync(`"${git}" rev-parse --git-dir`, { encoding: 'utf8' }).trim();
const hooksDir = path.join(gitDir, 'hooks');

if (!fs.existsSync(hooksDir)) {
  fs.mkdirSync(hooksDir, { recursive: true });
}

const source = path.join(__dirname, 'pre-commit');
const target = path.join(hooksDir, 'pre-commit');

fs.copyFileSync(source, target);
fs.chmodSync(target, 0o755);

console.log(`✔ Hook pre-commit installé : ${target}`);
console.log('  Le contrôle anti-secrets s\'exécutera désormais à chaque commit.');

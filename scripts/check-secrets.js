#!/usr/bin/env node
/**
 * Garde-fou anti-fuite de secrets.
 * ---------------------------------
 * Vérifie que les fichiers versionnés (suivis par git) ne contiennent pas de
 * vraies credentials. Objectif principal : éviter qu'une vraie DATABASE_URL,
 * un mot de passe ou un secret JWT ne se retrouve dans un commit.
 *
 * Usage : npm run check-secrets   (code de sortie 1 si un problème est détecté)
 */

const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

// Sur certaines machines Windows, git n'est pas dans le PATH. On tente de le
// localiser aux emplacements d'installation courants avant d'abandonner.
const GIT_CANDIDATES = [
  'git',
  'C:\\Program Files\\Git\\cmd\\git.exe',
  'C:\\Program Files (x86)\\Git\\cmd\\git.exe',
  path.join(process.env.LOCALAPPDATA || '', 'Programs', 'Git', 'cmd', 'git.exe'),
  path.join(process.env.ProgramFiles || '', 'Git', 'bin', 'git.exe')
];

function resolveGit() {
  for (const candidate of GIT_CANDIDATES) {
    try {
      execSync(`"${candidate}" --version`, { stdio: 'ignore' });
      return candidate;
    } catch {
      // on essaie le suivant
    }
  }
  return null;
}

const GIT = resolveGit();

// Fichiers de configuration qui, par convention, ne doivent contenir QUE des
// placeholders. On les analyse en priorité avec des règles plus strictes.
const EXAMPLE_FILES = ['.env.example'];

// Fichiers sensibles qui ne doivent JAMAIS être versionnés.
const FORBIDDEN_FILES = ['.env', '.env.local', '.env.production'];

// Hôtes locaux / placeholders : une URL pointant vers eux n'est pas une fuite.
const SAFE_HOSTS = /^(?:localhost|127\.0\.0\.1|0\.0\.0\.0|db|postgres|hote|host|utilisateur|user|example\.com|your-host|votre-hote)$/i;

// Motifs de fuite : chaque règle décrit un secret réel potentiel.
const RULES = [
  {
    name: 'DATABASE_URL vers un hôte distant (hébergeur managé)',
    // postgres://user:pass@HOST/... — on ne retient que les vrais domaines
    // distants, pas les placeholders ni les hôtes locaux d'un docker-compose.
    regex: /postgres(?:ql)?:\/\/([^\s:@/]+):([^\s@/]+)@([A-Za-z0-9._-]+)/g,
    // Vérification fine : on ignore si l'hôte est local/placeholder.
    keep: (host) => !SAFE_HOSTS.test(host) && host.includes('.')
  },
  {
    name: 'Endpoints de base hébergée (Neon, Supabase, etc.)',
    regex: /(?:ep-[a-z0-9-]+\.(?:aws|azure|gcp)\.neon\.tech|db\.[a-z0-9]+\.supabase\.co|[a-z0-9-]+\.render\.com|[a-z0-9-]+\.railway\.app)/g
  },
  {
    name: 'Jeton de fournisseur de base hébergée (Neon, Supabase...)',
    // Identifiants du type npg_<long jeton> (Neon) ou neondb_owner:npg_<long jeton>.
    // On exige une longueur réaliste : un placeholder court comme "npg_xxx"
    // (utilisé dans ce fichier à titre d'exemple) ne doit pas déclencher.
    regex: /\bnpg_[A-Za-z0-9]{16,}\b/g
  },
  {
    name: 'Clé API / token à longue chaîne (sk-, ghp_, AKIA...)',
    regex: /\b(?:sk-[A-Za-z0-9]{16,}|gh[pousr]_[A-Za-z0-9]{20,}|AKIA[0-9A-Z]{16})\b/g
  }
];

const RED = '\x1b[31m';
const GREEN = '\x1b[32m';
const YELLOW = '\x1b[33m';
const DIM = '\x1b[2m';
const RESET = '\x1b[0m';

function git(cmd) {
  if (!GIT) throw new Error('git introuvable');
  return execSync(`"${GIT}" ${cmd}`, { encoding: 'utf8' }).trim();
}

function listTrackedFiles() {
  const out = git('ls-files');
  return out ? out.split(/\r?\n/).filter(Boolean) : [];
}

function main() {
  let failed = false;

  if (!GIT) {
    console.error(`${YELLOW}⚠ check-secrets : git est introuvable, vérification ignorée.${RESET}`);
    return;
  }

  // 1. Aucun fichier .env réel ne doit être versionné.
  const tracked = listTrackedFiles();
  for (const forbidden of FORBIDDEN_FILES) {
    if (tracked.includes(forbidden)) {
      console.error(`${RED}✖ ${forbidden} est versionné par git ! Il doit être dans .gitignore et retiré de l'index.${RESET}`);
      failed = true;
    }
  }

  // 2. On analyse le contenu des fichiers versionnés.
  //    - Dans .env.example : toute URL de base doit pointer vers localhost.
  //    - Partout : détection de jetons/URL d'hébergeurs distants.
  const filesToScan = tracked.filter((f) => {
    if (f.startsWith('node_modules/') || f === 'package-lock.json') return false;
    if (/\.(png|jpg|jpeg|gif|webp|ico|pdf|woff2?|ttf|eot)$/i.test(f)) return false;
    return true;
  });

  for (const file of filesToScan) {
    let content;
    try {
      content = fs.readFileSync(file, 'utf8');
    } catch {
      continue; // fichier binaire illisible en utf8 : ignoré
    }

    const isExample = EXAMPLE_FILES.includes(file);

    for (const rule of RULES) {
      const matches = content.match(rule.regex);
      if (!matches) continue;

      // On écarte les faux positifs : selon la règle, on teste l'hôte capturé
      // ou le match entier (localhost, placeholders, images Docker...).
      const realLeaks = matches.filter((m) => {
        if (/localhost|127\.0\.0\.1/.test(m)) return false;
        if (rule.keep) {
          const host = m.replace(/^postgres(?:ql)?:\/\/[^@]+@/, '');
          return rule.keep(host);
        }
        return true;
      });
      if (realLeaks.length === 0) continue;

      console.error(
        `${RED}✖ ${file}${RESET} — ${rule.name}${isExample ? ' (un fichier .example ne doit contenir que des placeholders)' : ''}`
      );
      for (const leak of realLeaks.slice(0, 5)) {
        // On masque la partie sensible dans l'affichage.
        const masked = leak.length > 24 ? leak.slice(0, 12) + '…' + leak.slice(-4) : leak;
        console.error(`  ${DIM}ligne suspecte : ${masked}${RESET}`);
      }
      failed = true;
    }
  }

  if (failed) {
    console.error('');
    console.error(`${RED}Commit bloqué : des secrets potentiels ont été détectés.${RESET}`);
    console.error(`${YELLOW}→ Vérifie les fichiers ci-dessus. Les vraies valeurs vont dans .env (non versionné),${RESET}`);
    console.error(`${YELLOW}  et .env.example ne doit contenir que des exemples (localhost, placeholder...).${RESET}`);
    process.exit(1);
  }

  console.log(`${GREEN}✔ check-secrets : aucun secret détecté dans les fichiers versionnés.${RESET}`);
}

main();

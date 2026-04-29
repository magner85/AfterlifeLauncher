#!/usr/bin/env node
const { execFileSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const DEFAULT_SYNC_NAME = 'magner85';
const DEFAULT_SYNC_EMAIL = 'magner85@mail.ru';

function resolveGitBinary() {
  const candidates = [
    'C:\\Program Files\\Git\\cmd\\git.exe',
    'C:\\Program Files\\Git\\bin\\git.exe',
    'C:\\Program Files (x86)\\Git\\cmd\\git.exe',
    'C:\\Program Files (x86)\\Git\\bin\\git.exe',
    process.env.GIT_BIN,
    'git',
    'git.exe'
  ].filter(Boolean);

  for (const c of candidates) {
    try {
      if (c.endsWith('.exe') && !fs.existsSync(c)) continue;
      execFileSync(c, ['--version'], { stdio: 'ignore' });
      return c;
    } catch {}
  }
  return 'git';
}

const gitBin = resolveGitBinary();
let commitIdentity = null;

function runGit(args, options = {}) {
  const env = {
    ...process.env,
    ...(commitIdentity
      ? {
          GIT_AUTHOR_NAME: commitIdentity.name,
          GIT_AUTHOR_EMAIL: commitIdentity.email,
          GIT_COMMITTER_NAME: commitIdentity.name,
          GIT_COMMITTER_EMAIL: commitIdentity.email
        }
      : {}),
    ...(options.env || {})
  };
  const out = execFileSync(gitBin, args, {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    env,
    ...options
  });
  if (typeof out === 'string') return out.trim();
  return '';
}

function safeRunGit(args, fallback = '') {
  try {
    return runGit(args);
  } catch {
    return fallback;
  }
}

function parseModeArg() {
  const a = process.argv.find((x) => x.startsWith('--mode='));
  return a ? a.slice('--mode='.length) : 'manual';
}

function ensureGitContext() {
  try {
    const inside = runGit(['rev-parse', '--is-inside-work-tree']);
    if (inside !== 'true') throw new Error('not git');
  } catch (e) {
    throw new Error(`Git repository not found or git is unavailable (${gitBin}). ${String(e.message || e)}`);
  }
}

function ensureIdentity() {
  const name =
    safeRunGit(['config', 'user.name']) ||
    process.env.ALPHA_SYNC_GIT_NAME ||
    process.env.GIT_AUTHOR_NAME ||
    DEFAULT_SYNC_NAME;
  const email =
    safeRunGit(['config', 'user.email']) ||
    process.env.ALPHA_SYNC_GIT_EMAIL ||
    process.env.GIT_AUTHOR_EMAIL ||
    DEFAULT_SYNC_EMAIL;
  if (!name || !email) {
    throw new Error('git user.name / user.email are not configured for this repository.');
  }
  commitIdentity = { name, email };
}

function getChangedFiles() {
  const out = safeRunGit(['status', '--porcelain']);
  if (!out) return [];
  return out
    .split(/\r?\n/)
    .map((l) => l.trimEnd())
    .filter(Boolean)
    .map((l) => l.slice(3).trim());
}

function makeCommitMessage(mode, branch, files, diffStat) {
  const now = new Date().toISOString();
  const limited = files.slice(0, 120);
  const fileLines = limited.length ? limited.map((f) => `- ${f}`).join('\n') : '- (none)';
  const clipped = files.length > limited.length ? `\n- ... and ${files.length - limited.length} more` : '';
  return [
    `auto(alpha): sync on ${mode}`,
    '',
    `Mode: ${mode}`,
    `Timestamp (UTC): ${now}`,
    `Source branch: ${branch}`,
    `Files changed: ${files.length}`,
    '',
    'Changed files:',
    `${fileLines}${clipped}`,
    '',
    'Diffstat:',
    diffStat || '(no diffstat available)'
  ].join('\n');
}

function main() {
  const mode = parseModeArg();
  ensureGitContext();
  ensureIdentity();

  const changedBefore = getChangedFiles();
  if (!changedBefore.length) {
    console.log('[sync-alpha] No changes detected, skip.');
    return;
  }

  const branch = safeRunGit(['rev-parse', '--abbrev-ref', 'HEAD'], 'unknown');
  runGit(['add', '-A']);

  const diffStat = safeRunGit(['diff', '--cached', '--stat']);
  const changedAfter = getChangedFiles();
  const msg = makeCommitMessage(mode, branch, changedAfter.length ? changedAfter : changedBefore, diffStat);

  const tmpFile = path.join(os.tmpdir(), `afterlife-alpha-commit-${Date.now()}.txt`);
  fs.writeFileSync(tmpFile, msg, 'utf8');
  try {
    runGit(['commit', '-F', tmpFile], { stdio: 'inherit' });
  } finally {
    try {
      fs.unlinkSync(tmpFile);
    } catch {}
  }

  runGit(['push', 'origin', 'HEAD:alpha'], { stdio: 'inherit' });
  console.log('[sync-alpha] Pushed to origin/alpha.');
}

try {
  main();
} catch (err) {
  console.error(`[sync-alpha] ${err.message || err}`);
  process.exit(1);
}

/**
 * PreToolUse hook — auto-bumps frontend/package.json patch version
 * before every `git push` command issued by Claude Code.
 *
 * Flow:
 *   1. Claude runs: git push [...]
 *   2. This hook fires, reads the push command from stdin JSON
 *   3. Patch version in frontend/package.json is incremented
 *   4. git add + git commit are run
 *   5. Hook exits 0 → git push proceeds (now includes the bump commit)
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

// Project root = two levels up from .claude/hooks/
const projectRoot = resolve(fileURLToPath(import.meta.url), '../../..');

const chunks = [];
process.stdin.on('data', (c) => chunks.push(c));
process.stdin.on('end', () => {
  let input = {};
  try { input = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}'); } catch {}

  const cmd = input.tool_input?.command ?? '';

  // Match only when the command ITSELF is git push (e.g. "git push", "git -C /path push origin master").
  // Avoid false positives from commit messages that contain the text "git push".
  if (!/^\s*git(\s+-C\s+\S+)?\s+push\b/.test(cmd)) process.exit(0);

  try {
    const pkgPath = resolve(projectRoot, 'frontend', 'package.json');
    const content = readFileSync(pkgPath, 'utf8');
    const pkg = JSON.parse(content);

    const parts = pkg.version.split('.').map(Number);
    parts[2] += 1;
    const newVersion = parts.join('.');
    pkg.version = newVersion;

    // Write back preserving 2-space indent
    writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + '\n', 'utf8');

    const git = (args) =>
      execSync(`git -C "${projectRoot}" ${args}`, { stdio: 'pipe' });

    git('add frontend/package.json');
    git(`commit -m "chore: bump version to ${newVersion}"`);

    process.stderr.write(`[bump-version] ${pkg.version.replace(/\d+$/, (n) => n - 1)} → ${newVersion}\n`);
  } catch (err) {
    // Non-fatal: log and let the push proceed anyway
    process.stderr.write(`[bump-version] skipped: ${err.message}\n`);
  }

  process.exit(0);
});

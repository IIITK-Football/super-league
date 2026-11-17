#!/usr/bin/env node
// commit-msg: validates only; never rewrites the message.
import { readFileSync } from 'node:fs';
import { validateCommitMessage } from './lib.mjs';

const r = validateCommitMessage(readFileSync(process.argv[2], 'utf8'));
for (const h of r.hints) console.error(h);
if (!r.ok) {
  console.error('commit-msg: message rejected (Conventional Commits):\n  - ' + r.errors.join('\n  - '));
  console.error('\nEdit the message and commit again.');
  process.exit(1);
}

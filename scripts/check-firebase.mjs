// `npm run check:firebase` — refuses to deploy a half-configured app.
// Runs before `npm run deploy`; exits 1 with a message saying what to fill in.
// Reads .env (+ environment variables) directly, the same way the build does.
// PIPELINE_ENV_FILE points it at another .env (tests use this).

import { readFileSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readEnv, configFromEnv, missingKeys } from './gen-config.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

export const FILL_IN_ENV = 'Fill in .env (copy .env.example): see README → Firebase setup';

/** What is wrong with the .env values and .firebaserc; [] when ready to deploy. */
export function firebaseSetupProblems(values, firebaserc) {
  const problems = [];
  const missing = missingKeys(values);
  if (missing.length) problems.push(`${FILL_IN_ENV}. Missing: ${missing.join(', ')}.`);
  const config = configFromEnv(values);
  const project = firebaserc && firebaserc.projects && firebaserc.projects.default;
  if (!project || /^YOUR_/.test(project)) {
    problems.push('.firebaserc: "default" is still YOUR_PROJECT_ID. Put your Firebase project ID there.');
  } else if (config.projectId && config.projectId !== project) {
    problems.push(`.firebaserc project "${project}" does not match FIREBASE_PROJECT_ID "${config.projectId}" in .env.`);
  }
  return problems;
}

function main() {
  const firebaserc = JSON.parse(readFileSync(join(root, '.firebaserc'), 'utf8'));
  const envFile = process.env.PIPELINE_ENV_FILE || join(root, '.env');
  const problems = firebaseSetupProblems(readEnv({ envFile }), firebaserc);

  if (problems.length) {
    console.error('Firebase is not set up yet, so nothing was deployed:\n');
    for (const p of problems) console.error(`  - ${p}`);
    process.exitCode = 1;
  } else {
    console.log(`Firebase config OK for project "${firebaserc.projects.default}".`);
  }
}

// Run only when executed directly, so tests can import firebaseSetupProblems.
if (resolve(process.argv[1] || '') === fileURLToPath(import.meta.url)) main();

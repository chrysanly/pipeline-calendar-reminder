// Firebase Hosting / Firestore setup files. Node-only (reads files, runs the
// check script); tests.html skips this file.

import { test, assert, assertEqual } from './runner.js';
import { readFileSync, writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { execFileSync } from 'node:child_process';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { firebaseSetupProblems, FILL_IN_ENV } from '../scripts/check-firebase.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = name => readFileSync(join(root, name), 'utf8');

test('firestore.rules only lets a user touch users/{their uid}/…', () => {
  const rules = read('firestore.rules');
  assert(rules.includes("rules_version = '2'"), 'rules v2');
  assert(/match \/users\/\{uid\}\/\{doc=\*\*\}/.test(rules), 'no users/{uid}/{doc=**} match');
  assert(/allow read, write: if request\.auth != null && request\.auth\.uid == uid;/.test(rules), 'no uid check');
  // Besides users/{uid}, only the client portal is reachable.
  const outside = rules.replace(/match \/users\/\{uid\}\/\{doc=\*\*\} \{[^}]*\}/, '');
  const matches = [...outside.matchAll(/match \/([^ ]+) \{/g)].map(m => m[1]);
  assertEqual(JSON.stringify(matches), JSON.stringify(['databases/{database}/documents', 'portals/{token}', 'replies/{replyId}']), 'unexpected match block');
  assert(!/if true/.test(rules), 'rules must never allow everything');
  assert(!/allow (?:read|list|write)[^;]*;/.test(outside.replace(/allow read, delete: if signedIn\(\) && portalOwner\(\) == request\.auth\.uid;/, '')), 'portal pages must not be listable or freely writable');
});

test('firestore.rules: a portal page is read by its link only and written by its owner only', () => {
  const rules = read('firestore.rules');
  assert(/allow get: if token\.matches\('\^\[0-9a-f\]\{32\}\$'\);/.test(rules), 'get by a 32-hex token');
  assert(/allow create: if signedIn\(\) && request\.resource\.data\.ownerUid == request\.auth\.uid;/.test(rules), 'create as yourself');
  assert(/allow update: if isOwner\(\) && request\.resource\.data\.ownerUid == request\.auth\.uid;/.test(rules), 'update keeps the owner');
  assert(/allow delete: if isOwner\(\);/.test(rules), 'owner deletes');
  assert(/resource\.data\.ownerUid == request\.auth\.uid/.test(rules), 'isOwner checks the stored owner');
  assert(/keys\(\)\.hasOnly\(\['type', 'itemId', 'name', 'message', 'createdAt'\]\)/.test(rules), 'replies limited to known fields');
});

test('firebase.json serves the single-file build and deploys the rules', () => {
  const config = JSON.parse(read('firebase.json'));
  assertEqual(config.hosting.public, 'dist');
  assert(config.hosting.predeploy.includes('npm run build'), 'build must run before deploy');
  assertEqual(config.hosting.rewrites[0].destination, '/index.html');
  assert(JSON.stringify(config.hosting.headers).includes('no-cache'), 'index.html must not be cached');
  assertEqual(config.firestore.rules, 'firestore.rules');
});

test('npm run deploy checks the setup before calling firebase', () => {
  const { scripts } = JSON.parse(read('package.json'));
  assert(scripts.deploy.startsWith('npm run check:firebase && '), scripts.deploy);
  assert(scripts.deploy.includes('npx --yes firebase-tools deploy --only hosting,firestore:rules'), 'deploy runs the CLI through npx');
});

/** Run check:firebase against a given .env file and environment. */
function runCheck(envFile, extraEnv = {}) {
  const env = { ...process.env, PIPELINE_ENV_FILE: envFile, ...extraEnv };
  for (const key of Object.keys(env)) if (key.startsWith('FIREBASE_') && !(key in extraEnv)) delete env[key];
  try {
    const stdout = execFileSync(process.execPath, ['scripts/check-firebase.mjs'], { cwd: root, stdio: 'pipe', env });
    return { status: 0, out: String(stdout) };
  } catch (err) {
    return { status: err.status, out: String(err.stderr) };
  }
}

const tmp = mkdtempSync(join(tmpdir(), 'pipeline-check-'));
const project = JSON.parse(read('.firebaserc')).projects.default;
const FULL = [
  'FIREBASE_API_KEY=test-key', 'FIREBASE_AUTH_DOMAIN=demo.firebaseapp.com', `FIREBASE_PROJECT_ID=${project}`,
  'FIREBASE_STORAGE_BUCKET=demo.appspot.com', 'FIREBASE_MESSAGING_SENDER_ID=1', 'FIREBASE_APP_ID=1:1:web:1'
].join('\n');

test('check:firebase fails with "Fill in .env" when .env is missing or blank', () => {
  for (const [label, file] of [['missing', join(tmp, 'nope.env')], ['blank', join(tmp, 'blank.env')]]) {
    if (label === 'blank') writeFileSync(file, readFileSync(join(root, '.env.example')));
    const { status, out } = runCheck(file);
    assertEqual(status, 1, `${label} .env should fail`);
    assert(out.includes(FILL_IN_ENV), `${label}: ${out}`);
    assert(out.includes('FIREBASE_API_KEY'), `${label}: names the missing key: ${out}`);
  }
});

test('check:firebase passes with a full .env, or when environment variables fill it', () => {
  const file = join(tmp, 'full.env');
  writeFileSync(file, FULL);
  assertEqual(runCheck(file).status, 0, runCheck(file).out);
  const fromEnv = runCheck(join(tmp, 'nope.env'), {
    FIREBASE_API_KEY: 'k', FIREBASE_PROJECT_ID: project, FIREBASE_APP_ID: '1:1:web:1'
  });
  assertEqual(fromEnv.status, 0, fromEnv.out);
});

test('firebaseSetupProblems names each missing piece', () => {
  const values = { FIREBASE_API_KEY: 'k', FIREBASE_PROJECT_ID: 'client-calendar', FIREBASE_APP_ID: '1' };
  const rc = p => ({ projects: { default: p } });
  assertEqual(firebaseSetupProblems({}, rc('YOUR_PROJECT_ID')).length, 2);
  assert(firebaseSetupProblems({}, rc('client-calendar'))[0].startsWith(FILL_IN_ENV));
  assert(firebaseSetupProblems(values, rc('YOUR_PROJECT_ID'))[0].includes('.firebaserc'));
  assert(firebaseSetupProblems(values, rc('other-project'))[0].includes('does not match'));
  assertEqual(firebaseSetupProblems(values, rc('client-calendar')).length, 0);
});

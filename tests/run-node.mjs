// Headless test entry point: `node tests/run-node.mjs`
// The browser entry point is tests/tests.html — both share tests/runner.js.

import './calendar.test.js';
import './storage.test.js';
import './reminders.test.js';
import './theme.test.js';
import './phone-location.test.js';
import './dashboard.test.js';
import './ui-pure.test.js';
import './importer.test.js';
import './importer.xlsx.test.js';
import { cloudTestsDone } from './cloud.test.js';
import { configTestsDone } from './config.test.js';
import './deploy.test.js';
import './build.test.js';
import { report } from './runner.js';

await cloudTestsDone;
await configTestsDone;
const { failed } = report();
process.exitCode = failed ? 1 : 0;

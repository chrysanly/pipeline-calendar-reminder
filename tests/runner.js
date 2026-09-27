// Tiny dependency-free test runner. Works in the browser and in Node.

const results = [];

export function test(name, fn) {
  try {
    fn();
    results.push({ name, ok: true });
  } catch (err) {
    results.push({ name, ok: false, message: err && err.message ? err.message : String(err) });
  }
}

/** Record a test that cannot run here (e.g. an optional fixture is absent). Not a failure. */
export function skip(name, reason) {
  results.push({ name, ok: true, skipped: true, message: reason });
}

export function assert(cond, message = 'expected truthy value') {
  if (!cond) throw new Error(message);
}

export function assertEqual(actual, expected, message) {
  if (actual !== expected) {
    throw new Error(message || `expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  }
}

export function assertDeepEqual(actual, expected, message) {
  const a = JSON.stringify(actual);
  const b = JSON.stringify(expected);
  if (a !== b) throw new Error(message || `expected ${b}, got ${a}`);
}

export function report() {
  const skipped = results.filter(r => r.skipped).length;
  const passed = results.filter(r => r.ok && !r.skipped).length;
  const failed = results.filter(r => !r.ok).length;
  const ran = results.length - skipped;
  const summary = { passed, failed, skipped, total: ran, results };
  const label = r => (r.skipped ? 'SKIP' : r.ok ? 'PASS' : 'FAIL');
  const detail = r => (r.skipped || !r.ok ? ` — ${r.message}` : '');
  const tally = `${passed}/${ran} passed, ${failed} failed${skipped ? `, ${skipped} skipped` : ''}`;

  for (const r of results) console.log(`${label(r)}  ${r.name}${detail(r)}`);
  console.log(`\n${tally}`);

  if (typeof document !== 'undefined') {
    const host = document.querySelector('#results');
    if (host) {
      host.innerHTML = '';
      for (const r of results) {
        const li = document.createElement('li');
        li.className = r.skipped ? 'skip' : r.ok ? 'pass' : 'fail';
        li.textContent = `${label(r)} ${r.name}${detail(r)}`;
        host.appendChild(li);
      }
    }
    const sum = document.querySelector('#summary');
    if (sum) {
      sum.textContent = tally;
      sum.className = failed ? 'fail' : 'pass';
    }
    window.__testResults = summary;
  }

  return summary;
}

/** Minimal localStorage stand-in for storage tests. */
export function fakeStorage(initial = {}) {
  const data = { ...initial };
  return {
    getItem: key => (key in data ? data[key] : null),
    setItem: (key, value) => { data[key] = String(value); },
    removeItem: key => { delete data[key]; },
    _data: data
  };
}

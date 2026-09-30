import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join, sep } from 'node:path';
import test from 'node:test';

/**
 * Rule R31: a change updates the docs it affects, in the same change.
 *
 * A rule nobody checks is a rule nobody follows. These tests are deliberately
 * cheap and deliberately strict: they fail when a document goes missing, when a
 * documented fact stops matching the code, or when a fix lands without being
 * written down. They do not check prose quality, only that the documentation is
 * present and true.
 */

const ROOT = process.cwd();
const KPIS = 'docs/KPIS.md';
const DOCS = [
  'PRD.md',
  'ARCHITECTURE.md',
  'RULES.md',
  'DESIGN.md',
  'TASKS.md',
  'DASHBOARD.md',
  'MEMORY.md',
  'FIX.md',
  'VERIFICATION.md',
  'README.md',
  KPIS
];

/** Normalises a path to forward slashes, the way documents always write them. */
function posix(p: string): string {
  return p.split(sep).join('/');
}

test('every required document exists and is not a stub', () => {
  const problems: string[] = [];
  for (const doc of DOCS) {
    const full = join(ROOT, doc);
    if (!existsSync(full)) {
      problems.push(doc + ' is missing');
      continue;
    }
    const body = readFileSync(full, 'utf-8').trim();
    if (body.length < 400) {
      problems.push(doc + ' is only ' + body.length + ' chars, too thin to be useful');
    }
    // A document must state when it was last reviewed, or it will silently rot.
    if (!/last (updated|reviewed)/i.test(body)) {
      problems.push(doc + ' has no "Last updated" marker');
    }
  }
  assert.deepEqual(problems, []);
});

test('the document index in README lists every document', () => {
  const readme = readFileSync(join(ROOT, 'README.md'), 'utf-8');
  const missing = DOCS
    .map(posix)
    .filter(doc => doc !== 'README.md') // a README need not link to itself
    .filter(doc => !readme.includes(doc));
  assert.deepEqual(missing, [], 'README does not reference: ' + missing.join(', '));
});

test('RULES.md defines the documentation rule and covers every document', () => {
  const rules = readFileSync(join(ROOT, 'RULES.md'), 'utf-8');
  assert.match(rules, /R31\./, 'the documentation rule must be numbered R31');
  const missing = DOCS.map(posix).filter(doc => !rules.includes(doc));
  assert.deepEqual(missing, [], 'RULES.md does not say which changes update: ' + missing.join(', '));
});

test('the test counts quoted in DASHBOARD.md match reality', () => {
  // A dashboard that overstates coverage is worse than no dashboard.
  let total = 0;
  for (const file of readdirSync(join(ROOT, 'tests')).filter(f => f.endsWith('.test.ts'))) {
    const body = readFileSync(join(ROOT, 'tests', file), 'utf-8');
    total += (body.match(/^\s*test\(/gm) ?? []).length;
  }
  const dash = readFileSync(join(ROOT, 'DASHBOARD.md'), 'utf-8');
  const claimed = dash.match(/(\d+)\s*\/\s*(\d+)\s*passing/);
  assert.ok(claimed, 'DASHBOARD.md must state the passing test count');
  assert.equal(
    Number(claimed[2]),
    total,
    'DASHBOARD.md claims ' + claimed[2] + ' tests; ' + total + ' exist in tests/'
  );
});

test('every test suite is listed in DASHBOARD.md coverage', () => {
  const dash = readFileSync(join(ROOT, 'DASHBOARD.md'), 'utf-8');
  const missing = readdirSync(join(ROOT, 'tests'))
    .filter(f => f.endsWith('.test.ts'))
    .filter(f => !dash.includes(f));
  assert.deepEqual(missing, [], 'DASHBOARD.md does not list these suites: ' + missing.join(', '));
});

test('every bug in FIX.md is numbered and states a status', () => {
  const fix = readFileSync(join(ROOT, 'FIX.md'), 'utf-8');
  const headings = [...fix.matchAll(/^## #(\d+)\s+·\s+(.+)$/gm)];
  assert.ok(headings.length > 0, 'FIX.md must contain numbered bug entries');
  for (const [, num, title] of headings) {
    assert.ok(title.trim().length > 5, 'bug #' + num + ' needs a descriptive title');
  }
  const statuses = [...fix.matchAll(/\*\*Status\*\*\s*([A-Za-z][A-Za-z ]*)/g)];
  assert.equal(
    statuses.length,
    headings.length,
    'every bug needs a Status; found ' + statuses.length + ' for ' + headings.length + ' bugs'
  );
  for (const [, status] of statuses) {
    assert.ok(/fixed|partial|open|wont/i.test(status), 'unrecognised status: ' + status.trim());
  }
});

test('the summary table in FIX.md counts every bug entry', () => {
  const fix = readFileSync(join(ROOT, 'FIX.md'), 'utf-8');
  const rows = [...fix.matchAll(/^\|\s*(\d+)\s*\|/gm)].map(m => Number(m[1]));
  const headings = [...fix.matchAll(/^## #(\d+)/gm)].map(m => Number(m[1]));
  const unlisted = headings.filter(n => !rows.includes(n));
  assert.deepEqual(unlisted, [], 'missing from the summary table: ' + unlisted.join(', '));
});

test('blockers in DASHBOARD.md name the owner action where one is needed', () => {
  const dash = readFileSync(join(ROOT, 'DASHBOARD.md'), 'utf-8');
  assert.match(dash, /Blockers/i, 'DASHBOARD.md must have a blockers section');
  // The known blocker is storage; it must state the exact URL the owner visits.
  assert.match(
    dash,
    /integrations\/accept-terms/,
    'the storage blocker must name the exact URL the owner must visit'
  );
});

test('documented component inventory matches the components that exist', () => {
  const dir = join(ROOT, 'src', 'components');
  const actual: string[] = [];
  const walk = (d: string) => {
    for (const name of readdirSync(d)) {
      const full = join(d, name);
      if (statSync(full).isDirectory()) walk(full);
      else if (name.endsWith('.tsx')) actual.push(name.replace(/\.tsx$/, ''));
    }
  };
  walk(dir);
  const design = readFileSync(join(ROOT, 'DESIGN.md'), 'utf-8');
  const undocumented = actual.filter(c => !design.includes(c));
  assert.deepEqual(
    undocumented,
    [],
    'DESIGN.md section 6 does not mention: ' + undocumented.join(', ')
  );
});

test('DASHBOARD.md does not overstate capability beyond VERIFICATION.md', () => {
  const dash = readFileSync(join(ROOT, 'DASHBOARD.md'), 'utf-8');
  assert.match(dash, /partial|not built|⚠/i, 'DASHBOARD.md must mark incomplete areas');
  // The two capabilities limited by ephemeral storage must be named, not implied.
  for (const token of ['seating', 'offline']) {
    assert.ok(
      dash.toLowerCase().includes(token),
      'DASHBOARD.md must name the runtime-limited capability: ' + token
    );
  }
  // And the same limit must be visible in the requirement matrix.
  const verification = readFileSync(join(ROOT, 'VERIFICATION.md'), 'utf-8');
  assert.match(verification, /ephemeral/i, 'VERIFICATION.md must record the storage limitation');
});

test('KPIS.md documents a formula for every headline metric family', () => {
  const kpis = readFileSync(join(ROOT, KPIS), 'utf-8');
  for (const metric of [
    'Actual wait',
    'Abandonment',
    'No-show',
    'Utilisation',
    'Throughput',
    'MAE',
    'MAPE',
    'Bias',
    'Range coverage'
  ]) {
    assert.ok(
      kpis.toLowerCase().includes(metric.toLowerCase()),
      'docs/KPIS.md does not document: ' + metric
    );
  }
  // It must also state what is deliberately NOT a KPI, or simulations and
  // forecasts will drift into being reported as measurements.
  assert.match(kpis, /not.*KPI|Explicitly/i, 'KPIS.md must state what is not a KPI');
});

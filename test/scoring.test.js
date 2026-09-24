import assert from 'node:assert/strict';
import { test } from 'node:test';
import { computeVerdict } from '../src/scoring.js';
import { verifiedFacts } from '../src/prompts.js';

const all = (n) => ({ specificity: n, mechanism_depth: n, verifiability: n, raw_material: n, fairness_risk: n });

test('weights are normalised so a perfect note scores 10', () => {
  assert.deepEqual(computeVerdict(all(10)), { weightedScore: 10, verdict: 'qualified' });
});

test('verdict bands', () => {
  assert.equal(computeVerdict(all(7)).verdict, 'qualified');
  assert.equal(computeVerdict(all(6.9)).verdict, 'borderline');
  assert.equal(computeVerdict(all(4.5)).verdict, 'borderline');
  assert.equal(computeVerdict(all(4.4)).verdict, 'rejected');
});

test('weights follow the rubric', () => {
  // specificity (25) and mechanism (20) matter most: 10s there and 0s elsewhere = 45/80.
  const r = computeVerdict({ specificity: 10, mechanism_depth: 10, verifiability: 0, raw_material: 0, fairness_risk: 0 });
  assert.equal(r.weightedScore, 5.6);
});

test('any hard gate rejects regardless of score', () => {
  assert.equal(computeVerdict(all(10), ['names a competitor']).verdict, 'rejected');
});

test('out-of-range scores are clamped', () => {
  assert.equal(computeVerdict(all(15)).weightedScore, 10);
  assert.equal(computeVerdict(all(-3)).weightedScore, 0);
});

test('the scorer gets Section 5 verified facts from the voice guide', () => {
  const facts = verifiedFacts();
  assert.match(facts, /^## 5\./);
  assert.match(facts, /67%/);
  assert.doesNotMatch(facts, /## 6\./);
});

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { classifyLawRejection, empiricalVerifierCaught, parseFixture, renderLawCandidate, renderVerifierCandidate } from '../benchmark/bend2/verifier-vs-law/harness.js';
import { BendCheckError } from '../src/bend-ast.js';

const repository = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const fixtureFile = join(repository, 'benchmark', 'bend2', 'verifier-vs-law', 'defects.json');

test('the verifier-vs-law fixture lists eight distinct seeded defects', async () => {
  const fixture = parseFixture(JSON.parse(await readFile(fixtureFile, 'utf8')) as unknown, fixtureFile);
  assert.equal(fixture.defects.length, 8);
  assert.equal(new Set(fixture.defects.map(defect => defect.expression)).size, 8);
  assert.equal(fixture.property.law, 'dbl : U32 -> U32');
});

test('each defect is injected into separate law and empirical candidates', async () => {
  const fixture = parseFixture(JSON.parse(await readFile(fixtureFile, 'utf8')) as unknown, fixtureFile);
  for (const defect of fixture.defects) {
    const law = renderLawCandidate(defect);
    const verifier = renderVerifierCandidate(defect, fixture.property.inputs);
    assert.match(law, /law dbl:\n  for \+a: U32\n  U32/);
    assert.ok(law.includes(`def dbl(a):\n  ${defect.expression}`));
    assert.ok(verifier.includes(`def dbl(a):\n  ${defect.expression}`));
    for (const input of fixture.property.inputs) assert.ok(verifier.includes(`dbl(${input})`));
  }
});

test('the empirical verdict depends on execution and expected output, not compiler signals alone', () => {
  const signals = { parse: 'pass' as const, type: 'pass' as const, ownership: 'pass' as const };
  assert.equal(empiricalVerifierCaught({ status: 'ran', stdout: 'wrong\n', exitCode: 0, detail: null, signals }, 'right\n'), true);
  assert.equal(empiricalVerifierCaught({ status: 'ran', stdout: 'right\n', exitCode: 0, detail: null, signals }, 'right\n'), false);
});

test('the law verdict counts checker rejections but rethrows infrastructure failures', () => {
  assert.deepEqual(classifyLawRejection(new BendCheckError('type', 'Bend type check failed.')),
    { caught: true, detail: 'Bend type check failed.' });
  const infrastructure = new Error('checker import failed');
  assert.throws(() => classifyLawRejection(infrastructure), error => error === infrastructure);
});

test('fixture parsing rejects a comparison with fewer than eight defects', async () => {
  const raw = JSON.parse(await readFile(fixtureFile, 'utf8')) as { defects: unknown[] };
  raw.defects = raw.defects.slice(0, 7);
  assert.throws(() => parseFixture(raw, 'short.json'), /at least 8 defects/);
});

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { buildWatcherDefectCases } from '../benchmark/bend2/verifier-vs-law/watcher-fixture.js';
import { parseFixture } from '../benchmark/bend2/verifier-vs-law/harness.js';
import { WATCH_CHUNK_CHARACTER_LIMIT, watchBendChanges } from '../src/sidecar/watch.js';

const repository = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const defectsFile = join(repository, 'benchmark', 'bend2', 'verifier-vs-law', 'defects.json');

test('all eight seeded defects produce a state and a question naming the type-only-law gap', async () => {
  const fixture = parseFixture(JSON.parse(await readFile(defectsFile, 'utf8')) as unknown, defectsFile);
  const cases = buildWatcherDefectCases(fixture);
  assert.equal(cases.length, 8);
  for (const defect of cases) {
    const result = watchBendChanges(defect.base, defect.head);
    assert.equal(result.chunks.length, 1, defect.id);
    const chunk = result.chunks[0]!;
    assert.equal(chunk.state.root.symbol, 'dbl', defect.id);
    assert.equal(chunk.state.laws[0]?.classification, 'type_only', defect.id);
    assert.equal(chunk.state.ownership.bindersAfter[0]?.quantity, 'copyable', defect.id);
    assert.match(chunk.questions.property_missing!.instructions, /only declared law is a function type, not a behavioral property/, defect.id);
    assert.ok(chunk.questions.next_evidence!.criteria && !Array.isArray(chunk.questions.next_evidence!.criteria)
      && 'abstain' in chunk.questions.next_evidence!.criteria, defect.id);
  }
});

test('watch state is stable across file insertion order and repeated runs', () => {
  const base = { files: {
    'z-test.bend': 'def dbl_test():\n  dbl(2)\n',
    'main.bend': 'law dbl:\n  for +a: U32\n  U32\n\ndef dbl(a):\n  U32.add(a, a)\n',
  } };
  const head = { files: {
    'main.bend': 'law dbl:\n  for +a: U32\n  U32\n\ndef dbl(a):\n  U32.add(a, 1)\n',
    'z-test.bend': 'def dbl_test():\n  dbl(2)\n',
  } };
  const expected = JSON.stringify(watchBendChanges(base, head));
  assert.equal(JSON.stringify(watchBendChanges(base, head)), expected);
  assert.equal(JSON.stringify(watchBendChanges(
    { files: { 'main.bend': base.files['main.bend'], 'z-test.bend': base.files['z-test.bend'] } },
    { files: { 'z-test.bend': head.files['z-test.bend'], 'main.bend': head.files['main.bend'] } },
  )), expected);
});

test('same-named declarations in different modules do not borrow laws or proof definitions', () => {
  const base = { files: {
    'a.bend': 'law main:\n  U32\n\ndef main():\n  0\n',
    'b.bend': 'law main:\n  {main() == 1 : U32}\n\ndef main():\n  1\n',
  } };
  const head = { files: { ...base.files, 'a.bend': 'law main:\n  U32\n\ndef main():\n  2\n' } };
  const chunk = watchBendChanges(base, head).chunks[0]!;
  assert.equal(chunk.state.root.file, 'a.bend');
  assert.deepEqual(chunk.state.laws.map(law => [law.file, law.classification, law.pairedDefinition]),
    [['a.bend', 'type_only', 'a.bend:main']]);
  assert.match(chunk.questions.property_missing!.instructions, /only declared law is a function type/);
});

test('a changed test declaration is not its own connected evidence', () => {
  const base = { files: { 'test/dbl.bend': 'def dbl_test():\n  dbl(1)\n' } };
  const head = { files: { 'test/dbl.bend': 'def dbl_test():\n  dbl(2)\n' } };
  const chunk = watchBendChanges(base, head).chunks[0]!;
  assert.equal(chunk.state.root.symbol, 'dbl_test');
  assert.deepEqual(chunk.state.evidence.tests, []);
  assert.equal(chunk.state.evidence.propertyChangedInDiff, false);
});

test('state records behavioral laws, evidence, holes, trust markers, and ownership changes', () => {
  const base = { files: {
    'main.bend': 'law dbl:\n  for +a: U32\n  {dbl(a) == U32.add(a, a) : U32}\n\ndef dbl(a):\n  U32.add(a, a)\n',
    'test/dbl.bend': 'def dbl_test():\n  dbl(7)\n',
  } };
  const head = { files: {
    'main.bend': 'law dbl:\n  for +a: U32\n  {dbl(a) == U32.add(a, a) : U32}\n\n@unsafe\ndef dbl(+a: U32, +a: U32) -> U32:\n  import "./dbl.js"\n  ?TODO\n',
    'test/dbl.bend': 'def dbl_test():\n  dbl(7)\n',
  } };
  const chunk = watchBendChanges(base, head).chunks.find(item => item.state.root.declarationKind === 'def')!;
  assert.equal(chunk.state.laws[0]?.classification, 'behavioral_property');
  assert.equal(chunk.state.laws[0]?.propertyKind, 'equality');
  assert.equal(chunk.state.evidence.tests[0]?.name, 'dbl_test');
  assert.equal(chunk.state.holesAndTrust.after.holes, 1);
  assert.equal(chunk.state.holesAndTrust.after.unsafeUses, 1);
  assert.equal(chunk.state.holesAndTrust.after.foreignDefinitions, 1);
  assert.deepEqual(chunk.state.ownership.duplicateNames, ['a']);
  assert.equal(chunk.state.ownership.compilerResult, 'not_run');
});

test('each declaration payload stays below the character budget using root-based compaction', () => {
  const calls = Array.from({ length: 2_000 }, (_, index) => `Fn${index}.call(${index})`).join(', ');
  const base = { files: { 'large.bend': 'def huge():\n  0\n' } };
  const head = { files: { 'large.bend': `def huge():\n  Tuple{${calls}}\n` } };
  const chunk = watchBendChanges(base, head).chunks[0]!;
  assert.ok(chunk.characterCount <= WATCH_CHUNK_CHARACTER_LIMIT);
  assert.equal(chunk.characterCount, JSON.stringify({ state: chunk.state, questions: chunk.questions }).length);
  assert.ok(chunk.state.omitted.sourceSlices > 0);
  assert.ok(chunk.state.omitted.structuralItems > 0);
});

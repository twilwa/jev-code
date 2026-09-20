import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import type { EntryType, Questions, SystemOneResult } from '@typesafe-ai/sdk';
import {
  budgetedLiveProvider, classifyExecution, executeBendSource, loadBenchmarkCases, offlineStrategyProvider,
  parseBenchmarkCase, parseOfflineStrategy, runLiveBenchmark, type CompilerSignals, type OfflineStrategy,
} from '../src/bend-semantic-benchmark.js';
import type { DecisionProvider } from '../src/sdk/types.js';

const here = dirname(fileURLToPath(import.meta.url));
const repository = resolve(here, '..');
const root = join(here, '..', 'benchmark', 'bend2');
const signals: CompilerSignals = { parse: 'pass', type: 'pass', ownership: 'pass' };
const expected = { stdout: '42\n', exitCode: 0 as const };
const bendRoot = process.env.JEV_BEND_PATH;

test('the checked-in usage cases carry tasks and separately authored expected results', async () => {
  const cases = await loadBenchmarkCases(root);
  assert.deepEqual(cases.map(item => item.id), ['add-two', 'compare-numbers', 'join-words']);
  assert.deepEqual(cases.map(item => item.expected.stdout), ['42\n', 'True\n', 'semantic check\n']);
  for (const item of cases) {
    const raw = JSON.parse(await readFile(item.sourceFile, 'utf8')) as Record<string, unknown>;
    assert.equal('source' in raw, false, 'a case must not carry or derive expected output from a candidate program');
    assert.equal(typeof raw.task, 'string');
    assert.equal(typeof raw.expected, 'object');
  }
});

test('case parsing rejects fields that could smuggle a generated candidate into the specification', () => {
  assert.throws(() => parseBenchmarkCase({ schemaVersion: 1, id: 'x', task: 'x', expected, offlineStrategy: 'x.json', source: 'main' }, 'case.json'), /unknown field source/);
  assert.throws(() => parseBenchmarkCase({ schemaVersion: 1, id: 'x', task: 'x', expected: { stdout: '', exitCode: 1 }, offlineStrategy: 'x.json' }, 'case.json'), /exitCode must be 0/);
});

test('offline strategies select exact slots and report unused or mismatched steps', async () => {
  const strategy: OfflineStrategy = { schemaVersion: 1, steps: [{ slot: 'slot-a', criterion: 'b' }] };
  const latency = { ms: 0 };
  const scripted = offlineStrategyProvider(strategy, latency);
  const response = await scripted.provider.decide({ generation: { slot: 'slot-a' } }, {
    selection: { type: 'choice', description: 'pick', criteria: { a: 'A', b: 'B' } },
  } as never);
  assert.equal(((response as unknown as { answers: { selection: { choice: string } } }).answers.selection).choice, 'b');
  assert.equal(response.usage.input_tokens, 0);
  assert.equal(response.usage.output_tokens, 0);
  scripted.assertComplete();
  assert.ok(latency.ms >= 0);

  const unused = offlineStrategyProvider(strategy, { ms: 0 });
  assert.throws(unused.assertComplete, /left 1 unused step/);
  const mismatched = offlineStrategyProvider(strategy, { ms: 0 });
  await assert.rejects(mismatched.provider.decide({ generation: { slot: 'other' } }, {
    selection: { type: 'choice', description: 'pick', criteria: { a: 'A', b: 'B' } },
  } as never), /expected slot slot-a/);
});

test('strategy parsing requires exactly one selector', () => {
  assert.throws(() => parseOfflineStrategy({ schemaVersion: 1, steps: [{ slot: 'x' }] }, 'strategy.json'), /exactly one selector/);
  assert.throws(() => parseOfflineStrategy({ schemaVersion: 1, steps: [{ slot: 'x', criterion: 'a', description: 'A' }] }, 'strategy.json'), /exactly one selector/);
});

test('semantic output is the pass criterion and compiler signals remain separate', () => {
  assert.deepEqual(classifyExecution({ status: 'ran', stdout: '42\n', exitCode: 0, detail: null, signals }, expected),
    { outcome: 'pass', errorClass: null, detail: null });
  const wrong = classifyExecution({ status: 'ran', stdout: '41\n', exitCode: 0, detail: null, signals }, expected);
  assert.equal(wrong.outcome, 'fail');
  assert.equal(wrong.errorClass, 'wrong_output');
  assert.deepEqual(signals, { parse: 'pass', type: 'pass', ownership: 'pass' });
});

test('the harness preserves every named execution error class', () => {
  for (const errorClass of ['compile_error', 'runtime_error', 'timeout'] as const) {
    const classified = classifyExecution({ status: errorClass, stdout: '', exitCode: null, detail: errorClass, signals }, expected);
    assert.deepEqual(classified, { outcome: 'fail', errorClass, detail: errorClass });
  }
});

test('the pinned runner reports an actual parse failure as a compile error', { skip: bendRoot ? false : 'set JEV_BEND_PATH' }, async () => {
  const result = await executeBendSource('def main(\n', bendRoot!);
  assert.equal(result.status, 'compile_error');
  assert.deepEqual(result.signals, { parse: 'fail', type: 'not_run', ownership: 'not_run' });
});

test('the pinned runner enforces its timeout', { skip: bendRoot ? false : 'set JEV_BEND_PATH' }, async () => {
  const result = await executeBendSource('import Base\n\ndef main() -> IO(Unit):\n  do IO<Unit>:\n    IO.print("ok")\n', bendRoot!, 1);
  assert.equal(result.status, 'timeout');
});

test('the pinned runner treats its output limit as a runtime error', { skip: bendRoot ? false : 'set JEV_BEND_PATH' }, async () => {
  const result = await executeBendSource('import Base\n\ndef main() -> IO(Unit):\n  do IO<Unit>:\n    IO.print("ok")\n', bendRoot!, 10_000, 1);
  assert.equal(result.status, 'runtime_error');
  assert.match(result.detail ?? '', /Output exceeded 1 bytes/);
  assert.deepEqual(result.signals, signals);
});

test('live provider refuses a request after its exact cap', async () => {
  const base: DecisionProvider = { decide: async <Q extends Questions>(_input: EntryType, questions: Q) => ({
    model: 'budget-test', usage: { input_tokens: 2, output_tokens: 1 }, answers: Object.fromEntries(Object.keys(questions).map(key =>
      [key, { type: 'choice', choice: 'a', confidence: 1, probabilities: { a: 1, b: 0 } }])) as never,
  } as SystemOneResult<Q>) };
  const totals = { requests: 0, inputTokens: 0, outputTokens: 0, latencyMs: 0 };
  const provider = budgetedLiveProvider(base, { maxRequests: 1, maxInputTokens: 2, maxOutputTokens: 1 }, totals);
  const question = { selection: { type: 'choice', description: 'pick', criteria: { a: 'A', b: 'B' } } } as never;
  await provider.decide({}, question);
  await assert.rejects(provider.decide({}, question), /request cap reached/);
  assert.deepEqual({ requests: totals.requests, inputTokens: totals.inputTokens, outputTokens: totals.outputTokens },
    { requests: 1, inputTokens: 2, outputTokens: 1 });
});

test('a failed live call is charged before dispatch and cannot exceed the request cap', async () => {
  let calls = 0;
  const failing: DecisionProvider = { decide: async () => { calls++; throw new Error('provider unavailable'); } };
  const totals = { requests: 0, inputTokens: 0, outputTokens: 0, latencyMs: 0 };
  const provider = budgetedLiveProvider(failing, { maxRequests: 1, maxInputTokens: 10, maxOutputTokens: 10 }, totals);
  const question = { selection: { type: 'choice', description: 'pick', criteria: { a: 'A', b: 'B' } } } as never;
  await assert.rejects(provider.decide({}, question), /provider unavailable/);
  await assert.rejects(provider.decide({}, question), /request cap reached/);
  assert.equal(calls, 1);
  assert.equal(totals.requests, 1);
});

test('setup and live execution reject a dirty pinned JEV_BEND_PATH checkout', {
  skip: bendRoot ? false : 'set JEV_BEND_PATH',
}, async () => {
  const temporaryRoot = await mkdtemp(join(tmpdir(), 'jev-bend-toolchain-'));
  const configuredBendRoot = resolve(repository, bendRoot!);
  const dirtyBendRoot = join(temporaryRoot, 'dirty-bend');
  const unusedToolRoot = join(temporaryRoot, 'unused-tools');
  const setupScript = join(repository, 'scripts', 'setup-bend2-toolchain.sh');

  try {
    execFileSync('git', ['init', '--quiet', dirtyBendRoot]);
    const objectDirectory = execFileSync('git', [
      '-C', configuredBendRoot, 'rev-parse', '--path-format=absolute', '--git-path', 'objects',
    ], { encoding: 'utf8' }).trim();
    await writeFile(join(dirtyBendRoot, '.git', 'objects', 'info', 'alternates'), `${objectDirectory}\n`);
    execFileSync('git', [
      '-C', dirtyBendRoot, 'checkout', '--quiet', '--detach', '7561656155a4285c1e4ccfcb3505ab59524de973',
    ]);
    assert.equal(
      execFileSync('git', ['-C', dirtyBendRoot, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(),
      '7561656155a4285c1e4ccfcb3505ab59524de973',
    );
    assert.equal(
      execFileSync('git', ['-C', dirtyBendRoot, 'status', '--porcelain', '--untracked-files=all'], { encoding: 'utf8' }),
      '',
      'the temporary pinned Bend checkout must start clean',
    );
    await writeFile(join(dirtyBendRoot, 'local-modification.txt'), 'dirty\n');

    let liveRequests = 0;
    const provider: DecisionProvider = { decide: async () => {
      liveRequests++;
      throw new Error('the provider must not run');
    } };
    await assert.rejects(
      runLiveBenchmark({ root, bendRoot: dirtyBendRoot }, provider, {
        maxRequests: 1, maxInputTokens: 1, maxOutputTokens: 1,
      }),
      /Bend checkout has local modifications/,
    );
    assert.equal(liveRequests, 0);

    const result = spawnSync('bash', [setupScript], {
      cwd: repository,
      encoding: 'utf8',
      env: {
        ...process.env,
        JEV_BEND_PATH: dirtyBendRoot,
        JEV_BENCH_TOOL_ROOT: unusedToolRoot,
      },
    });

    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /Bend checkout has local modifications/);
    assert.match(result.stderr, new RegExp(dirtyBendRoot.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
    assert.equal(existsSync(unusedToolRoot), false, 'setup must not use JEV_BENCH_TOOL_ROOT when JEV_BEND_PATH is set');
  } finally {
    await rm(temporaryRoot, { recursive: true, force: true });
  }
});

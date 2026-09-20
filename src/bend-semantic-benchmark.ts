import { spawn } from 'node:child_process';
import { execFile } from 'node:child_process';
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { EntryType, Questions, SystemOneResult } from '@typesafe-ai/sdk';
import { generateBendAst } from './bend-ast.js';
import { Decisions } from './decisions.js';
import type { DecisionProvider } from './sdk/types.js';

export const BEND_BENCHMARK_REVISION = '7561656155a4285c1e4ccfcb3505ab59524de973';
export const BEND_BENCHMARK_VERSION = '2.0.20';
export const BEND_BENCHMARK_NODE = '24.21.0';
export const BEND_BENCHMARK_PNPM = '10.30.3';

export type SignalStatus = 'pass' | 'fail' | 'not_run';
export type ErrorClass = 'generation_error' | 'compile_error' | 'runtime_error' | 'timeout' | 'wrong_output';
export interface CompilerSignals { parse: SignalStatus; type: SignalStatus; ownership: SignalStatus }
export interface BenchmarkCase {
  schemaVersion: 1;
  id: string;
  task: string;
  expected: { stdout: string; exitCode: 0 };
  offlineStrategy: string;
  sourceFile: string;
}
export interface StrategyStep { slot: string; criterion?: string; description?: string }
export interface OfflineStrategy { schemaVersion: 1; steps: StrategyStep[] }
export interface CaseMeasurement {
  requestCount: number;
  tokenCount: { input: number; output: number; total: number };
  providerLatencyMs: number;
  wallTimeMs: number;
}
export interface CaseResult {
  id: string;
  task: string;
  outcome: 'pass' | 'fail';
  errorClass: ErrorClass | null;
  detail: string | null;
  expected: { stdout: string; exitCode: 0 };
  actual: { stdout: string; exitCode: number | null };
  signals: CompilerSignals;
  measurements: CaseMeasurement;
  generatedSource: string | null;
}
export interface BenchmarkReport {
  schemaVersion: 1;
  mode: 'offline' | 'live';
  startedAt: string;
  endedAt: string;
  toolchain: { bendVersion: string; bendRevision: string; nodeVersion: string; pnpmVersion: string; compatibility: 'compatible' };
  summary: {
    successCount: number;
    failureCount: number;
    requestCount: number;
    tokenCount: { input: number; output: number; total: number };
    providerLatencyMs: number;
    wallTimeMs: number;
  };
  cases: CaseResult[];
}

interface ExecutionResult {
  status: 'ran' | 'compile_error' | 'runtime_error' | 'timeout';
  stdout: string;
  exitCode: number | null;
  detail: string | null;
  signals: CompilerSignals;
}

const object = (value: unknown, at: string): Record<string, unknown> => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${at} must be an object.`);
  return value as Record<string, unknown>;
};
const exactKeys = (value: Record<string, unknown>, keys: string[], at: string): void => {
  const extra = Object.keys(value).filter(key => !keys.includes(key));
  if (extra.length) throw new Error(`${at} has unknown field ${extra[0]}.`);
};
const string = (value: unknown, at: string, allowEmpty = false): string => {
  if (typeof value !== 'string' || (!allowEmpty && value.length === 0)) throw new Error(`${at} must be ${allowEmpty ? 'a string' : 'a non-empty string'}.`);
  return value;
};

export function parseBenchmarkCase(value: unknown, sourceFile: string): BenchmarkCase {
  const item = object(value, sourceFile);
  exactKeys(item, ['$schema', 'schemaVersion', 'id', 'task', 'expected', 'offlineStrategy'], sourceFile);
  if (item.schemaVersion !== 1) throw new Error(`${sourceFile}.schemaVersion must be 1.`);
  const id = string(item.id, `${sourceFile}.id`);
  if (!/^[a-z][a-z0-9-]{0,63}$/.test(id)) throw new Error(`${sourceFile}.id is invalid.`);
  const expected = object(item.expected, `${sourceFile}.expected`);
  exactKeys(expected, ['stdout', 'exitCode'], `${sourceFile}.expected`);
  if (expected.exitCode !== 0) throw new Error(`${sourceFile}.expected.exitCode must be 0.`);
  const offlineStrategy = string(item.offlineStrategy, `${sourceFile}.offlineStrategy`);
  if (basename(offlineStrategy) !== offlineStrategy || !/^[a-z][a-z0-9-]{0,63}\.json$/.test(offlineStrategy)) {
    throw new Error(`${sourceFile}.offlineStrategy must be a strategy filename.`);
  }
  return { schemaVersion: 1, id, task: string(item.task, `${sourceFile}.task`),
    expected: { stdout: string(expected.stdout, `${sourceFile}.expected.stdout`, true), exitCode: 0 }, offlineStrategy, sourceFile };
}

export function parseOfflineStrategy(value: unknown, sourceFile: string): OfflineStrategy {
  const item = object(value, sourceFile);
  exactKeys(item, ['$schema', 'schemaVersion', 'steps'], sourceFile);
  if (item.schemaVersion !== 1 || !Array.isArray(item.steps) || item.steps.length === 0 || item.steps.length > 200) {
    throw new Error(`${sourceFile} must have schemaVersion 1 and 1 to 200 steps.`);
  }
  const steps = item.steps.map((raw, index): StrategyStep => {
    const step = object(raw, `${sourceFile}.steps[${index}]`);
    exactKeys(step, ['slot', 'criterion', 'description'], `${sourceFile}.steps[${index}]`);
    const hasCriterion = typeof step.criterion === 'string';
    const hasDescription = typeof step.description === 'string';
    if (hasCriterion === hasDescription) throw new Error(`${sourceFile}.steps[${index}] needs exactly one selector.`);
    return { slot: string(step.slot, `${sourceFile}.steps[${index}].slot`),
      ...(hasCriterion ? { criterion: string(step.criterion, `${sourceFile}.steps[${index}].criterion`) }
        : { description: string(step.description, `${sourceFile}.steps[${index}].description`, true) }) };
  });
  return { schemaVersion: 1, steps };
}

export async function loadBenchmarkCases(root: string): Promise<BenchmarkCase[]> {
  const caseRoot = join(root, 'cases');
  const files = (await readdir(caseRoot)).filter(file => file.endsWith('.json')).sort();
  const cases = await Promise.all(files.map(async file => {
    const sourceFile = join(caseRoot, file);
    return parseBenchmarkCase(JSON.parse(await readFile(sourceFile, 'utf8')) as unknown, sourceFile);
  }));
  const ids = new Set<string>();
  for (const item of cases) {
    if (ids.has(item.id)) throw new Error(`Duplicate benchmark case id ${item.id}.`);
    ids.add(item.id);
  }
  return cases;
}

export function offlineStrategyProvider(strategy: OfflineStrategy, latency: { ms: number }): { provider: DecisionProvider; assertComplete: () => void } {
  let cursor = 0;
  const provider: DecisionProvider = { decide: async <Q extends Questions>(input: EntryType, questions: Q) => {
    const started = performance.now();
    try {
      const question = questions.selection;
      if (!question || question.type !== 'choice') throw new Error('Offline Bend strategies only answer choice questions.');
      const generation = input as { generation?: { slot?: unknown } };
      const slot = generation.generation?.slot;
      const step = strategy.steps[cursor];
      if (!step) throw new Error(`Offline strategy has no step for ${String(slot)}.`);
      if (slot !== step.slot) throw new Error(`Offline strategy expected slot ${step.slot}, generator requested ${String(slot)}.`);
      const criteria = question.criteria;
      const choice = step.criterion ?? Object.keys(criteria).find(key => criteria[key] === step.description);
      if (!choice || !(choice in criteria)) {
        throw new Error(`Offline strategy cannot select ${step.criterion ?? JSON.stringify(step.description)} at ${step.slot}.`);
      }
      cursor++;
      return { model: 'offline-specification', usage: { input_tokens: 0, output_tokens: 0 }, answers: {
        selection: { type: 'choice', choice, confidence: 1,
          probabilities: Object.fromEntries(Object.keys(criteria).map(key => [key, Number(key === choice)])) },
      } } as unknown as SystemOneResult<Q>;
    } finally { latency.ms += performance.now() - started; }
  } };
  return { provider, assertComplete: () => {
    if (cursor !== strategy.steps.length) throw new Error(`Offline strategy left ${strategy.steps.length - cursor} unused step(s), starting at ${strategy.steps[cursor]?.slot}.`);
  } };
}

const appendLimited = (chunks: Buffer[], chunk: Buffer, limit: number): boolean => {
  const size = chunks.reduce((total, value) => total + value.length, 0);
  if (size >= limit) return false;
  chunks.push(chunk.subarray(0, limit - size));
  return size + chunk.length <= limit;
};

export async function executeBendSource(source: string, bendRoot: string, timeoutMs = 10_000, maxOutputBytes = 65_536): Promise<ExecutionResult> {
  const dir = await mkdtemp(join(tmpdir(), 'jev-bend-semantic-'));
  try {
    const sourceFile = join(dir, 'main.bend');
    await writeFile(sourceFile, source);
    const runner = resolve(dirname(fileURLToPath(import.meta.url)), '..', 'benchmark', 'bend2', 'execute.mjs');
    return await new Promise<ExecutionResult>((done) => {
      const child = spawn(process.execPath, [runner, bendRoot, sourceFile], {
        detached: process.platform !== 'win32', env: { ...process.env, BEND_NO_TELEMETRY: '1' }, stdio: ['ignore', 'pipe', 'pipe', 'pipe'],
      });
      const stdout: Buffer[] = [];
      const stderr: Buffer[] = [];
      let metadata = '';
      let timedOut = false;
      let overflow = false;
      const signals: CompilerSignals = { parse: 'not_run', type: 'not_run', ownership: 'not_run' };
      const stop = (): void => {
        try {
          if (process.platform !== 'win32' && child.pid !== undefined) process.kill(-child.pid, 'SIGKILL');
          else child.kill('SIGKILL');
        } catch {}
      };
      child.stdout!.on('data', (chunk: Buffer) => { if (!appendLimited(stdout, chunk, maxOutputBytes)) { overflow = true; stop(); } });
      child.stderr!.on('data', (chunk: Buffer) => { appendLimited(stderr, chunk, maxOutputBytes); });
      child.stdio[3]?.on('data', (chunk: Buffer) => { metadata += chunk.toString(); });
      const timer = setTimeout(() => { timedOut = true; stop(); }, timeoutMs);
      child.on('error', error => { clearTimeout(timer); done({ status: 'runtime_error', stdout: Buffer.concat(stdout).toString(), exitCode: null,
        detail: error.message, signals }); });
      child.on('close', (code, signal) => {
        clearTimeout(timer);
        const lines = metadata.trim().split('\n').filter(Boolean);
        let final: Record<string, unknown> | undefined;
        for (const line of lines) {
          let event: Record<string, unknown>;
          try { event = JSON.parse(line) as Record<string, unknown>; }
          catch { continue; }
          if (event.event === 'signal' && (event.stage === 'parse' || event.stage === 'type' || event.stage === 'ownership')
            && (event.status === 'pass' || event.status === 'fail')) signals[event.stage] = event.status;
          else final = event;
        }
        const actualStdout = Buffer.concat(stdout).toString();
        if (timedOut) return done({ status: 'timeout', stdout: actualStdout, exitCode: null, detail: `Execution exceeded ${timeoutMs} ms.`, signals });
        if (overflow) return done({ status: 'runtime_error', stdout: actualStdout, exitCode: null, detail: `Output exceeded ${maxOutputBytes} bytes.`, signals });
        const status = final?.status;
        if (status === 'ran' || status === 'compile_error' || status === 'runtime_error') {
          const result = final!;
          return done({ status, stdout: actualStdout, exitCode: typeof result.exitCode === 'number' ? result.exitCode : null,
            detail: typeof result.detail === 'string' ? result.detail : null, signals });
        }
        done({ status: 'runtime_error', stdout: actualStdout, exitCode: code,
          detail: `Bend runner ended without a result${signal ? ` (${signal})` : ''}: ${Buffer.concat(stderr).toString().trim()}`, signals });
      });
    });
  } finally { await rm(dir, { recursive: true, force: true }); }
}

export function classifyExecution(execution: ExecutionResult, expected: BenchmarkCase['expected']): Pick<CaseResult, 'outcome' | 'errorClass' | 'detail'> {
  if (execution.status !== 'ran') return { outcome: 'fail', errorClass: execution.status, detail: execution.detail };
  if (execution.exitCode !== expected.exitCode || execution.stdout !== expected.stdout) {
    return { outcome: 'fail', errorClass: 'wrong_output',
      detail: `Expected exit ${expected.exitCode} and stdout ${JSON.stringify(expected.stdout)}; observed exit ${execution.exitCode} and stdout ${JSON.stringify(execution.stdout)}.` };
  }
  return { outcome: 'pass', errorClass: null, detail: null };
}

const exec = (file: string, args: string[]): Promise<string> => new Promise((done, reject) => {
  execFile(file, args, { encoding: 'utf8' }, (error, stdout) => error ? reject(error) : done(stdout.trim()));
});

export async function inspectBenchmarkToolchain(bendRoot: string): Promise<BenchmarkReport['toolchain']> {
  const revision = await exec('git', ['-C', bendRoot, 'rev-parse', 'HEAD']);
  if (revision !== BEND_BENCHMARK_REVISION) throw new Error(`Bend revision mismatch: expected ${BEND_BENCHMARK_REVISION}, found ${revision}.`);
  const main = await readFile(join(bendRoot, 'bend2', 'main.ts'), 'utf8');
  const version = /const VERSION = "([^"]+)"/.exec(main)?.[1];
  if (version !== BEND_BENCHMARK_VERSION) throw new Error(`Bend version mismatch: expected ${BEND_BENCHMARK_VERSION}, found ${version ?? 'unknown'}.`);
  if (process.versions.node !== BEND_BENCHMARK_NODE) throw new Error(`Node mismatch: expected ${BEND_BENCHMARK_NODE}, found ${process.versions.node}.`);
  return { bendVersion: version, bendRevision: revision, nodeVersion: process.versions.node,
    pnpmVersion: BEND_BENCHMARK_PNPM, compatibility: 'compatible' };
}

export interface RunBenchmarkOptions {
  root: string;
  bendRoot: string;
  mode?: 'offline';
  timeoutMs?: number;
}

export interface LiveBudget {
  maxRequests: number;
  maxInputTokens: number;
  maxOutputTokens: number;
}

export function budgetedLiveProvider(provider: DecisionProvider, budget: LiveBudget, totals: {
  requests: number; inputTokens: number; outputTokens: number; latencyMs: number;
}): DecisionProvider {
  return { decide: async <Q extends Questions>(input: EntryType, questions: Q, signal?: AbortSignal) => {
    if (totals.requests >= budget.maxRequests) throw new Error(`Live request cap reached (${budget.maxRequests}).`);
    if (totals.inputTokens >= budget.maxInputTokens) throw new Error(`Live input-token cap reached (${budget.maxInputTokens}).`);
    if (totals.outputTokens >= budget.maxOutputTokens) throw new Error(`Live output-token cap reached (${budget.maxOutputTokens}).`);
    totals.requests++;
    const started = performance.now();
    try {
      const response = await provider.decide(input, questions, signal);
      totals.inputTokens += response.usage.input_tokens;
      totals.outputTokens += response.usage.output_tokens;
      if (totals.inputTokens > budget.maxInputTokens || totals.outputTokens > budget.maxOutputTokens) {
        throw new Error(`A live response crossed an authorized token cap: input ${totals.inputTokens}/${budget.maxInputTokens}, output ${totals.outputTokens}/${budget.maxOutputTokens}. No further request will run.`);
      }
      return response;
    } finally { totals.latencyMs += performance.now() - started; }
  } };
}

export async function runOfflineBenchmark(options: RunBenchmarkOptions): Promise<BenchmarkReport> {
  const wallStarted = performance.now();
  const startedAt = new Date().toISOString();
  const toolchain = await inspectBenchmarkToolchain(options.bendRoot);
  const cases = await loadBenchmarkCases(options.root);
  const results: CaseResult[] = [];
  for (const item of cases) {
    const caseStarted = performance.now();
    const latency = { ms: 0 };
    let requests = 0;
    let usage = { inputTokens: 0, outputTokens: 0 };
    let generatedSource: string | null = null;
    let decisions: Decisions | undefined;
    let execution: ExecutionResult = { status: 'runtime_error', stdout: '', exitCode: null, detail: 'Generation did not run.',
      signals: { parse: 'not_run', type: 'not_run', ownership: 'not_run' } };
    let classified: Pick<CaseResult, 'outcome' | 'errorClass' | 'detail'>;
    try {
      const strategyFile = join(options.root, 'strategies', item.offlineStrategy);
      const strategy = parseOfflineStrategy(JSON.parse(await readFile(strategyFile, 'utf8')) as unknown, strategyFile);
      const scripted = offlineStrategyProvider(strategy, latency);
      decisions = new Decisions(scripted.provider, 200, new AbortController().signal);
      generatedSource = await generateBendAst(decisions, { task: { prompt: item.task } }, 'content',
        { maxSteps: 200, maxBytes: 20_000, allowEmpty: false, fragments: [] });
      scripted.assertComplete();
      requests = decisions.requests;
      usage = decisions.usage;
      execution = await executeBendSource(generatedSource, options.bendRoot, options.timeoutMs);
      classified = classifyExecution(execution, item.expected);
    } catch (error) {
      classified = { outcome: 'fail', errorClass: 'generation_error', detail: error instanceof Error ? error.stack ?? error.message : String(error) };
    }
    requests = decisions?.requests ?? requests;
    usage = decisions?.usage ?? usage;
    results.push({ id: item.id, task: item.task, ...classified, expected: item.expected,
      actual: { stdout: execution.stdout, exitCode: execution.exitCode }, signals: execution.signals,
      measurements: { requestCount: requests, tokenCount: { input: usage.inputTokens, output: usage.outputTokens,
        total: usage.inputTokens + usage.outputTokens }, providerLatencyMs: latency.ms, wallTimeMs: performance.now() - caseStarted }, generatedSource });
  }
  const input = results.reduce((sum, item) => sum + item.measurements.tokenCount.input, 0);
  const output = results.reduce((sum, item) => sum + item.measurements.tokenCount.output, 0);
  return { schemaVersion: 1, mode: 'offline', startedAt, endedAt: new Date().toISOString(), toolchain,
    summary: { successCount: results.filter(item => item.outcome === 'pass').length,
      failureCount: results.filter(item => item.outcome === 'fail').length,
      requestCount: results.reduce((sum, item) => sum + item.measurements.requestCount, 0),
      tokenCount: { input, output, total: input + output },
      providerLatencyMs: results.reduce((sum, item) => sum + item.measurements.providerLatencyMs, 0),
      wallTimeMs: performance.now() - wallStarted }, cases: results };
}

export async function runLiveBenchmark(options: Omit<RunBenchmarkOptions, 'mode'>, provider: DecisionProvider, budget: LiveBudget): Promise<BenchmarkReport> {
  const wallStarted = performance.now();
  const startedAt = new Date().toISOString();
  const toolchain = await inspectBenchmarkToolchain(options.bendRoot);
  const cases = await loadBenchmarkCases(options.root);
  const totals = { requests: 0, inputTokens: 0, outputTokens: 0, latencyMs: 0 };
  const limited = budgetedLiveProvider(provider, budget, totals);
  const results: CaseResult[] = [];
  for (const item of cases) {
    const caseStarted = performance.now();
    const before = { ...totals };
    let generatedSource: string | null = null;
    let execution: ExecutionResult = { status: 'runtime_error', stdout: '', exitCode: null, detail: 'Generation did not run.',
      signals: { parse: 'not_run', type: 'not_run', ownership: 'not_run' } };
    let classified: Pick<CaseResult, 'outcome' | 'errorClass' | 'detail'>;
    try {
      const decisions = new Decisions(limited, budget.maxRequests, new AbortController().signal);
      generatedSource = await generateBendAst(decisions, { task: { prompt: item.task } }, 'content',
        { maxSteps: 200, maxBytes: 20_000, allowEmpty: false, fragments: [] });
      execution = await executeBendSource(generatedSource, options.bendRoot, options.timeoutMs);
      classified = classifyExecution(execution, item.expected);
    } catch (error) {
      classified = { outcome: 'fail', errorClass: 'generation_error', detail: error instanceof Error ? error.stack ?? error.message : String(error) };
    }
    const input = totals.inputTokens - before.inputTokens;
    const output = totals.outputTokens - before.outputTokens;
    results.push({ id: item.id, task: item.task, ...classified, expected: item.expected,
      actual: { stdout: execution.stdout, exitCode: execution.exitCode }, signals: execution.signals,
      measurements: { requestCount: totals.requests - before.requests,
        tokenCount: { input, output, total: input + output }, providerLatencyMs: totals.latencyMs - before.latencyMs,
        wallTimeMs: performance.now() - caseStarted }, generatedSource });
  }
  return { schemaVersion: 1, mode: 'live', startedAt, endedAt: new Date().toISOString(), toolchain,
    summary: { successCount: results.filter(item => item.outcome === 'pass').length,
      failureCount: results.filter(item => item.outcome === 'fail').length, requestCount: totals.requests,
      tokenCount: { input: totals.inputTokens, output: totals.outputTokens, total: totals.inputTokens + totals.outputTokens },
      providerLatencyMs: totals.latencyMs, wallTimeMs: performance.now() - wallStarted }, cases: results };
}

import assert from 'node:assert/strict';
import { chmod, mkdtemp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { after, test } from 'node:test';
import { fauxAssistantMessage, fauxProvider, InMemoryCredentialStore, InMemoryModelsStore } from '@earendil-works/pi-ai';
import {
  createAgentSession, DefaultResourceLoader, ModelRuntime, SessionManager, SettingsManager,
} from '@earendil-works/pi-coding-agent';
import extension from '../src/sidecar/pi-extension/index.js';
import { readPiSidecarConfig, SIDECAR_CONFIG_ENV, type PiSidecarConfig } from '../src/sidecar/pi-extension/config.js';
import { advisoryLines, createWatchRunner } from '../src/sidecar/pi-extension/watch-runner.js';

const testRoots: string[] = [];
after(async () => {
  for (const root of testRoots) await rm(root, { recursive: true, force: true });
});

const makeRoot = async (): Promise<{ root: string; repo: string; tmp: string }> => {
  const root = await mkdtemp(resolve('.pi-sidecar-test-'));
  testRoots.push(root);
  const repo = join(root, 'repo');
  const tmp = join(root, 'tmp');
  await mkdir(repo);
  await mkdir(tmp);
  return { root, repo, tmp };
};

type StubMode = 'answered' | 'abstained' | 'budget_refused';

const stubHelper = async (tmp: string, mode: StubMode, gate?: string): Promise<string> => {
  const helper = join(tmp, `jevhelper-${mode}.cjs`);
  const record = join(tmp, 'calls.log');
  const script = `#!/usr/bin/env node
const fs = require('node:fs');
const input = JSON.parse(fs.readFileSync(0, 'utf8'));
fs.appendFileSync(${JSON.stringify(record)}, JSON.stringify(process.argv.slice(2)) + '\\n');
${gate ? `while (!fs.existsSync(${JSON.stringify(gate)})) Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 10);` : ''}
const fdIndex = process.argv.indexOf('--answers-fd');
const fd = Number(process.argv[fdIndex + 1]);
const declarations = input.states.map((state) => ({
  declaration_id: state.id,
  target: state.target,
  diff_sha256: state.diff_sha256,
  outcome: ${JSON.stringify(mode)},
  verdicts: ${mode === 'budget_refused' ? '[]' : `[{ gap: 'property_missing', confidence: 0.9, abstain: ${mode === 'abstained'}, answer: { type: 'noul', probability: 0.9, abstain: ${mode === 'abstained'} } }]`},
  ...(${JSON.stringify(mode)} === 'budget_refused' ? { reason: 'run_budget_exceeded', failure: { kind: 'budget_exceeded' } } : {}),
}));
fs.writeFileSync(fd, JSON.stringify({ schema_version: 'jevhelper/watch-verdicts-v1', declarations }) + '\\n');
process.stdout.write(JSON.stringify({ schema_version: 'jevhelper/output-v1', command: 'watch', receipts: [] }) + '\\n');
`;
  await writeFile(helper, script, { mode: 0o700 });
  await chmod(helper, 0o700);
  return helper;
};

const configFor = (tmp: string, helper: string, sessionId = 'test-session'): PiSidecarConfig => ({
  enabled: true,
  sessionId,
  tmpDir: tmp,
  jevhelperPath: helper,
  lane: 'test-lane',
  workItem: 'test-work',
  model: 'test-jev',
  timeoutSeconds: 2,
  budget: {
    maxCallsPerTurn: 4,
    maxTokensPerTurn: 20_000,
    maxCallsPerSession: 20,
    maxTokensPerSession: 100_000,
  },
});

const countCalls = async (tmp: string): Promise<number> => {
  try {
    return (await readFile(join(tmp, 'calls.log'), 'utf8')).trim().split('\n').filter(Boolean).length;
  } catch {
    return 0;
  }
};

const waitFor = async (condition: () => Promise<boolean>, timeoutMs = 2_000): Promise<void> => {
  const deadline = Date.now() + timeoutMs;
  while (!(await condition())) {
    if (Date.now() >= deadline) throw new Error('condition timed out');
    await new Promise(resolveTimeout => setTimeout(resolveTimeout, 10));
  }
};

test('configuration is default-off and requires an exact session opt-in', async () => {
  const { tmp } = await makeRoot();
  assert.equal(await readPiSidecarConfig({}, 's1'), undefined);
  const path = join(tmp, 'config.json');
  const helper = await stubHelper(tmp, 'answered');
  await writeFile(path, JSON.stringify(configFor(tmp, helper, 's1')));
  assert.equal(await readPiSidecarConfig({ [SIDECAR_CONFIG_ENV]: path }, 's2'), undefined);
  assert.equal((await readPiSidecarConfig({ [SIDECAR_CONFIG_ENV]: path }, 's1'))?.enabled, true);
});

test('disabled runner stays inert and an enabled runner invokes one helper per changed boundary', async () => {
  const { repo, tmp } = await makeRoot();
  const helper = await stubHelper(tmp, 'answered');
  const file = join(repo, 'main.bend');
  await writeFile(file, 'def dbl(a):\n  U32.add(a, a)\n');
  const messages: string[] = [];
  const runner = createWatchRunner({ sendAdvisory: message => messages.push(message), onError: error => { throw error; } });
  await runner.initialize(undefined, 'test-session', repo);
  await writeFile(file, 'def dbl(a):\n  U32.add(a, 1)\n');
  await runner.boundary();
  await runner.flush();
  assert.equal(await countCalls(tmp), 0);

  await runner.initialize(configFor(tmp, helper), 'test-session', repo);
  await writeFile(file, 'def dbl(a):\n  U32.add(a, 2)\n');
  await runner.boundary();
  await runner.boundary();
  await runner.flush();
  assert.equal(await countCalls(tmp), 1);
  const helperArgs = JSON.parse((await readFile(join(tmp, 'calls.log'), 'utf8')).trim()) as string[];
  assert.deepEqual(helperArgs.slice(helperArgs.indexOf('--max-calls'), helperArgs.indexOf('--max-calls') + 2), ['--max-calls', '4']);
  assert.deepEqual(helperArgs.slice(helperArgs.indexOf('--max-tokens'), helperArgs.indexOf('--max-tokens') + 2), ['--max-tokens', '20000']);
  assert.equal(messages.length, 1);
  assert.match(messages[0]!, /main\.bend:dbl: property_missing/);
  const states = (await readdir(tmp)).filter(name => name.endsWith('-states.json'));
  assert.equal(states.length, 1);
  const stateDocument = JSON.parse(await readFile(join(tmp, states[0]!), 'utf8')) as {
    states: Array<{ questions: Record<string, { criteria?: Record<string, string> }> }>;
  };
  assert.deepEqual(Object.keys(stateDocument.states[0]!.questions.property_missing!.criteria!).sort(), ['false', 'true']);

  await writeFile(file, 'def dbl(a):\n  U32.add(a, 3)\n');
  await runner.boundary();
  await runner.flush();
  assert.equal(await countCalls(tmp), 2);
});

test('budget refusal and abstention are declaration-scoped advisories', async () => {
  for (const mode of ['budget_refused', 'abstained'] as const) {
    const { repo, tmp } = await makeRoot();
    const helper = await stubHelper(tmp, mode);
    const file = join(repo, 'main.bend');
    await writeFile(file, 'def dbl(a):\n  a\n');
    const messages: string[] = [];
    const runner = createWatchRunner({ sendAdvisory: message => messages.push(message), onError: error => { throw error; } });
    await runner.initialize(configFor(tmp, helper), 'test-session', repo);
    await writeFile(file, 'def dbl(a):\n  U32.add(a, a)\n');
    await runner.boundary();
    await runner.flush();
    assert.equal(messages.length, 1);
    assert.match(messages[0]!, /main\.bend:dbl/);
    assert.match(messages[0]!, mode === 'budget_refused' ? /budget_refused/ : /property_missing \(abstain\)/);
  }
});

test('negative judgments stay quiet and measured budget exhaustion is advisory', () => {
  const hash = 'a'.repeat(64);
  const expected = new Map([['main.bend:dbl', hash]]);
  assert.deepEqual(advisoryLines({
    schema_version: 'jevhelper/watch-verdicts-v1',
    declarations: [{
      target: 'main.bend:dbl', diff_sha256: hash, outcome: 'answered',
      verdicts: [{ gap: 'property_missing', abstain: false, answer: { type: 'noul', probability: 0.1 } }],
    }],
  }, expected), []);
  assert.deepEqual(advisoryLines({
    schema_version: 'jevhelper/watch-verdicts-v1',
    declarations: [{
      target: 'main.bend:dbl', diff_sha256: hash, outcome: 'failure', verdicts: [],
      failure: { kind: 'budget_exceeded' },
    }],
  }, expected), ['main.bend:dbl: budget_refused']);
});

test('typed answers remain transient while watcher states are written to tmp', async () => {
  const { repo, tmp } = await makeRoot();
  const helper = await stubHelper(tmp, 'answered');
  const file = join(repo, 'main.bend');
  await writeFile(file, 'def answer():\n  0\n');
  const messages: string[] = [];
  const runner = createWatchRunner({ sendAdvisory: message => messages.push(message), onError: error => { throw error; } });
  await runner.initialize(configFor(tmp, helper), 'test-session', repo);
  await writeFile(file, 'def answer():\n  42\n');
  await runner.boundary();
  await runner.flush();
  const generated = (await readdir(tmp)).filter(name => name.endsWith('.json'));
  assert.ok(generated.some(name => name.endsWith('-states.json')));
  assert.ok(generated.every(name => !/answer|verdict/i.test(name)));
  for (const name of generated) assert.doesNotMatch(await readFile(join(tmp, name), 'utf8'), /probability|test-jev.*answers/);
  assert.equal(messages.length, 1);
  assert.doesNotMatch(messages[0]!, /probability|0\.9|noul/);
});

test('a verdict is discarded when its declaration hash is stale', async () => {
  const { repo, tmp } = await makeRoot();
  const gate = join(tmp, 'release-helper');
  const helper = await stubHelper(tmp, 'answered', gate);
  const file = join(repo, 'main.bend');
  await writeFile(file, 'def answer():\n  0\n');
  const messages: string[] = [];
  const runner = createWatchRunner({ sendAdvisory: message => messages.push(message), onError: error => { throw error; } });
  await runner.initialize(configFor(tmp, helper), 'test-session', repo);
  await writeFile(file, 'def answer():\n  1\n');
  await runner.boundary();
  await waitFor(async () => (await countCalls(tmp)) === 1);
  await writeFile(file, 'def answer():\n  2\n');
  await writeFile(gate, 'release');
  await runner.flush();
  assert.deepEqual(messages, []);
});

test('Pi 0.85.1 reaches idle without waiting for the enabled helper process', { timeout: 10_000 }, async () => {
  const { root, repo, tmp } = await makeRoot();
  const gate = join(tmp, 'release-helper');
  const helper = await stubHelper(tmp, 'answered', gate);
  const file = join(repo, 'main.bend');
  await writeFile(file, 'def answer():\n  0\n');
  const sessionManager = SessionManager.inMemory();
  const sessionId = sessionManager.getSessionId();
  const configPath = join(tmp, 'config.json');
  await writeFile(configPath, JSON.stringify(configFor(tmp, helper, sessionId)));
  const previousConfig = process.env[SIDECAR_CONFIG_ENV];
  process.env[SIDECAR_CONFIG_ENV] = configPath;
  const faux = fauxProvider();
  faux.setResponses([fauxAssistantMessage('done')]);
  const modelRuntime = await ModelRuntime.create({
    credentials: new InMemoryCredentialStore(),
    modelsStore: new InMemoryModelsStore(),
    modelsPath: null,
    refreshOnCreate: false,
  });
  modelRuntime.registerNativeProvider(faux.provider);
  const settingsManager = SettingsManager.inMemory({ compaction: { enabled: false }, retry: { enabled: false } });
  const loader = new DefaultResourceLoader({
    cwd: repo,
    agentDir: join(root, 'agent'),
    settingsManager,
    extensionFactories: [{ name: 'jev-bend-sidecar', factory: extension }],
    noSkills: true,
    noPromptTemplates: true,
    noThemes: true,
    noContextFiles: true,
  });
  await loader.reload();
  const { session } = await createAgentSession({
    cwd: repo,
    agentDir: join(root, 'agent'),
    model: faux.getModel(),
    modelRuntime,
    resourceLoader: loader,
    sessionManager,
    settingsManager,
    noTools: 'all',
  });
  await session.bindExtensions({});
  try {
    await writeFile(file, 'def answer():\n  42\n');
    const prompt = session.prompt('Finish without using tools.');
    const returned = await Promise.race([
      prompt.then(() => true),
      new Promise<boolean>(resolveTimeout => setTimeout(() => resolveTimeout(false), 2_000)),
    ]);
    assert.equal(returned, true, 'prompt waited for the sidecar child process');
    assert.equal(session.isStreaming, false);
    await waitFor(async () => (await countCalls(tmp)) === 1);
    await writeFile(gate, 'release');
    await waitFor(async () => sessionManager.getEntries().some(entry =>
      entry.type === 'custom_message' && entry.customType === 'jev-bend-sidecar-advisory'));
    assert.equal(session.isStreaming, false);
  } finally {
    await writeFile(gate, 'release').catch(() => undefined);
    session.dispose();
    if (previousConfig === undefined) delete process.env[SIDECAR_CONFIG_ENV];
    else process.env[SIDECAR_CONFIG_ENV] = previousConfig;
  }
});

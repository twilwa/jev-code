import { spawn, type ChildProcess } from 'node:child_process';
import { createHash } from 'node:crypto';
import { lstat, readdir, readFile, realpath, writeFile } from 'node:fs/promises';
import { basename, extname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { watchBendChanges, type BendFileSet, type WatchQuestion } from '../watch.js';
import type { PiSidecarConfig } from './config.js';

const MAX_HELPER_OUTPUT_BYTES = 4 * 1024 * 1024;

interface HelperGap {
  gap: string;
  abstain: boolean;
  answer?: unknown;
}

interface HelperDeclaration {
  declaration_id: string;
  target: string;
  diff_sha256: string;
  outcome: string;
  verdicts: HelperGap[];
  failure?: { kind?: string };
}

interface HelperVerdicts {
  schema_version: 'jevhelper/watch-verdicts-v1';
  declarations: HelperDeclaration[];
}

const isInside = (parent: string, child: string): boolean => {
  const path = relative(parent, child);
  return path === '' || (!path.startsWith(`..${sep}`) && path !== '..' && !isAbsolute(path));
};

const collectBendFiles = async (root: string): Promise<BendFileSet> => {
  const files: Record<string, string> = {};
  const visit = async (directory: string): Promise<void> => {
    const entries = await readdir(directory, { withFileTypes: true });
    entries.sort((left, right) => left.name.localeCompare(right.name));
    for (const entry of entries) {
      if (entry.name === '.git' || entry.name === 'node_modules') continue;
      const absolute = join(directory, entry.name);
      if (entry.isDirectory()) await visit(absolute);
      else if (entry.isFile() && extname(entry.name).toLowerCase() === '.bend') {
        files[relative(root, absolute).split(sep).join('/')] = await readFile(absolute, 'utf8');
      }
    }
  };
  await visit(root);
  return { files };
};

const helperQuestion = (question: WatchQuestion): WatchQuestion => {
  if (question.type !== 'noul' || !question.criteria || Array.isArray(question.criteria)) return question;
  const yes = question.criteria.yes ?? question.criteria.true;
  const no = question.criteria.no ?? question.criteria.false;
  return { ...question, criteria: { true: yes ?? 'The condition holds.', false: no ?? 'The condition does not hold.' } };
};

const declarationId = (file: string, kind: string, symbol: string): string =>
  `declaration-${createHash('sha256').update(`${file}\0${kind}\0${symbol}`).digest('hex')}`;

export const watchDocument = (
  config: PiSidecarConfig,
  sessionId: string,
  base: BendFileSet,
  head: BendFileSet,
): Record<string, unknown> | undefined => {
  const result = watchBendChanges(base, head);
  if (result.chunks.length === 0) return undefined;
  return {
    schema_version: 'jevhelper/watch-input-v1',
    identity: { lane: config.lane, work_item: config.workItem, session_id: sessionId },
    model: config.model,
    states: result.chunks.map(chunk => ({
      id: declarationId(chunk.state.root.file, chunk.state.root.declarationKind, chunk.state.root.symbol),
      target: `${chunk.state.root.file}:${chunk.state.root.symbol}`,
      diff_sha256: chunk.state.root.diffSha256,
      state: chunk.state,
      evidence: {
        status: 'present',
        paths: ['root', 'astDelta', 'laws', 'evidence', 'holesAndTrust', 'ownership'],
      },
      questions: Object.fromEntries(Object.entries(chunk.questions).map(([id, question]) => [id, helperQuestion(question)])),
    })),
  };
};

const parseVerdicts = (value: string): HelperVerdicts | undefined => {
  try {
    const parsed = JSON.parse(value) as Partial<HelperVerdicts>;
    if (parsed.schema_version !== 'jevhelper/watch-verdicts-v1' || !Array.isArray(parsed.declarations)) return undefined;
    if (!parsed.declarations.every(declaration =>
      typeof declaration === 'object' && declaration !== null
      && typeof declaration.declaration_id === 'string' && declaration.declaration_id.length > 0
      && typeof declaration.target === 'string'
      && /^[0-9a-f]{64}$/.test(declaration.diff_sha256)
      && typeof declaration.outcome === 'string'
      && Array.isArray(declaration.verdicts)
      && declaration.verdicts.every(verdict => typeof verdict?.gap === 'string' && typeof verdict.abstain === 'boolean'))) return undefined;
    return parsed as HelperVerdicts;
  } catch {
    return undefined;
  }
};

const collect = (stream: NodeJS.ReadableStream | null, limit: number): Promise<string> => new Promise((resolveText, reject) => {
  if (!stream) return resolveText('');
  const chunks: Buffer[] = [];
  let size = 0;
  stream.on('data', (chunk: Buffer | string) => {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += buffer.length;
    if (size > limit) reject(new Error('helper output limit exceeded'));
    else chunks.push(buffer);
  });
  stream.on('error', reject);
  stream.on('end', () => resolveText(Buffer.concat(chunks).toString('utf8')));
});

const runHelper = async (
  config: PiSidecarConfig,
  document: Record<string, unknown>,
  cwd: string,
  tmpDir: string,
  active: Set<ChildProcess>,
): Promise<HelperVerdicts | undefined> => {
  const safeSessionId = config.sessionId.replace(/[^A-Za-z0-9._-]/g, '_');
  const budgetFile = resolve(tmpDir, `jevhelper-budget-${safeSessionId}.json`);
  if (!isInside(tmpDir, budgetFile)) throw new Error('budget path escaped tmpDir');
  const args = [
    'watch', '--mode', 'live', '--answers-fd', '3', '--workers', '1', '--retries', '0',
    '--timeout-seconds', String(config.timeoutSeconds),
    '--max-calls', String(config.budget.maxCallsPerTurn),
    '--max-tokens', String(config.budget.maxTokensPerTurn),
    '--budget-file', budgetFile,
    '--lane-max-calls', String(config.budget.maxCallsPerSession),
    '--lane-max-tokens', String(config.budget.maxTokensPerSession),
  ];
  const child = spawn(config.jevhelperPath, args, {
    cwd,
    env: process.env,
    stdio: ['pipe', 'pipe', 'pipe', 'pipe'],
  });
  active.add(child);
  let forceKill: ReturnType<typeof setTimeout> | undefined;
  const deadline = setTimeout(() => {
    child.kill('SIGTERM');
    forceKill = setTimeout(() => child.kill('SIGKILL'), 1_000);
  }, (config.timeoutSeconds * (config.budget.maxCallsPerTurn + 1) + 1) * 1_000);
  const stdout = collect(child.stdout, MAX_HELPER_OUTPUT_BYTES);
  const stderr = collect(child.stderr, MAX_HELPER_OUTPUT_BYTES);
  const answers = collect(child.stdio[3] as NodeJS.ReadableStream | null, MAX_HELPER_OUTPUT_BYTES);
  child.stdin?.on('error', () => undefined);
  child.stdin?.end(JSON.stringify(document));
  const exit = new Promise<number | null>((resolveExit, reject) => {
    child.once('error', reject);
    child.once('close', resolveExit);
  });
  try {
    const [code, , , answerText] = await Promise.all([exit, stdout, stderr, answers]);
    if (code !== 0 && answerText.trim() === '') return undefined;
    return parseVerdicts(answerText);
  } catch (error) {
    child.kill('SIGTERM');
    throw error;
  } finally {
    clearTimeout(deadline);
    clearTimeout(forceKill);
    active.delete(child);
  }
};

const reportsGap = (verdict: HelperGap): boolean => {
  if (verdict.abstain) return true;
  if (typeof verdict.answer !== 'object' || verdict.answer === null) return false;
  const answer = verdict.answer as Record<string, unknown>;
  if (answer.type === 'noul') return typeof answer.probability === 'number' && answer.probability >= 0.5;
  if (answer.type === 'score') return typeof answer.score === 'number' && answer.score >= 1;
  if (answer.type === 'choice') return typeof answer.choice === 'string' && answer.choice !== 'abstain';
  return false;
};

export const advisoryLines = (verdicts: HelperVerdicts, expected: Map<string, string>): string[] => {
  const lines: string[] = [];
  for (const declaration of verdicts.declarations) {
    if (expected.get(declaration.declaration_id) !== declaration.diff_sha256) continue;
    const target = declaration.target.replace(/[\r\n\t]/g, ' ');
    if (declaration.outcome === 'budget_refused'
      || (declaration.outcome === 'failure' && declaration.failure?.kind === 'budget_exceeded')) {
      lines.push(`${target}: budget_refused`);
      continue;
    }
    if (declaration.verdicts.length === 0 && declaration.outcome === 'abstained') {
      lines.push(`${target}: abstain`);
      continue;
    }
    for (const verdict of declaration.verdicts) {
      const gap = verdict.gap.replace(/[\r\n\t]/g, ' ');
      if (reportsGap(verdict)) lines.push(`${target}: ${gap}${verdict.abstain ? ' (abstain)' : ''}`);
    }
  }
  return [...new Set(lines)];
};

export interface RunnerOptions {
  sendAdvisory: (content: string) => void;
  onError?: (error: unknown) => void;
}

export const createWatchRunner = (options: RunnerOptions) => {
  const active = new Set<ChildProcess>();
  let config: PiSidecarConfig | undefined;
  let sessionId = '';
  let root = '';
  let previous: BendFileSet | undefined;
  let boundary = 0;
  let queue: Promise<void> = Promise.resolve();
  let closed = false;
  let generation = 0;
  const runId = `${process.pid}-${Date.now().toString(36)}`;

  return {
    async initialize(nextConfig: PiSidecarConfig | undefined, nextSessionId: string, cwd: string): Promise<void> {
      generation++;
      closed = false;
      config = nextConfig;
      sessionId = nextSessionId;
      root = resolve(cwd);
      previous = config ? await collectBendFiles(root) : undefined;
    },

    async boundary(): Promise<void> {
      if (!config || !previous || closed) return;
      const activeConfig = config;
      const activeGeneration = generation;
      const activeRoot = root;
      const activeSessionId = sessionId;
      const base = previous;
      const head = await collectBendFiles(activeRoot);
      if (closed || generation !== activeGeneration) return;
      previous = head;
      const document = watchDocument(activeConfig, activeSessionId, base, head);
      if (!document) return;
      boundary++;
      const directory = await realpath(activeConfig.tmpDir);
      if (!(await lstat(directory)).isDirectory()) return;
      const statePath = resolve(directory, `bend-sidecar-${basename(activeSessionId)}-${runId}-${boundary}-states.json`);
      if (!isInside(directory, statePath)) return;
      await writeFile(statePath, `${JSON.stringify(document)}\n`, { encoding: 'utf8', mode: 0o600, flag: 'wx' });
      queue = queue.then(async () => {
        if (closed || generation !== activeGeneration) return;
        const verdicts = await runHelper(activeConfig, document, activeRoot, directory, active);
        if (!verdicts || closed || generation !== activeGeneration) return;
        const current = watchDocument(activeConfig, activeSessionId, base, await collectBendFiles(activeRoot));
        const fresh = new Map((current?.states as Array<{ id: string; diff_sha256: string }> | undefined)
          ?.map(state => [state.id, state.diff_sha256]) ?? []);
        const lines = advisoryLines(verdicts, fresh);
        if (lines.length > 0) options.sendAdvisory(`Jev Bend sidecar advisory\n${lines.map(line => `- ${line}`).join('\n')}`);
      }).catch(error => options.onError?.(error));
    },

    async flush(): Promise<void> {
      await queue;
    },

    reset(): void {
      generation++;
      closed = true;
      config = undefined;
      previous = undefined;
      for (const child of active) child.kill('SIGTERM');
      active.clear();
    },
  };
};

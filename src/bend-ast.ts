import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { choice } from '@typesafe-ai/sdk';
import type { AstAdapter } from './ast-adapters.js';
import { buildDecisionContext, PENDING, windowSource } from './decision-context.js';
import type { Decisions, State } from './decisions.js';
import type { GenerateOptions } from './generation.js';
import { gridCursor } from './grid.js';
import { vocabulary } from './lang/core.js';
import { compactContext, MAX_GRID_REQUEST_BYTES } from './scored-grid.js';
import { LimitError } from './types.js';

/**
 * Bend 2 has no `if` and no reassignment, so it cannot be expressed as a shared
 * Dialect: src/lang/core.ts offers both productions ungated. This adapter owns
 * its own tree instead. See docs/bend2-pilot/03-tickets.md section 1.
 */

/** bend2/bend.ts:1532 at pin 7561656155a4285c1e4ccfcb3505ab59524de973. */
export const BEND_KEYWORDS = new Set(['def', 'type', 'law', 'match', 'case', 'do', 'return', 'for', 'exs', 'where', 'is', 'import', 'Type', 'Data', 'Kind', 'Quant']);

export type BendType = 'U32' | 'String' | 'Bool';

export type BendExpr =
  | { kind: 'hole' }
  | { kind: 'u32'; value: number }
  | { kind: 'str'; value: string }
  | { kind: 'name'; id: string }
  | { kind: 'call'; callee: string; args: BendExpr[] };

export interface BendParam { id: string; type: BendType }
/** Helper definitions use the inline `def f(a: T) -> R:` form; no `law` block is emitted (probe p17). */
export interface BendDef { id: string; params: BendParam[]; returns: BendType; body: BendExpr }

export type BendStep =
  | { kind: 'hole' }
  | { kind: 'bind'; id: string; type: BendType; value: BendExpr }
  | { kind: 'print'; value: BendExpr };

export interface BendProgram { defs: BendDef[]; steps: BendStep[]; result: BendExpr }

export interface BendBuiltin { params: BendType[]; returns: BendType; doc: string }
/** Every entry is defined in the pinned Base prelude; line numbers are bend2/base.bend. */
export const BEND_BUILTINS: Record<string, BendBuiltin> = {
  'U32.add': { params: ['U32', 'U32'], returns: 'U32', doc: 'Add two U32 values (base.bend:1343).' },
  'U32.sub': { params: ['U32', 'U32'], returns: 'U32', doc: 'Subtract the second U32 from the first (base.bend:1359).' },
  'U32.mul': { params: ['U32', 'U32'], returns: 'U32', doc: 'Multiply two U32 values (base.bend:1364).' },
  'U32.is_eq': { params: ['U32', 'U32'], returns: 'Bool', doc: 'Test two U32 values for equality (base.bend:1418).' },
  'U32.show': { params: ['U32'], returns: 'String', doc: 'Render a U32 as a String (base.bend:2135).' },
  'Bool.show': { params: ['Bool'], returns: 'String', doc: 'Render a Bool as a String (base.bend:2166).' },
  'String.append': { params: ['String', 'String'], returns: 'String', doc: 'Join two Strings (base.bend:1774).' },
};

const MAX_DEPTH = 3;
const MAX_STEPS_IN_BLOCK = 6;

export const renderExpr = (expr: BendExpr): string => {
  switch (expr.kind) {
    case 'hole': return PENDING;
    case 'u32': return String(expr.value);
    case 'str': return JSON.stringify(expr.value);
    case 'name': return expr.id;
    case 'call': return `${expr.callee}(${expr.args.map(renderExpr).join(', ')})`;
  }
};

/**
 * Binders are emitted copyable (`+`). Bend 2 bindings are affine: dropping one
 * is legal (probe p3) but using one twice fails `book_valid` (probes p4, p10),
 * and the `+` prefix is what lifts that restriction (probes p8, p11).
 */
export const render = (program: BendProgram): string => {
  const lines = ['import Base', ''];
  for (const def of program.defs) {
    lines.push(`def ${def.id}(${def.params.map(p => `+${p.id}: ${p.type}`).join(', ')}) -> ${def.returns}:`, `  ${renderExpr(def.body)}`, '');
  }
  lines.push('def main() -> IO(Unit):', '  do IO<Unit>:');
  let sequenced = 0;
  for (const step of program.steps) {
    if (step.kind === 'hole') lines.push(`    ${PENDING}`);
    else if (step.kind === 'bind') lines.push(`    +${step.id} : ${step.type} = ${renderExpr(step.value)}`);
    else lines.push(`    u${sequenced++} : Unit <- IO.print(${renderExpr(step.value)})`);
  }
  lines.push(`    IO.print(${renderExpr(program.result)})`);
  return lines.join('\n') + '\n';
};

export const hasHole = (expr: BendExpr): boolean => expr.kind === 'hole' || (expr.kind === 'call' && expr.args.some(hasHole));

/**
 * The four stages the real checker reports separately. A rejection at `type`
 * is a typing result, never a parse result; see docs/bend2-pilot/03-tickets.md
 * ticket T10.
 */
export type BendStage = 'parse' | 'type' | 'owned' | 'holes';

export class BendCheckError extends Error {
  readonly stage: BendStage;
  constructor(stage: BendStage, message: string) {
    super(message);
    this.name = 'BendCheckError';
    this.stage = stage;
  }
}

export const BEND_PATH_ENV = 'JEV_BEND_PATH';
const MISSING_CHECKER = `Bend validation needs the Bend 2 checker: set ${BEND_PATH_ENV} to a bendlang/bend checkout (pinned 7561656155a4285c1e4ccfcb3505ab59524de973). Upstream sources are not vendored here.`;

interface BendModule {
  book_nil(): { hols: number; open: number };
  book_load(book: unknown, file: string, ns: string, seen: Map<string, string | null>): Promise<number>;
  book_valid(book: unknown, done: number): void;
  err_show(err: unknown): string;
}
interface CompModule { SYNTH: string[]; book_owned(book: unknown, kinds: string[]): void }

let checker: Promise<{ Bend: BendModule; Comp: CompModule }> | undefined;

/**
 * Loads the checker out of a referenced checkout rather than a vendored copy,
 * because the jev-code licence question is unresolved (01-inspection.md, 2).
 * Node resolves the `.ts` entry points by type-stripping, with no build step.
 */
const loadChecker = async (): Promise<{ Bend: BendModule; Comp: CompModule }> => {
  const root = process.env[BEND_PATH_ENV];
  if (!root) throw new Error(MISSING_CHECKER);
  checker ??= (async () => {
    try {
      const Bend = await import(pathToFileURL(join(root, 'bend2', 'bend.ts')).href) as BendModule;
      const Comp = await import(pathToFileURL(join(root, 'bend2', 'comp.ts')).href) as CompModule;
      if (typeof Bend.book_load !== 'function' || typeof Comp.book_owned !== 'function') throw new Error('not a bendlang/bend checkout');
      return { Bend, Comp };
    } catch (cause) {
      throw new Error(`${MISSING_CHECKER} Loading ${root} failed: ${cause instanceof Error ? cause.message : String(cause)}`, { cause });
    }
  })();
  return checker;
};

/** Exported for tests; a fresh process would not need it. */
export const resetBendChecker = (): void => { checker = undefined; };

const describe = (error: unknown, show: (err: unknown) => string): string => {
  const structured = error as { $?: string } | null;
  if (structured && structured.$ === 'Err') { try { return show(error).slice(0, 4000); } catch { return 'Bend reported an error it could not render.'; } }
  return (error instanceof Error ? error.message : String(error)).slice(0, 4000);
};

/**
 * Drives the checker's own pipeline (bend2/main.ts:577-596) and reports which
 * stage refused. Parse, typing and ownership stay three separate verdicts, and
 * nothing generated is executed.
 */
export const checkBendFile = async (file: string, signal: AbortSignal): Promise<void> => {
  signal.throwIfAborted();
  const { Bend, Comp } = await loadChecker();
  const book = Bend.book_nil();
  try { await Bend.book_load(book, file, '', new Map()); }
  catch (error) { throw new BendCheckError('parse', `Bend parse failed: ${describe(error, Bend.err_show)}`); }
  signal.throwIfAborted();
  try { Bend.book_valid(book, 0); }
  catch (error) { throw new BendCheckError('type', `Bend type check failed: ${describe(error, Bend.err_show)}`); }
  signal.throwIfAborted();
  try { Comp.book_owned(book, Comp.SYNTH); }
  catch (error) { throw new BendCheckError('owned', `Bend ownership check failed: ${describe(error, Bend.err_show)}`); }
  const holes = book.hols + book.open;
  if (holes > 0) throw new BendCheckError('holes', `Bend reports ${holes} TODO${holes === 1 ? '' : 's'}; the program is incomplete and is not a valid proof.`);
};

export const validateBendSource = async (source: string, signal: AbortSignal): Promise<void> => {
  signal.throwIfAborted();
  const dir = await mkdtemp(join(tmpdir(), 'jev-bend-'));
  try {
    const file = join(dir, 'main.bend');
    await writeFile(file, source);
    await checkBendFile(file, signal);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
};

const identifierFrom = (value: string): string => value.replace(/[^A-Za-z0-9_]/g, '').replace(/^[0-9]+/, '').toLowerCase();

export async function generateBendAst(decisions: Decisions, state: State, field: string, options: GenerateOptions): Promise<string> {
  const task = state.task as { prompt?: string; updates?: string[] } | undefined;
  const objective = [task?.prompt ?? '', ...(task?.updates ?? [])].join('\n');
  const context = compactContext(state);
  const vocab = vocabulary(objective, BEND_KEYWORDS);
  const program: BendProgram = { defs: [], steps: [], result: { kind: 'hole' } };
  const scope = new Map<string, BendType>();
  let step = 0;

  async function pick(slot: string, criteria: Record<string, string>, depth = 0): Promise<string> {
    decisions.signal.throwIfAborted();
    if (++step > options.maxSteps) throw new LimitError(`Bend AST production budget exhausted (${options.maxSteps}).`);
    const keys = Object.keys(criteria);
    if (!keys.length) throw new Error(`No valid Bend AST production for ${slot}.`);
    const preview = render(program);
    const instruction = `Choose the next valid Bend 2 AST production for ${slot}. The rendered source marks the slot being filled with ${PENDING}. Satisfy the objective with the smallest sufficient program. Complete the current slot only; do not add unrequested behavior.`;
    const symbolTable = { ...Object.fromEntries([...scope].map(([id, type]) => [id, { kind: 'binding', type }])),
      ...Object.fromEntries(program.defs.map(def => [def.id, { kind: 'function', params: def.params.map(p => p.type), returns: def.returns }])),
      ...Object.fromEntries(Object.entries(BEND_BUILTINS).map(([id, b]) => [id, { kind: 'builtin', params: b.params, returns: b.returns }])) };
    const symbols = Object.keys(symbolTable);
    const questions = { selection: choice(instruction, criteria) };
    const core = { field, phase: 'ast', slot, symbols, symbolTable, language: 'bend',
      constraints: { depth, maxDepth: MAX_DEPTH, remainingSteps: options.maxSteps - step } };
    const assemble = (values: Record<string, unknown>): State => ({
      task: values.task, ...(values.recent === undefined ? {} : { recent: values.recent }), ...(values.plan === undefined ? {} : { plan: values.plan }),
      generation: { ...core, partialSource: values.source, ...(values.trimmed === undefined ? {} : { trimmed: values.trimmed }) },
    });
    const { values, trimmed } = buildDecisionContext([
      { key: 'task', value: { prompt: objective }, required: true },
      { key: 'core', value: core, required: true },
      { key: 'source', value: preview, shrink: windowSource },
      { key: 'recent', value: context.recent ?? [] },
      ...(typeof context.plan === 'string' && context.plan ? [{ key: 'plan', value: context.plan }] : []),
    ], parts => Buffer.byteLength(JSON.stringify({ state: assemble(parts), questions })), MAX_GRID_REQUEST_BYTES);
    const selected = keys.length === 1 ? keys[0]! : await decisions.choose(assemble(trimmed.length ? { ...values, trimmed } : values), instruction, criteria);
    await options.onText?.(field, preview, false, { replace: preview }, { decoder: 'ast', step, cursor: gridCursor(preview), bytes: Buffer.byteLength(preview), ast: { slot, production: selected, symbols } });
    return selected;
  }

  async function chooseFrom<T>(slot: string, items: T[], label: (item: T) => string, depth = 0): Promise<T> {
    const selected = await pick(slot, Object.fromEntries(items.map((item, index) => [`opt_${index}`, label(item)])), depth);
    return items[Number(selected.slice(4))]!;
  }

  const reserved = new Set(['main', 'Base', 'Unit', 'IO']);

  async function freshIdentifier(slot: string): Promise<string> {
    const taken = new Set([...scope.keys(), ...program.defs.map(def => def.id), ...reserved]);
    const candidates = vocab.identifiers.map(identifierFrom)
      .filter(id => /^[a-z_][A-Za-z0-9_]*$/.test(id) && !BEND_KEYWORDS.has(id) && !taken.has(id) && !(id in BEND_BUILTINS));
    const pool = [...new Set(candidates)].slice(0, 64);
    if (!pool.length) throw new Error('No Bend identifier is available for a new binding.');
    return chooseFrom(slot, pool, id => `Name it ${id}.`);
  }

  const calleesFor = (want: BendType): Array<{ id: string; params: BendType[]; doc: string }> => [
    ...Object.entries(BEND_BUILTINS).filter(([, b]) => b.returns === want).map(([id, b]) => ({ id, params: b.params, doc: b.doc })),
    ...program.defs.filter(def => def.returns === want).map(def => ({ id: def.id, params: def.params.map(p => p.type), doc: `Call the generated ${def.id}.` })),
  ];

  /**
   * Bool has no literal form in this subset, so it is only reachable through a
   * call. A callee is only offered when every argument it needs can still be
   * built within the depth budget; otherwise generation would strand itself.
   */
  const producible = (want: BendType, depth: number): boolean =>
    want === 'U32' || want === 'String' || [...scope.values()].includes(want)
    || (depth < MAX_DEPTH && calleesFor(want).some(fn => fn.params.every(param => producible(param, depth + 1))));

  async function expression(want: BendType, slot: string, depth: number): Promise<BendExpr> {
    const names = [...scope].filter(([, type]) => type === want).map(([id]) => id);
    const callable = calleesFor(want).filter(fn => fn.params.every(param => producible(param, depth + 1)));
    const criteria: Record<string, string> = {};
    if (want === 'U32') criteria.u32 = 'A U32 numeric literal.';
    if (want === 'String') criteria.str = 'A String literal.';
    if (names.length) criteria.name = 'Reference an already bound name.';
    if (depth < MAX_DEPTH && callable.length) criteria.call = 'Apply a function to arguments.';
    if (!Object.keys(criteria).length) throw new Error(`No Bend expression can produce a ${want} here.`);
    const production = await pick(slot, criteria, depth);
    if (production === 'u32') {
      const pool = [...new Set(vocab.numbers.filter(n => Number.isInteger(n) && n >= 0 && n <= 4294967295))].slice(0, 64);
      return { kind: 'u32', value: await chooseFrom(`${slot}:u32`, pool.length ? pool : [0], n => String(n), depth) };
    }
    if (production === 'str') {
      const pool = [...new Set(vocab.strings.filter(s => Buffer.byteLength(s) <= 200))].slice(0, 64);
      return { kind: 'str', value: await chooseFrom(`${slot}:string`, pool.length ? pool : [''], s => JSON.stringify(s), depth) };
    }
    if (production === 'name') return { kind: 'name', id: await chooseFrom(`${slot}:reference`, names, id => id, depth) };
    const fn = await chooseFrom(`${slot}:callee`, callable, item => item.doc, depth);
    const args: BendExpr[] = [];
    for (const [index, param] of fn.params.entries()) args.push(await expression(param, `${slot}:argument_${index}`, depth + 1));
    return { kind: 'call', callee: fn.id, args };
  }

  if (await pick('helper_definition', { none: 'No helper definition is needed.', one: 'Define one helper function used by main.' }) === 'one') {
    const id = await freshIdentifier('definition_name');
    reserved.add(id);
    const count = Number(await pick('parameter_count', { '1': 'One parameter.', '2': 'Two parameters.' }));
    const params: BendParam[] = [];
    for (let index = 0; index < count; index++) params.push({ id: await freshIdentifier(`parameter_${index}`), type: 'U32' });
    for (const param of params) scope.set(param.id, param.type);
    // The body is built before the definition joins program.defs, so the
    // definition cannot call itself: recursion is outside the supported subset.
    const body = await expression('U32', 'definition_body', 0);
    for (const param of params) scope.delete(param.id);
    program.defs.push({ id, params, returns: 'U32', body });
  }

  while (program.steps.length < MAX_STEPS_IN_BLOCK) {
    const criteria: Record<string, string> = { bind: 'Bind a new named value for later use.', print: 'Print a line now, then continue.', finish: 'The block needs only its final printed line; finish it.' };
    const production = await pick('do_block', criteria);
    if (production === 'finish') break;
    if (production === 'print') { program.steps.push({ kind: 'print', value: await expression('String', `step_${program.steps.length}`, 0) }); continue; }
    const type = await pick('binding_type', { U32: 'A U32 number.', String: 'A String.' }) as BendType;
    const id = await freshIdentifier(`binding_${program.steps.length}`);
    program.steps.push({ kind: 'hole' });
    const value = await expression(type, `binding_${program.steps.length - 1}_value`, 0);
    program.steps[program.steps.length - 1] = { kind: 'bind', id, type, value };
    scope.set(id, type);
  }
  program.result = await expression('String', 'final_print', 0);

  const source = render(program);
  if (hasHole(program.result) || program.steps.some(s => s.kind === 'hole')) throw new Error('Bend AST generation left an unfilled slot.');
  if (Buffer.byteLength(source) > options.maxBytes) throw new LimitError(`Bend AST source exceeds its byte budget (${options.maxBytes}).`);
  return source;
}

export const bendAstAdapter: AstAdapter = {
  id: 'bend', extensions: ['.bend'], languages: ['bend'],
  generate: generateBendAst, validate: validateBendSource,
};

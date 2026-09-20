import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { AstRegistry, installAstModule, loadAstModule } from '../src/ast-adapters.js';
import {
  BEND_BUILTINS, BEND_KEYWORDS, BEND_PATH_ENV, BendCheckError, bendAstAdapter,
  generateBendAst, render, renderExpr, resetBendChecker, validateBendSource,
  type BendProgram,
} from '../src/bend-ast.js';
import { PENDING } from '../src/decision-context.js';
import { Decisions } from '../src/decisions.js';
import { scripted, type Script } from './lang-helpers.js';

const here = dirname(fileURLToPath(import.meta.url));
const probes = join(here, '..', 'docs', 'bend2-pilot', 'evidence');
const signal = (): AbortSignal => new AbortController().signal;

/**
 * The checker is a referenced bendlang/bend checkout, never vendored: the
 * jev-code licence question is unresolved. Without it the compiler-backed
 * assertions are skipped and therefore UNVERIFIED, not passed.
 */
const checkerAvailable = (): boolean => {
  const root = process.env[BEND_PATH_ENV];
  return Boolean(root) && existsSync(join(root!, 'bend2', 'bend.ts'));
};
const skipWithoutChecker = `set ${BEND_PATH_ENV} to a bendlang/bend checkout`;

const run = (prompt: string, script: Script, maxSteps = 200): Promise<string> =>
  generateBendAst(new Decisions(scripted(script), 400, signal()), { task: { prompt } }, 'content',
    { maxSteps, maxBytes: 20_000, allowEmpty: false, fragments: [] });

// ---------------------------------------------------------------------------
// Unit: the renderer
// ---------------------------------------------------------------------------

test('renderer emits the do-block form the probes proved legal', () => {
  const program: BendProgram = {
    defs: [{ id: 'add2', params: [{ id: 'a', type: 'U32' }, { id: 'b', type: 'U32' }], returns: 'U32',
      body: { kind: 'call', callee: 'U32.add', args: [{ kind: 'name', id: 'a' }, { kind: 'name', id: 'b' }] } }],
    steps: [
      { kind: 'bind', id: 'x', type: 'U32', value: { kind: 'u32', value: 6 } },
      { kind: 'print', value: { kind: 'str', value: 'first' } },
    ],
    result: { kind: 'call', callee: 'U32.show', args: [{ kind: 'call', callee: 'add2', args: [{ kind: 'name', id: 'x' }, { kind: 'u32', value: 7 }] }] },
  };
  assert.equal(render(program), [
    'import Base',
    '',
    'def add2(+a: U32, +b: U32) -> U32:',
    '  U32.add(a, b)',
    '',
    'def main() -> IO(Unit):',
    '  do IO<Unit>:',
    '    +x : U32 = 6',
    '    u0 : Unit <- IO.print("first")',
    '    IO.print(U32.show(add2(x, 7)))',
  ].join('\n') + '\n');
});

test('renderer marks every do-block binder copyable, which probe p10 shows is load bearing', () => {
  const source = render({ defs: [], steps: [{ kind: 'bind', id: 'x', type: 'U32', value: { kind: 'u32', value: 21 } }],
    result: { kind: 'str', value: 'done' } });
  const binders = source.split('\n').filter(line => / : (U32|String) = /.test(line));
  assert.equal(binders.length, 1);
  for (const line of binders) assert.match(line, /^ {4}\+/, `binder is not copyable: ${line}`);
});

test('renderer escapes string literals and shows holes as the pending marker', () => {
  assert.equal(renderExpr({ kind: 'str', value: 'a"b\n' }), '"a\\"b\\n"');
  assert.equal(renderExpr({ kind: 'hole' }), PENDING);
});

test('builtin table names only functions the pinned Base prelude defines', () => {
  assert.ok(!('U32.eq' in BEND_BUILTINS), 'U32.eq does not exist; the prelude defines U32.is_eq');
  assert.deepEqual(BEND_BUILTINS['U32.is_eq'], { params: ['U32', 'U32'], returns: 'Bool', doc: 'Test two U32 values for equality (base.bend:1418).' });
  assert.ok(!BEND_KEYWORDS.has('if'), 'Bend 2 has no if; bend2/bend.ts:1532');
  assert.ok(!BEND_KEYWORDS.has('let'), 'Bend 2 has no let; bend2/bend.ts:1532');
});

// ---------------------------------------------------------------------------
// Unit: the decision loop
// ---------------------------------------------------------------------------

const helperScript: Script = ({ slot, criteria }, n) => {
  switch (slot) {
    case 'helper_definition': return 'one';
    case 'definition_name': return 'Name it total.';
    case 'parameter_count': return '2';
    case 'parameter_0': return 'Name it a.';
    case 'parameter_1': return 'Name it b.';
    case 'definition_body': return 'call';
    case 'definition_body:callee': return 'Add two U32 values (base.bend:1343).';
    case 'definition_body:argument_0': return 'name';
    case 'definition_body:argument_1': return 'name';
    case 'definition_body:argument_0:reference': return 'a';
    case 'definition_body:argument_1:reference': return 'b';
    case 'do_block': return n === 0 ? 'bind' : 'finish';
    case 'binding_type': return 'U32';
    case 'binding_0': return 'Name it count.';
    case 'binding_0_value': return 'u32';
    case 'final_print': return 'call';
    case 'final_print:callee': return 'Render a U32 as a String (base.bend:2135).';
    case 'final_print:argument_0': return 'call';
    case 'final_print:argument_0:callee': return 'Call the generated total.';
    case 'final_print:argument_0:argument_0': return 'name';
    case 'final_print:argument_0:argument_1': return 'u32';
    default: return criteria[0]!;
  }
};

test('generator builds a helper definition and a do block from scripted productions', async () => {
  const source = await run('count items and print the total', helperScript);
  assert.match(source, /^import Base\n/);
  assert.match(source, /^def total\(\+a: U32, \+b: U32\) -> U32:\n {2}U32\.add\(a, b\)$/m);
  assert.match(source, /^def main\(\) -> IO\(Unit\):\n {2}do IO<Unit>:$/m);
  assert.match(source, /^ {4}\+count : U32 = \d+$/m);
  assert.match(source, /^ {4}IO\.print\(U32\.show\(total\(count, \d+\)\)\)\n$/m);
});

test('generator offers no production that would reference an unbound name', async () => {
  // The first do-block decision happens with an empty scope, so `name` must not
  // be offered for the binding value: an unbound reference would be a type error.
  const offered: string[] = [];
  await run('print a message', ({ slot, criteria }, n) => {
    if (slot === 'binding_0_value') offered.push(...criteria);
    switch (slot) {
      case 'helper_definition': return 'none';
      case 'do_block': return n === 0 ? 'bind' : 'finish';
      case 'binding_type': return 'U32';
      case 'binding_0': return criteria[0]!;
      case 'binding_0_value': return 'u32';
      case 'final_print': return 'str';
      default: return criteria[0]!;
    }
  });
  assert.ok(offered.length, 'binding value slot was never reached');
  assert.ok(!offered.includes('name'), `name offered with nothing in scope: ${offered.join(', ')}`);
});

test('a provider that picks the first option for both parameter slots still gets two distinct binders', async () => {
  // Both parameter slots are offered before either name reaches the scope, so
  // without reserving each as it is chosen the identical pool lets a provider
  // name the same binder twice: `def f(+a: U32, +a: U32)`.
  const pools: Record<string, string[]> = {};
  const source = await run('count items and print the total message', ({ slot, criteria }, n) => {
    if (/^parameter_\d+$/.test(slot)) pools[slot] = [...criteria];
    switch (slot) {
      case 'helper_definition': return 'one';
      case 'parameter_count': return '2';
      case 'definition_body': return 'name';
      case 'do_block': return 'finish';
      case 'final_print': return n === 0 ? 'str' : criteria[0]!;
      default: return criteria[0]!;      // always the first option on offer
    }
  });
  assert.deepEqual(Object.keys(pools).sort(), ['parameter_0', 'parameter_1'],
    'both parameter slots must be reached for this test to mean anything');
  const binders = /^def \w+\(\+(\w+): U32, \+(\w+): U32\) ->/m.exec(source);
  assert.ok(binders, `expected a two-parameter definition:\n${source}`);
  assert.notEqual(binders[1], binders[2], `duplicate parameter binder:\n${source}`);
});

/**
 * Measured, not assumed: the checker accepts `def dup(+a: U32, +a: U32)`,
 * treating the second binder as shadowing rather than as an error. So no
 * compiler stage guards the defect above; the renderer assertion is the guard,
 * and this test records why.
 */
test('the real Bend checker accepts a duplicate parameter binder, so no stage catches it', { skip: checkerAvailable() ? false : skipWithoutChecker }, async () => {
  resetBendChecker();
  await validateBendSource('import Base\n\ndef dup(+a: U32, +a: U32) -> U32:\n  U32.add(a, a)\n\ndef main() -> IO(Unit):\n  do IO<Unit>:\n    IO.print(U32.show(dup(1, 2)))\n', signal());
});

test('generator refuses to exceed its production budget', async () => {
  await assert.rejects(run('print a message', ({ criteria }) => criteria[0]!, 3), /budget exhausted/);
});

// ---------------------------------------------------------------------------
// Registry: identity, routing, bundling
// ---------------------------------------------------------------------------

test('bend registers alongside the existing adapters without claiming their extensions', () => {
  const registry = new AstRegistry();
  const bend = registry.list().find(adapter => adapter.id === 'bend');
  assert.ok(bend, 'bend is not registered by default');
  assert.deepEqual(bend.extensions, ['.bend']);
  assert.deepEqual(bend.languages, ['bend']);
  assert.equal(registry.resolve({ argumentsSoFar: { path: 'main.ts' } })?.id, 'typescript');
  assert.equal(registry.resolve({ argumentsSoFar: { path: 'main.mjs' } })?.id, 'javascript');
});

test('registry rejects a malformed bend adapter rather than accepting it', () => {
  assert.throws(() => new AstRegistry([{ ...bendAstAdapter, id: 'Bend' }]), /valid id/);
  assert.throws(() => new AstRegistry([{ ...bendAstAdapter, id: 'bend-copy', extensions: ['.rs'] }]), /Conflicting AST extension/);
  assert.throws(() => new AstRegistry([bendAstAdapter]), /Duplicate AST adapter: bend/);
});

test('bend routes from a .bend path and from a prompt naming the language', () => {
  const registry = new AstRegistry();
  assert.equal(registry.resolve({ argumentsSoFar: { path: 'main.bend' } })?.id, 'bend');
  assert.equal(registry.resolve({ argumentsSoFar: { path: '/tmp/Deep/MAIN.BEND' } })?.id, 'bend');
  assert.equal(registry.resolve({ task: { prompt: 'Write a Bend program that prints a total.' } })?.id, 'bend');
});

test('builtin:bend resolves through the install path and writes no configuration', async () => {
  const { mkdtemp, rm } = await import('node:fs/promises');
  const { tmpdir } = await import('node:os');
  const root = await mkdtemp(join(tmpdir(), 'jev-bend-install-'));
  try {
    assert.deepEqual(await installAstModule(root, 'builtin:bend'), ['bend']);
    assert.deepEqual((await loadAstModule(root, 'builtin:bend')).map(adapter => adapter.id), ['bend']);
    const { loadInstalledAsts } = await import('../src/ast-adapters.js');
    assert.equal((await loadInstalledAsts(root)).length, 0);
  } finally { await rm(root, { recursive: true, force: true }); }
});

// ---------------------------------------------------------------------------
// Validation: the real checker, and what it refuses
// ---------------------------------------------------------------------------

test('validate fails closed when the Bend checker is absent, rather than passing valid source', async () => {
  const saved = process.env[BEND_PATH_ENV];
  delete process.env[BEND_PATH_ENV];
  resetBendChecker();
  try {
    const valid = await readFile(join(probes, 'bend-probe', 'ok.bend'), 'utf8');
    await assert.rejects(validateBendSource(valid, signal()), new RegExp(BEND_PATH_ENV));
  } finally {
    if (saved === undefined) delete process.env[BEND_PATH_ENV]; else process.env[BEND_PATH_ENV] = saved;
    resetBendChecker();
  }
});

test('the real Bend checker accepts a valid program (parse, type and ownership stages)', { skip: checkerAvailable() ? false : skipWithoutChecker }, async () => {
  resetBendChecker();
  await validateBendSource(await readFile(join(probes, 'bend-probe', 'ok.bend'), 'utf8'), signal());
});

const rejections: Array<{ file: string; stage: string; why: string }> = [
  { file: join(probes, 'bend-probe', 'bad1-syntax-error.bend'), stage: 'parse', why: 'unbalanced parameter list' },
  { file: join(probes, 'bend-probe', 'bad2-type-error.bend'), stage: 'type', why: 'String body under a U32 law' },
  { file: join(probes, 'design-probe', 'p4-param-used-twice.bend'), stage: 'type', why: 'affine parameter consumed twice' },
  { file: join(probes, 'design-probe', 'p10-let-reuse.bend'), stage: 'type', why: 'affine binding consumed twice' },
];

for (const { file, stage, why } of rejections) {
  test(`the real Bend checker refuses ${why} at the ${stage} stage`, { skip: checkerAvailable() ? false : skipWithoutChecker }, async () => {
    resetBendChecker();
    const source = await readFile(file, 'utf8');
    const error = await validateBendSource(source, signal()).then(() => undefined, (reason: unknown) => reason);
    assert.ok(error instanceof BendCheckError, `expected a staged rejection, got ${String(error)}`);
    assert.equal(error.stage, stage, `${file} was refused at ${error.stage}, expected ${stage}`);
  });
}

test('a program with an unfilled hole is refused at the holes stage, not the type stage', { skip: checkerAvailable() ? false : skipWithoutChecker }, async () => {
  resetBendChecker();
  const source = 'import Base\n\ndef main() -> IO(Unit):\n  do IO<Unit>:\n    IO.print(U32.show(?TODO))\n';
  const error = await validateBendSource(source, signal()).then(() => undefined, (reason: unknown) => reason);
  assert.ok(error instanceof BendCheckError, `expected a staged rejection, got ${String(error)}`);
  assert.equal(error.stage, 'holes');
});

// ---------------------------------------------------------------------------
// Integration and end to end
// ---------------------------------------------------------------------------

test('a scripted generation parses and type checks against the real checker', { skip: checkerAvailable() ? false : skipWithoutChecker }, async () => {
  resetBendChecker();
  await validateBendSource(await run('count items and print the total', helperScript), signal());
});

test('generateText routes a .bend path to the bend adapter and gates the write on validation', { skip: checkerAvailable() ? false : skipWithoutChecker }, async () => {
  resetBendChecker();
  const { generateText } = await import('../src/generation.js');
  const registry = new AstRegistry();
  const source = await generateText(new Decisions(scripted(helperScript), 400, signal()),
    { task: { prompt: 'count items and print the total' }, argumentsSoFar: { path: 'main.bend' } }, 'content', 'Source',
    { maxSteps: 200, maxBytes: 20_000, allowEmpty: false, fragments: [], astRegistry: registry });
  assert.match(source, /^import Base\n/);
  const broken = new AstRegistry([{ ...bendAstAdapter, id: 'bend-broken', extensions: ['.bnd'], languages: ['bendbroken'],
    async generate() { return 'import Base\n\ndef main(: 0\n'; } }], false);
  await assert.rejects(generateText(new Decisions(scripted(helperScript), 400, signal()),
    { argumentsSoFar: { path: 'main.bnd' } }, 'content', 'Source',
    { maxSteps: 200, maxBytes: 20_000, allowEmpty: false, fragments: [], astRegistry: broken }), /Bend parse failed/);
});

test('every program reachable by random decisions parses, types and passes ownership', { skip: checkerAvailable() ? false : skipWithoutChecker, timeout: 300_000 }, async () => {
  resetBendChecker();
  const rng = (seed: number) => () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 2 ** 32; };
  const rounds = Number(process.env.JEV_BEND_FUZZ_ROUNDS ?? 12);
  const failures: string[] = [];
  for (let seed = 1; seed <= rounds; seed++) {
    const next = rng(seed * 7919);
    const source = await run('count the items and print the total message', ({ criteria }) => criteria[Math.floor(next() * criteria.length)]!, 400);
    try { await validateBendSource(source, signal()); }
    catch (error) { failures.push(`seed ${seed}: ${error instanceof BendCheckError ? error.stage : 'threw'}\n${source}\n${String(error).slice(0, 600)}`); }
  }
  assert.deepEqual(failures, [], `${failures.length}/${rounds} random Bend programs were refused:\n${failures.join('\n---\n')}`);
});

// ---------------------------------------------------------------------------
// The three claims must stay three claims
// ---------------------------------------------------------------------------

test('no test in this file claims correctness on the strength of a parse or type check', async () => {
  const self = await readFile(join(here, 'bend-ast.test.ts'), 'utf8');
  const names = [...self.matchAll(/^test\(\s*(?:`([^`]*)`|'([^']*)')/gm)].map(m => (m[1] ?? m[2])!);
  assert.ok(names.length >= 14, `expected the whole file to be scanned, found ${names.length} names`);
  for (const name of names) {
    assert.ok(!/\b(correct|correctly|works|right answer|semantic)\b/i.test(name),
      `test name claims semantic correctness, which nothing here measures: ${name}`);
  }
});

test('every construct in the subset specification has a probe recorded as passing all three stages', async () => {
  const spec = await readFile(join(here, '..', 'docs', 'bend2-pilot', 'evidence', 'subset-spec.md'), 'utf8');
  const section = (heading: string): string => {
    const start = spec.indexOf(heading);
    assert.notEqual(start, -1, `subset specification has no "${heading}" section`);
    const rest = spec.slice(start + heading.length);
    const end = rest.indexOf('\n## ');
    return end === -1 ? rest : rest.slice(0, end);
  };
  const cite = (text: string): string[] => [...new Set([...text.matchAll(/\bp\d+-[a-z0-9-]+\.bend\b/g)].map(m => m[0]))];
  const present = new Set(await readdir(join(probes, 'design-probe')));
  const output = await readFile(join(probes, 'design-probe', 'probe-output.txt'), 'utf8');
  const verdict = (probe: string): string => {
    assert.ok(present.has(probe), `subset specification cites a probe that does not exist: ${probe}`);
    const block = output.split('== ').find(part => part.startsWith(probe));
    assert.ok(block, `no recorded run for ${probe}`);
    return block;
  };

  const passing = cite(section('## Baseline probes'));
  assert.ok(passing.length >= 12, `baseline cites only ${passing.length} probes`);
  for (const probe of passing) {
    const block = verdict(probe);
    for (const stage of ['PARSE   ok', 'TYPE    ok', 'OWNED   ok']) {
      assert.ok(block.includes(stage), `${probe} has no recorded "${stage}" verdict`);
    }
  }

  const refused = cite(section('## Rejection baseline'));
  assert.ok(refused.length >= 2, `rejection baseline cites only ${refused.length} probes`);
  for (const probe of refused) {
    const block = verdict(probe);
    assert.ok(block.includes('PARSE   ok'), `${probe} should parse; a parse failure is a different claim`);
    assert.ok(block.includes('TYPE    FAIL'), `${probe} is not recorded as refused by the type checker`);
  }
});

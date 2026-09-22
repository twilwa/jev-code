import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { executeBendSource, inspectBenchmarkToolchain } from '../../../src/bend-semantic-benchmark.js';
import { validateBendSource } from '../../../src/bend-ast.js';
import { classifyLawRejection, empiricalVerifierCaught, loadFixture, renderLawCandidate, renderVerifierCandidate } from './harness.js';

const here = dirname(fileURLToPath(import.meta.url));
const repository = resolve(here, '..', '..', '..');
const fixtureFile = join(here, 'defects.json');
const bendRoot = execFileSync('bash', [join(repository, 'scripts', 'resolve-bend2-toolchain-path.sh')], {
  cwd: repository, encoding: 'utf8', env: process.env,
}).trim();
const outputIndex = process.argv.indexOf('--output');
const output = resolve(outputIndex >= 0 ? process.argv[outputIndex + 1]
  ?? (() => { throw new Error('--output needs a path.'); })() : join(here, '..', 'results', 'verifier-vs-law-latest.json'));

if (!existsSync(join(bendRoot, 'bend2', 'bend.ts'))) {
  throw new Error(`Bend toolchain is absent at ${bendRoot}. Set JEV_BEND_PATH to the pinned checkout; this command does not install it.`);
}

const toolchain = await inspectBenchmarkToolchain(bendRoot);
const fixture = await loadFixture(fixtureFile);
process.env.JEV_BEND_PATH = bendRoot;
const results = [];
for (const defect of fixture.defects) {
  const lawStarted = performance.now();
  let lawCaught = false;
  let lawDetail: string | null = null;
  try { await validateBendSource(renderLawCandidate(defect), new AbortController().signal); }
  catch (error) {
    const rejection = classifyLawRejection(error);
    lawCaught = rejection.caught;
    lawDetail = rejection.detail;
  }
  const lawLatencyMs = performance.now() - lawStarted;

  const verifierStarted = performance.now();
  const execution = await executeBendSource(renderVerifierCandidate(defect, fixture.property.inputs), bendRoot);
  const verifierLatencyMs = performance.now() - verifierStarted;
  const verifierCaught = empiricalVerifierCaught(execution, fixture.property.expectedStdout);
  results.push({ id: defect.id, description: defect.description, expression: defect.expression,
    verifier: { caught: verifierCaught, latencyMs: verifierLatencyMs,
      cost: { paidCalls: 0, inputTokens: 0, outputTokens: 0, usd: 0 },
      detail: verifierCaught ? execution.detail ?? `Expected ${JSON.stringify(fixture.property.expectedStdout)}; observed ${JSON.stringify(execution.stdout)}.` : null },
    law: { caught: lawCaught, latencyMs: lawLatencyMs,
      cost: { paidCalls: 0, inputTokens: 0, outputTokens: 0, usd: 0 }, detail: lawDetail } });
}

const report = { schemaVersion: 1, measuredAt: new Date().toISOString(), fixture: fixtureFile,
  property: fixture.property, toolchain, results };
await mkdir(dirname(output), { recursive: true });
await writeFile(output, JSON.stringify(report, null, 2) + '\n');
for (const result of results) {
  process.stdout.write(`${result.id}: verifier=${result.verifier.caught ? 'caught' : 'missed'} law=${result.law.caught ? 'caught' : 'missed'} `
    + `verifier_ms=${result.verifier.latencyMs.toFixed(3)} law_ms=${result.law.latencyMs.toFixed(3)}\n`);
}
process.stdout.write(`report=${output}\n`);

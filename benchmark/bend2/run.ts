import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runLiveBenchmark, runOfflineBenchmark, type LiveBudget } from '../../src/bend-semantic-benchmark.js';
import { JevProvider } from '../../src/provider.js';

const here = dirname(fileURLToPath(import.meta.url));
const root = here;
const repository = resolve(here, '..', '..');
const toolRoot = resolve(process.env.JEV_BENCH_TOOL_ROOT ?? join(repository, '.benchmark-tools'));
const bendRoot = resolve(process.env.JEV_BEND_PATH ?? join(toolRoot, 'bend'));
const args = process.argv.slice(2);
const live = args.includes('--live');
if (live && args.includes('--offline')) throw new Error('Choose either --offline or --live.');
const outputIndex = args.indexOf('--output');
const output = resolve(outputIndex >= 0 ? args[outputIndex + 1] ?? (() => { throw new Error('--output needs a path.'); })()
  : join(root, 'results', live ? 'live-latest.json' : 'offline-latest.json'));

const cap = (name: string): number => {
  const raw = process.env[name];
  const value = Number(raw);
  if (!raw || !Number.isSafeInteger(value) || value <= 0) {
    throw new Error(`Live comparison is disabled because ${name} has no authorized positive integer cap.`);
  }
  return value;
};

let report;
if (live) {
  const budget: LiveBudget = { maxRequests: cap('JEV_BENCH_MAX_PAID_REQUESTS'),
    maxInputTokens: cap('JEV_BENCH_MAX_PAID_INPUT_TOKENS'), maxOutputTokens: cap('JEV_BENCH_MAX_PAID_OUTPUT_TOKENS') };
  report = await runLiveBenchmark({ root, bendRoot }, new JevProvider(), budget);
} else {
  report = await runOfflineBenchmark({ root, bendRoot });
}

await mkdir(dirname(output), { recursive: true });
await writeFile(output, JSON.stringify(report, null, 2) + '\n');
for (const item of report.cases) {
  process.stdout.write(`${item.outcome === 'pass' ? 'PASS' : `FAIL ${item.errorClass}`}: ${item.id}\n`);
}
process.stdout.write(`success=${report.summary.successCount} failure=${report.summary.failureCount} requests=${report.summary.requestCount} `
  + `tokens=${report.summary.tokenCount.total} provider_latency_ms=${report.summary.providerLatencyMs.toFixed(3)} wall_ms=${report.summary.wallTimeMs.toFixed(3)}\n`);
process.stdout.write(`report=${output}\n`);
if (report.summary.failureCount > 0) process.exitCode = 1;

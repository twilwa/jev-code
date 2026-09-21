// Counts decision requests per generated Bend program. A request count measures
// how much work the decision loop asks of a provider. It is NOT a quality
// result: nothing here parses, type checks or executes the programs it builds.
//
// Reproduce from the repository root:
//   npx tsx docs/bend2-pilot/evidence/request-count.mts
// Recorded output is in request-count.txt.

import { generateBendAst } from '../../../src/bend-ast.js';
import { Decisions } from '../../../src/decisions.js';
import type { DecisionProvider } from '../../../src/types.js';
import type { EntryType, Questions, SystemOneResult } from '@typesafe-ai/sdk';

const rng = (seed: number) => () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 2 ** 32; };
const counts: number[] = [];
const lines: number[] = [];
for (let seed = 1; seed <= 40; seed++) {
  const next = rng(seed * 7919);
  let requests = 0;
  const provider: DecisionProvider = { decide: async <Q extends Questions>(_i: EntryType, questions: Q) => {
    const q = questions.selection!;
    if (q.type !== 'choice') throw new Error('choice');
    const keys = Object.keys(q.criteria);
    requests++;
    const choice = keys[Math.floor(next() * keys.length)]!;
    return { model: 'count', usage: { input_tokens: 1, output_tokens: 1 }, answers: { selection: { type: 'choice', choice, confidence: 1, probabilities: Object.fromEntries(keys.map(k => [k, Number(k === choice)])) } } } as unknown as SystemOneResult<Q>;
  } };
  const src = await generateBendAst(new Decisions(provider, 400, new AbortController().signal), { task: { prompt: 'count the items and print the total message' } }, 'content', { maxSteps: 400, maxBytes: 20_000, allowEmpty: false, fragments: [] });
  counts.push(requests); lines.push(src.split('\n').length);
}
counts.sort((a, b) => a - b); const total = counts.reduce((a, b) => a + b, 0);
console.log(`programs=${counts.length} total_requests=${total} min=${counts[0]} median=${counts[Math.floor(counts.length/2)]} max=${counts.at(-1)} mean=${(total/counts.length).toFixed(1)}`);
console.log(`lines min=${Math.min(...lines)} max=${Math.max(...lines)}`);

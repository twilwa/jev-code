import { createHash } from 'node:crypto';

export const WATCH_CHUNK_CHARACTER_LIMIT = 24_000;

export interface BendFileSet { files: Record<string, string> }

export interface WatchQuestion {
  type: 'choice' | 'noul' | 'score';
  instructions: string;
  criteria?: Record<string, string> | string[];
}

interface Span { startLine: number; endLine: number }

interface Declaration {
  kind: 'def' | 'law' | 'type';
  name: string;
  file: string;
  signature: string;
  source: string;
  span: Span;
  body: string;
  parameters: Array<{ name: string; quantity: 'affine' | 'copyable' | 'template' }>;
}

export interface LawState {
  name: string;
  file: string;
  span: Span;
  normalizedProposition: string;
  classification: 'type_only' | 'behavioral_property';
  propertyKind: 'equality' | 'ordering' | 'bounds' | 'preservation' | 'invariant' | 'other' | null;
  pairedDefinition: string | null;
  status: 'filled' | 'open';
  dependencies: string[];
}

export interface EvidenceState {
  name: string;
  file: string;
  span: Span;
  kind: 'property' | 'test';
  targets: string[];
  inputDomainSummary: string[];
  independentlyAuthoredOracle: boolean;
  boundaryCases: string[];
  lastResult: 'not_run';
  sourceHash: string;
  sourceSlice: string;
}

export interface DeclarationWatchState {
  schemaVersion: 1;
  root: { file: string; symbol: string; declarationKind: 'def' | 'law' | 'type'; change: 'added' | 'modified' | 'removed'; diffSha256: string };
  astDelta: {
    oldNodeKinds: string[];
    newNodeKinds: string[];
    changedLiterals: { removed: string[]; added: string[] };
    changedCallees: { removed: string[]; added: string[] };
    signature: { before: string | null; after: string | null };
    callEdges: { removed: string[]; added: string[] };
    spans: { before: Span | null; after: Span | null };
    hashes: { before: string | null; after: string | null };
    sourceSlice: { before: string | null; after: string | null };
  };
  laws: LawState[];
  evidence: { properties: EvidenceState[]; tests: EvidenceState[]; propertyChangedInDiff: boolean };
  holesAndTrust: {
    before: { holes: number; unsafeUses: number; foreignDefinitions: number };
    after: { holes: number; unsafeUses: number; foreignDefinitions: number };
  };
  ownership: {
    bindersBefore: Array<{ name: string; quantity: string; uses: number }>;
    bindersAfter: Array<{ name: string; quantity: string; uses: number }>;
    introducedUses: Array<{ name: string; count: number }>;
    removedUses: Array<{ name: string; count: number }>;
    duplicateNames: string[];
    shadowing: string[];
    copiedValues: string[];
    droppedValues: string[];
    compilerResult: 'not_run';
  };
  omitted: { sourceSlices: number; relatedEvidence: number; relatedLaws: number; structuralItems: number };
}

export interface WatchChunk {
  state: DeclarationWatchState;
  questions: Record<string, WatchQuestion>;
  characterCount: number;
}

export interface BendWatchResult { schemaVersion: 1; chunks: WatchChunk[] }

const hash = (value: string): string => createHash('sha256').update(value).digest('hex');
const normalized = (value: string): string => value.replace(/\s+/g, ' ').trim();
const unique = (values: string[]): string[] => [...new Set(values)].sort();
const minus = (left: string[], right: string[]): string[] => unique(left.filter(value => !right.includes(value)));
const bounded = (value: string, limit = 1_200): string => value.length <= limit ? value : `${value.slice(0, limit)}\n...[truncated]`;

const DECLARATION = /^(def|law|type)\s+([^\s(:=]+)/;

const splitHeader = (line: string): { signature: string; inlineBody: string } => {
  let parentheses = 0;
  for (let index = 0; index < line.length; index++) {
    const character = line[index];
    if (character === '(') parentheses++;
    else if (character === ')') parentheses = Math.max(0, parentheses - 1);
    else if (character === ':' && parentheses === 0) {
      const prefix = line.slice(0, index);
      return { signature: normalized(prefix.replace(/^(?:def|law|type)\s+[^\s(:=]+/, '')),
        inlineBody: line.slice(index + 1).trim() };
    }
  }
  return { signature: normalized(line), inlineBody: '' };
};

const parseFile = (file: string, source: string): Declaration[] => {
  const lines = source.replace(/\r\n/g, '\n').split('\n');
  const starts: Array<{ index: number; start: number; match: RegExpMatchArray }> = [];
  for (const [index, line] of lines.entries()) {
    const match = line.match(DECLARATION);
    if (match) {
      let start = index;
      while (start > 0 && lines[start - 1]!.trim().startsWith('@')) start--;
      starts.push({ index, start, match });
    }
  }
  return starts.map((entry, index) => {
    const end = (starts[index + 1]?.start ?? lines.length) - 1;
    const declarationLines = lines.slice(entry.start, end + 1);
    while (declarationLines.at(-1)?.trim() === '') declarationLines.pop();
    const kind = entry.match[1] as Declaration['kind'];
    const name = entry.match[2]!;
    const header = lines[entry.index] ?? '';
    const { signature, inlineBody } = splitHeader(header);
    const sourceText = declarationLines.join('\n');
    const bodyLines = lines.slice(entry.index + 1, entry.start + declarationLines.length);
    const body = [inlineBody, ...bodyLines].filter((line, lineIndex) => lineIndex > 0 || line !== '').join('\n');
    const parameters = kind === 'def' ? parseParameters(header) : parseLawParameters(body);
    return { kind, name, file, signature, source: sourceText,
      span: { startLine: entry.start + 1, endLine: entry.start + declarationLines.length }, body, parameters };
  });
};

const parameter = (raw: string): { name: string; quantity: 'affine' | 'copyable' | 'template' } | null => {
  const match = raw.trim().match(/^([+~]?)([A-Za-z_][\w.]*)(?:\s*:|$)/);
  if (!match) return null;
  return { name: match[2]!, quantity: match[1] === '+' ? 'copyable' : match[1] === '~' ? 'template' : 'affine' };
};

const parseParameters = (header: string): Declaration['parameters'] => {
  const inside = header.match(/\((.*)\)/)?.[1];
  return inside === undefined ? [] : inside.split(',').map(parameter).filter(value => value !== null);
};

const parseLawParameters = (body: string): Declaration['parameters'] => body.split('\n')
  .map(line => line.trim().match(/^for\s+(.+)$/)?.[1])
  .filter(value => value !== undefined)
  .map(parameter).filter(value => value !== null);

const declarationMap = (set: BendFileSet): Map<string, Declaration> => {
  const result = new Map<string, Declaration>();
  for (const file of Object.keys(set.files).sort()) {
    for (const declaration of parseFile(file, set.files[file]!)) result.set(`${file}\0${declaration.kind}\0${declaration.name}`, declaration);
  }
  return result;
};

const identifiers = (source: string): string[] => source.match(/\b[A-Za-z_][\w.]*\b/g) ?? [];
const literals = (source: string): string[] => unique(source.match(/(?:\b\d+n?\b|"(?:\\.|[^"\\])*")/g) ?? []);
const callees = (source: string): string[] => unique([...source.matchAll(/\b([A-Za-z_][\w.]*)\s*\(/g)].map(match => match[1]!));
const nodeKinds = (source: string): string[] => unique([
  ...(source.includes('?') ? ['Hole'] : []),
  ...(literals(source).some(value => value.startsWith('"')) ? ['StringLiteral'] : []),
  ...(literals(source).some(value => !value.startsWith('"')) ? ['NumericLiteral'] : []),
  ...(callees(source).length ? ['Call'] : []),
  ...([...source.matchAll(/\b(match|case|do|return|let|ask|open|with)\b/g)].map(match => match[1]![0]!.toUpperCase() + match[1]!.slice(1))),
  ...(identifiers(source).length ? ['Name'] : []),
]);

const dependencyNames = (declaration: Declaration): string[] => unique(callees(declaration.source)
  .filter(name => name !== declaration.name && !['for', 'law', 'def'].includes(name)));

const moduleNames = (file: string): string[] => {
  const raw = file.split('/').at(-1)?.replace(/\.bend$/i, '') ?? file;
  return unique([raw, raw.length ? raw[0]!.toUpperCase() + raw.slice(1).toLowerCase() : raw]);
};

const classifyLaw = (law: Declaration, definitions: Declaration[]): LawState => {
  const proposition = law.body.split('\n').map(line => line.trim()).filter(line => line && !line.startsWith('for ')).join(' ');
  const behavioral = /==|!=|\b(Equal|Less|Greater|Bound|Invariant|Preserv|Sorted|Perm)\b/i.test(proposition)
    || /^\s*\{/.test(proposition);
  const kind: LawState['propertyKind'] = !behavioral ? null
    : /==|!=|\bEqual\b/i.test(proposition) ? 'equality'
    : /<|>|\b(Less|Greater|Order|Sorted)\b/i.test(proposition) ? 'ordering'
    : /\b(Bound|Range|Min|Max)\b/i.test(proposition) ? 'bounds'
    : /\b(Preserv|Perm)\b/i.test(proposition) ? 'preservation'
    : /\bInvariant\b/i.test(proposition) ? 'invariant' : 'other';
  const modules = moduleNames(law.file);
  const paired = definitions.find(definition => definition.kind === 'def' && definition.file === law.file && definition.name === law.name)
    ?? definitions.find(definition => {
      const parts = definition.name.split('.');
      return definition.kind === 'def' && parts.at(-1) === law.name && modules.includes(parts.slice(0, -1).join('.'));
    });
  return { name: law.name, file: law.file, span: law.span, normalizedProposition: normalized(proposition),
    classification: behavioral ? 'behavioral_property' : 'type_only', propertyKind: kind,
    pairedDefinition: paired ? `${paired.file}:${paired.name}` : null, status: paired ? 'filled' : 'open',
    dependencies: dependencyNames(law) };
};

const evidenceKind = (declaration: Declaration): EvidenceState['kind'] | null => {
  const value = `${declaration.file}/${declaration.name}`.toLowerCase();
  if (/(^|[/.\-_])(test|spec)([/.\-_]|$)/.test(value) || /(?:^|[._-])test(?:$|[._-])/.test(declaration.name.toLowerCase())) return 'test';
  if (/(?:^|[._-])(property|prop|check)(?:$|[._-])/.test(declaration.name.toLowerCase())) return 'property';
  return null;
};

const callsDeclaration = (declaration: Declaration, root: Declaration, definitions: Declaration[]): boolean => {
  const calls = callees(declaration.body);
  const qualified = moduleNames(root.file).map(module => `${module}.${root.name}`);
  if (calls.some(call => qualified.includes(call))) return true;
  const sameNamedDefinitions = definitions.filter(item => item.kind === 'def' && item.name === root.name);
  return calls.includes(root.name) && (declaration.file === root.file || sameNamedDefinitions.length === 1);
};

const evidenceFor = (declarations: Declaration[], root: Declaration): EvidenceState[] => declarations.flatMap(declaration => {
  const kind = evidenceKind(declaration);
  const targets = callsDeclaration(declaration, root, declarations) ? [root.name] : [];
  if (!kind || targets.length === 0) return [];
  const values = literals(declaration.body);
  return [{ name: declaration.name, file: declaration.file, span: declaration.span, kind, targets,
    inputDomainSummary: values, independentlyAuthoredOracle: /==|!=|\b(expected|oracle|assert)\b/i.test(declaration.body),
    boundaryCases: values.filter(value => /^(?:0|1|max|min)/i.test(value)), lastResult: 'not_run',
    sourceHash: hash(declaration.source), sourceSlice: bounded(declaration.source, 800) }];
});

const holeTrust = (source: string): DeclarationWatchState['holesAndTrust']['before'] => ({
  holes: (source.match(/\?[A-Za-z_][\w.]*/g) ?? []).length,
  unsafeUses: (source.match(/@unsafe\b/g) ?? []).length,
  foreignDefinitions: /(?:^|\n)\s+import\s+["']/.test(source) ? 1 : 0,
});

const binderState = (declaration: Declaration | undefined, declarations: Declaration[]): Array<{ name: string; quantity: string; uses: number }> => {
  if (!declaration) return [];
  const bodyIds = identifiers(declaration.body);
  const lawParameters = declaration.kind === 'def'
    ? declarations.find(item => item.kind === 'law' && item.name === declaration.name)?.parameters ?? [] : [];
  return declaration.parameters.map((item, index) => ({ ...item,
    quantity: item.quantity === 'affine' ? lawParameters[index]?.quantity ?? item.quantity : item.quantity,
    uses: bodyIds.filter(id => id === item.name).length }));
};

const lawAppliesTo = (law: Declaration, root: Declaration, definitions: Declaration[]): boolean => {
  if (law.file === root.file && law.name === root.name) return true;
  return callsDeclaration(law, root, definitions);
};

const changedUses = (from: Array<{ name: string; uses: number }>, to: Array<{ name: string; uses: number }>): Array<{ name: string; count: number }> => {
  const names = unique([...from.map(item => item.name), ...to.map(item => item.name)]);
  return names.flatMap(name => {
    const difference = (to.find(item => item.name === name)?.uses ?? 0) - (from.find(item => item.name === name)?.uses ?? 0);
    return difference > 0 ? [{ name, count: difference }] : [];
  });
};

const duplicateNames = (items: Array<{ name: string }>): string[] => unique(items
  .filter((item, index) => items.findIndex(other => other.name === item.name) !== index).map(item => item.name));

const shadowing = (declaration: Declaration | undefined): string[] => {
  if (!declaration) return [];
  const binders = declaration.parameters.map(item => item.name);
  const local = [...declaration.body.matchAll(/(?:^|\n)\s*[+~]?([A-Za-z_][\w.]*)\s*(?::[^=<-]+)?(?:=|<-)/g)].map(match => match[1]!);
  return unique(local.filter(name => binders.includes(name) || local.filter(value => value === name).length > 1));
};

const questionsFor = (state: DeclarationWatchState): Record<string, WatchQuestion> => {
  const symbol = `${state.root.file}:${state.root.symbol}`;
  const typeOnly = state.laws.some(law => law.classification === 'type_only');
  const behavioral = state.laws.some(law => law.classification === 'behavioral_property');
  const evidenceCount = state.evidence.properties.length + state.evidence.tests.length;
  const gap = behavioral || evidenceCount > 0 ? 'the supplied behavioral law, property, or test evidence'
    : typeOnly ? 'its only declared law is a function type, not a behavioral property'
    : 'no behavioral law, property, or test is connected to it';
  return {
    property_missing: { type: 'noul', instructions: `Does the externally visible behavior changed at \`${symbol}\` lack a property that could fail if the change were wrong? ${gap}. A function type alone does not count.`,
      criteria: { yes: 'The changed behavior has no connected behavioral claim capable of detecting a wrong result.', no: 'A connected behavioral law or independently checkable property covers the changed behavior.' } },
    intent_conflict: { type: 'noul', instructions: `Does the new behavior of \`${symbol}\` conflict with any stated behavioral law, property, or test in \`laws\` and \`evidence\`? Abstain near 0.5 when the supplied state does not establish intent.`,
      criteria: { yes: 'The structural change directly conflicts with supplied behavioral evidence.', no: 'The supplied evidence supports the change or does not conflict with it.' } },
    risk_evidence: { type: 'score', instructions: `Rate the mismatch evidence for the change at \`${symbol}\`. Treat type-only laws as typing evidence, not behavioral proof.`,
      criteria: ['No mismatch evidence.', 'Weak suspicion with a plausible correct reading.', 'Likely mismatch tied to the changed declaration.', 'Direct conflict with a stated property or oracle.'] },
    next_evidence: { type: 'choice', instructions: `Which available evidence step is the cheapest way to distinguish a correct change at \`${symbol}\` from a likely mistake? No commands are supplied in this offline state, so choose only among these dispositions.`,
      criteria: { inspect_connected_evidence: 'Inspect the connected law, property, or test already present in the state.', add_behavioral_property: 'Ask the coding agent to add a behavioral property because only type evidence or no evidence exists.', continue_editing: 'The declaration is incomplete or still contains a hole.', abstain: 'The state does not support a useful recommendation.' } },
  };
};

const chunkSize = (chunk: Omit<WatchChunk, 'characterCount'>): number => JSON.stringify(chunk).length;

const fitChunk = (state: DeclarationWatchState): WatchChunk => {
  let questions = questionsFor(state);
  let size = chunkSize({ state, questions });
  if (size > WATCH_CHUNK_CHARACTER_LIMIT) {
    const slices = [state.astDelta.sourceSlice.before, state.astDelta.sourceSlice.after,
      ...state.evidence.properties.map(item => item.sourceSlice), ...state.evidence.tests.map(item => item.sourceSlice)]
      .filter(value => value !== null && value !== '').length;
    state.omitted.sourceSlices += slices;
    state.astDelta.sourceSlice = { before: null, after: null };
    for (const item of [...state.evidence.properties, ...state.evidence.tests]) item.sourceSlice = '';
    size = chunkSize({ state, questions });
  }
  if (size > WATCH_CHUNK_CHARACTER_LIMIT) {
    const arrays: string[][] = [state.astDelta.oldNodeKinds, state.astDelta.newNodeKinds,
      state.astDelta.changedLiterals.removed, state.astDelta.changedLiterals.added,
      state.astDelta.changedCallees.removed, state.astDelta.changedCallees.added,
      state.astDelta.callEdges.removed, state.astDelta.callEdges.added,
      state.ownership.duplicateNames, state.ownership.shadowing, state.ownership.copiedValues, state.ownership.droppedValues];
    for (const item of [...state.evidence.properties, ...state.evidence.tests]) arrays.push(item.inputDomainSummary, item.boundaryCases);
    for (const values of arrays) {
      if (values.length > 64) {
        state.omitted.structuralItems += values.length - 64;
        values.splice(64);
      }
      for (let index = 0; index < values.length; index++) values[index] = bounded(values[index]!, 240);
    }
    for (const key of ['bindersBefore', 'bindersAfter'] as const) {
      const binders = state.ownership[key];
      if (binders.length > 128) {
        state.omitted.structuralItems += binders.length - 128;
        binders.splice(128);
      }
      for (const binder of binders) binder.name = bounded(binder.name, 240);
    }
    for (const key of ['introducedUses', 'removedUses'] as const) {
      const changes = state.ownership[key];
      if (changes.length > 128) {
        state.omitted.structuralItems += changes.length - 128;
        changes.splice(128);
      }
      for (const change of changes) change.name = bounded(change.name, 240);
    }
    size = chunkSize({ state, questions });
  }
  while (size > WATCH_CHUNK_CHARACTER_LIMIT && (state.evidence.properties.length + state.evidence.tests.length) > 0) {
    const list = state.evidence.tests.length ? state.evidence.tests : state.evidence.properties;
    list.pop();
    state.omitted.relatedEvidence++;
    size = chunkSize({ state, questions });
  }
  if (size > WATCH_CHUNK_CHARACTER_LIMIT) {
    state.laws = state.laws.map(law => ({ ...law, normalizedProposition: bounded(law.normalizedProposition, 240), dependencies: law.dependencies.slice(0, 24) }));
    questions = questionsFor(state);
    size = chunkSize({ state, questions });
  }
  while (size > WATCH_CHUNK_CHARACTER_LIMIT && state.laws.length > 1) {
    state.laws.pop();
    state.omitted.relatedLaws++;
    size = chunkSize({ state, questions });
  }
  if (size > WATCH_CHUNK_CHARACTER_LIMIT) throw new Error(`Watch state for ${state.root.file}:${state.root.symbol} exceeds ${WATCH_CHUNK_CHARACTER_LIMIT} characters after deterministic compaction.`);
  return { state, questions, characterCount: size };
};

export const watchBendChanges = (base: BendFileSet, head: BendFileSet): BendWatchResult => {
  const beforeMap = declarationMap(base);
  const afterMap = declarationMap(head);
  const beforeAll = [...beforeMap.values()];
  const afterAll = [...afterMap.values()];
  const keys = unique([...beforeMap.keys(), ...afterMap.keys()]);
  const chunks: WatchChunk[] = [];
  for (const key of keys) {
    const before = beforeMap.get(key);
    const after = afterMap.get(key);
    if (before?.source === after?.source) continue;
    const current = after ?? before!;
    const beforeCalls = before ? callees(before.body) : [];
    const afterCalls = after ? callees(after.body) : [];
    const laws = afterAll.filter(item => item.kind === 'law' && lawAppliesTo(item, current, afterAll))
      .map(law => classifyLaw(law, afterAll));
    const currentEvidence = evidenceFor(afterAll, current);
    const oldEvidence = evidenceFor(beforeAll, before ?? current);
    const beforeBinders = binderState(before, beforeAll);
    const afterBinders = binderState(after, afterAll);
    const rootHash = hash(`${before?.source ?? ''}\0${after?.source ?? ''}`);
    const state: DeclarationWatchState = {
      schemaVersion: 1,
      root: { file: current.file, symbol: current.name, declarationKind: current.kind,
        change: !before ? 'added' : !after ? 'removed' : 'modified', diffSha256: rootHash },
      astDelta: {
        oldNodeKinds: before ? nodeKinds(before.body) : [], newNodeKinds: after ? nodeKinds(after.body) : [],
        changedLiterals: { removed: minus(before ? literals(before.body) : [], after ? literals(after.body) : []), added: minus(after ? literals(after.body) : [], before ? literals(before.body) : []) },
        changedCallees: { removed: minus(beforeCalls, afterCalls), added: minus(afterCalls, beforeCalls) },
        signature: { before: before?.signature ?? null, after: after?.signature ?? null },
        callEdges: { removed: minus(beforeCalls, afterCalls), added: minus(afterCalls, beforeCalls) },
        spans: { before: before?.span ?? null, after: after?.span ?? null },
        hashes: { before: before ? hash(before.source) : null, after: after ? hash(after.source) : null },
        sourceSlice: { before: before ? bounded(before.source) : null, after: after ? bounded(after.source) : null },
      },
      laws,
      evidence: { properties: currentEvidence.filter(item => item.kind === 'property'), tests: currentEvidence.filter(item => item.kind === 'test'),
        propertyChangedInDiff: JSON.stringify(oldEvidence.map(item => item.sourceHash)) !== JSON.stringify(currentEvidence.map(item => item.sourceHash)) },
      holesAndTrust: { before: holeTrust(before?.source ?? ''), after: holeTrust(after?.source ?? '') },
      ownership: {
        bindersBefore: beforeBinders, bindersAfter: afterBinders,
        introducedUses: changedUses(beforeBinders, afterBinders), removedUses: changedUses(afterBinders, beforeBinders),
        duplicateNames: duplicateNames(afterBinders), shadowing: shadowing(after),
        copiedValues: afterBinders.filter(item => item.quantity === 'copyable' && item.uses > 1).map(item => item.name).sort(),
        droppedValues: afterBinders.filter(item => item.uses === 0).map(item => item.name).sort(), compilerResult: 'not_run',
      },
      omitted: { sourceSlices: 0, relatedEvidence: 0, relatedLaws: 0, structuralItems: 0 },
    };
    chunks.push(fitChunk(state));
  }
  return { schemaVersion: 1, chunks: chunks.sort((a, b) => {
    const left = `${a.state.root.file}\0${a.state.root.declarationKind}\0${a.state.root.symbol}`;
    const right = `${b.state.root.file}\0${b.state.root.declarationKind}\0${b.state.root.symbol}`;
    return left < right ? -1 : left > right ? 1 : 0;
  }) };
};

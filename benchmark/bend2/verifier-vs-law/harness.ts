import { readFile } from 'node:fs/promises';

export interface Defect { id: string; description: string; expression: string }
export interface VerifierVsLawFixture {
  schemaVersion: 1;
  property: { name: string; law: string; inputs: number[]; expectedStdout: string; referenceExpression: string };
  defects: Defect[];
}
interface ExecutionOutcome {
  status: 'ran' | 'compile_error' | 'runtime_error' | 'timeout';
  stdout: string;
  exitCode: number | null;
  detail: string | null;
  signals: { parse: string; type: string; ownership: string };
}

const object = (value: unknown, at: string): Record<string, unknown> => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${at} must be an object.`);
  return value as Record<string, unknown>;
};
const exactKeys = (value: Record<string, unknown>, keys: string[], at: string): void => {
  const extra = Object.keys(value).filter(key => !keys.includes(key));
  if (extra.length > 0) throw new Error(`${at} has unknown field ${extra[0]}.`);
};
const nonEmptyString = (value: unknown, at: string): string => {
  if (typeof value !== 'string' || value.length === 0) throw new Error(`${at} must be a non-empty string.`);
  return value;
};

export const parseFixture = (value: unknown, source: string): VerifierVsLawFixture => {
  const fixture = object(value, source);
  exactKeys(fixture, ['schemaVersion', 'property', 'defects'], source);
  if (fixture.schemaVersion !== 1) throw new Error(`${source}.schemaVersion must be 1.`);
  const rawProperty = object(fixture.property, `${source}.property`);
  exactKeys(rawProperty, ['name', 'law', 'inputs', 'expectedStdout', 'referenceExpression'], `${source}.property`);
  if (!Array.isArray(rawProperty.inputs) || rawProperty.inputs.length === 0
    || rawProperty.inputs.some(input => !Number.isSafeInteger(input) || input < 0 || input > 0xffff_ffff)) {
    throw new Error(`${source}.property.inputs must be non-empty U32 integers.`);
  }
  const property = { name: nonEmptyString(rawProperty.name, `${source}.property.name`),
    law: nonEmptyString(rawProperty.law, `${source}.property.law`), inputs: rawProperty.inputs as number[],
    expectedStdout: nonEmptyString(rawProperty.expectedStdout, `${source}.property.expectedStdout`),
    referenceExpression: nonEmptyString(rawProperty.referenceExpression, `${source}.property.referenceExpression`) };
  if (!Array.isArray(fixture.defects) || fixture.defects.length < 8) throw new Error(`${source}.defects must contain at least 8 defects.`);
  const defects = fixture.defects.map((raw, index): Defect => {
    const defect = object(raw, `${source}.defects[${index}]`);
    exactKeys(defect, ['id', 'description', 'expression'], `${source}.defects[${index}]`);
    const id = nonEmptyString(defect.id, `${source}.defects[${index}].id`);
    if (!/^[a-z][a-z0-9-]{0,63}$/.test(id)) throw new Error(`${source}.defects[${index}].id is invalid.`);
    return { id, description: nonEmptyString(defect.description, `${source}.defects[${index}].description`),
      expression: nonEmptyString(defect.expression, `${source}.defects[${index}].expression`) };
  });
  if (new Set(defects.map(defect => defect.id)).size !== defects.length) throw new Error(`${source}.defects has duplicate ids.`);
  if (defects.some(defect => defect.expression === property.referenceExpression)) throw new Error(`${source}.defects repeats the reference expression.`);
  return { schemaVersion: 1, property, defects };
};

export const loadFixture = async (file: string): Promise<VerifierVsLawFixture> =>
  parseFixture(JSON.parse(await readFile(file, 'utf8')) as unknown, file);

const dbl = (expression: string): string => `import Base

law dbl:
  for +a: U32
  U32

def dbl(a):
  ${expression}`;

export const renderLawCandidate = (defect: Defect): string => `${dbl(defect.expression)}

law main:
  U32

def main(): dbl(21)
`;

export const renderVerifierCandidate = (defect: Defect, inputs: number[]): string => {
  const calls = inputs.map((input, index) => {
    const call = `IO.print(U32.show(dbl(${input})))`;
    return index === inputs.length - 1 ? `    ${call}` : `    u${index} : Unit <- ${call}`;
  }).join('\n');
  return `${dbl(defect.expression)}

law main:
  IO(Unit)

def main():
  do IO<Unit>:
${calls}
`;
};

export const empiricalVerifierCaught = (execution: ExecutionOutcome, expectedStdout: string): boolean =>
  execution.status !== 'ran' || execution.exitCode !== 0 || execution.stdout !== expectedStdout;

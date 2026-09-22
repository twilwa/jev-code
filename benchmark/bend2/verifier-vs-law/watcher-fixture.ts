import type { BendFileSet } from '../../../src/sidecar/watch.js';
import type { Defect, VerifierVsLawFixture } from './harness.js';

const program = (expression: string): string => `import Base

law dbl:
  for +a: U32
  U32

def dbl(a):
  ${expression}
`;

export interface WatcherDefectCase {
  id: string;
  description: string;
  base: BendFileSet;
  head: BendFileSet;
}

export const buildWatcherDefectCases = (fixture: VerifierVsLawFixture): WatcherDefectCase[] =>
  fixture.defects.map((defect: Defect) => ({
    id: defect.id,
    description: defect.description,
    base: { files: { 'main.bend': program(fixture.property.referenceExpression) } },
    head: { files: { 'main.bend': program(defect.expression) } },
  }));

import { readFile } from 'node:fs/promises';
import { isAbsolute } from 'node:path';

export const SIDECAR_CONFIG_ENV = 'JEV_BEND_SIDECAR_CONFIG';

export interface PiSidecarConfig {
  enabled: true;
  sessionId: string;
  tmpDir: string;
  jevhelperPath: string;
  lane: string;
  workItem: string;
  model: string;
  timeoutSeconds: number;
  budget: {
    maxCallsPerTurn: number;
    maxTokensPerTurn: number;
    maxCallsPerSession: number;
    maxTokensPerSession: number;
  };
}

const record = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const text = (value: unknown, field: string): string => {
  if (typeof value !== 'string' || value.trim() === '') throw new Error(`${field} must be a non-empty string`);
  return value;
};

const integer = (value: unknown, field: string, maximum: number): number => {
  if (!Number.isSafeInteger(value) || (value as number) < 1 || (value as number) > maximum) {
    throw new Error(`${field} must be an integer from 1 through ${maximum}`);
  }
  return value as number;
};

/** Invalid, absent, or session-mismatched configuration keeps the sidecar off. */
export const readPiSidecarConfig = async (
  env: NodeJS.ProcessEnv,
  sessionId: string,
): Promise<PiSidecarConfig | undefined> => {
  const configPath = env[SIDECAR_CONFIG_ENV]?.trim();
  if (!configPath) return undefined;
  let parsed: unknown;
  try {
    parsed = JSON.parse(await readFile(configPath, 'utf8')) as unknown;
  } catch {
    return undefined;
  }
  if (!record(parsed) || parsed.enabled !== true || parsed.sessionId !== sessionId) return undefined;
  try {
    const allowed = new Set([
      'enabled', 'sessionId', 'tmpDir', 'jevhelperPath', 'lane', 'workItem', 'model', 'timeoutSeconds', 'budget',
    ]);
    if (Object.keys(parsed).some(key => !allowed.has(key)) || !record(parsed.budget)) throw new Error('unknown configuration field');
    const budgetKeys = new Set(['maxCallsPerTurn', 'maxTokensPerTurn', 'maxCallsPerSession', 'maxTokensPerSession']);
    if (Object.keys(parsed.budget).some(key => !budgetKeys.has(key))) throw new Error('unknown budget field');
    const tmpDir = text(parsed.tmpDir, 'tmpDir');
    const jevhelperPath = text(parsed.jevhelperPath, 'jevhelperPath');
    if (!isAbsolute(tmpDir) || !isAbsolute(jevhelperPath)) throw new Error('tmpDir and jevhelperPath must be absolute');
    const maxCallsPerTurn = integer(parsed.budget.maxCallsPerTurn, 'maxCallsPerTurn', 32);
    const maxTokensPerTurn = integer(parsed.budget.maxTokensPerTurn, 'maxTokensPerTurn', 1_000_000);
    const maxCallsPerSession = integer(parsed.budget.maxCallsPerSession, 'maxCallsPerSession', 10_000);
    const maxTokensPerSession = integer(parsed.budget.maxTokensPerSession, 'maxTokensPerSession', 100_000_000);
    if (maxCallsPerSession < maxCallsPerTurn || maxTokensPerSession < maxTokensPerTurn) {
      throw new Error('session budget must cover one turn budget');
    }
    return {
      enabled: true,
      sessionId,
      tmpDir,
      jevhelperPath,
      lane: text(parsed.lane, 'lane'),
      workItem: text(parsed.workItem, 'workItem'),
      model: text(parsed.model, 'model'),
      timeoutSeconds: integer(parsed.timeoutSeconds, 'timeoutSeconds', 60),
      budget: { maxCallsPerTurn, maxTokensPerTurn, maxCallsPerSession, maxTokensPerSession },
    };
  } catch {
    return undefined;
  }
};

import type { ExtensionAPI } from '@earendil-works/pi-coding-agent';
import { readPiSidecarConfig } from './config.js';
import { createWatchRunner } from './watch-runner.js';

/** Read-only Bend/Jev sidecar for Pi. It never blocks a turn or starts one. */
export default function bendJevSidecar(pi: ExtensionAPI): void {
  const runner = createWatchRunner({
    sendAdvisory: content => pi.sendMessage({
      customType: 'jev-bend-sidecar-advisory',
      content,
      display: true,
    }, { triggerTurn: false }),
  });

  pi.on('session_start', async (_event, ctx) => {
    const sessionId = ctx.sessionManager.getSessionId();
    const config = await readPiSidecarConfig(process.env, sessionId);
    await runner.initialize(config, sessionId, ctx.cwd);
  });

  pi.on('agent_settled', (_event, _ctx) => {
    // This promise covers the snapshot and queue operation, never the subprocess itself.
    return runner.boundary().catch(() => undefined);
  });

  pi.on('session_shutdown', () => runner.reset());
}

export { readPiSidecarConfig, SIDECAR_CONFIG_ENV } from './config.js';
export { advisoryLines, createWatchRunner, watchDocument } from './watch-runner.js';

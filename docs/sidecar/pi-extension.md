# Pi Bend sidecar

The Pi extension watches Bend declarations after an agent run settles. It compares the Bend files at the previous boundary with the current files, writes the watcher states to the task's temporary directory, and starts one `jevhelper watch` process when declarations changed.

The extension targets Pi 0.85.1. Its `agent_settled` handler waits only for the local snapshot and queue operation. It does not wait for `jevhelper`, start another agent turn, or keep Pi busy while Jev runs.

## Enable it for one session

The sidecar is off unless `JEV_BEND_SIDECAR_CONFIG` names a valid JSON file. The file must contain `enabled: true` and the exact Pi session ID. A config for another session does nothing.

Create the task temporary directory first. Then write a config like this:

```json
{
  "enabled": true,
  "sessionId": "the-pi-session-id",
  "tmpDir": "/absolute/path/to/task-tmp",
  "jevhelperPath": "/absolute/path/to/jev-lab/bin/jevhelper",
  "lane": "bend-agent-sidecar",
  "workItem": "current-task",
  "model": "jev-latest",
  "timeoutSeconds": 10,
  "budget": {
    "maxCallsPerTurn": 4,
    "maxTokensPerTurn": 20000,
    "maxCallsPerSession": 20,
    "maxTokensPerSession": 100000
  }
}
```

Launch Pi with the config path in its environment:

```sh
JEV_BEND_SIDECAR_CONFIG=/absolute/path/to/task-tmp/pi-bend-sidecar.json pi --session the-pi-session-id
```

The session ID must already match the session Pi will open. The CLI accepts a full or partial ID with `--session`; SDK callers can create a `SessionManager` with a chosen ID. This deliberate friction prevents a forgotten config from enabling Jev in later sessions. Missing files, malformed fields, a false `enabled` value, or a different session ID all leave the extension inert.

The package metadata loads `dist/sidecar/pi-extension/index.js` as the Pi extension. Build the package before loading it from a checkout.

## Files and messages

For each changed boundary, the extension writes one owner-only `bend-sidecar-*-states.json` file under `tmpDir`. The same directory holds jevhelper's session budget ledger. The extension captures the redacted receipt output and discards it.

Typed answers travel through jevhelper's inherited answer descriptor. They stay in memory. The extension checks each declaration's diff hash again before it sends advice, then discards the answer document. The Pi message contains only the declaration and gap name, for example:

```text
Jev Bend sidecar advisory
- main.bend:dbl: property_missing
```

Budget refusal and abstention are advice too. They appear as `budget_refused` or `gap_name (abstain)` for the affected declaration.

## What it will never do

The sidecar does not edit files, run suggested commands, approve a change, claim a proof or test passed, block a tool, stop an agent, or decide that work is complete. It never starts a follow-up turn. Jev's result is a second opinion about the changed declaration, and the coding agent remains responsible for tests, proofs, and completion.

The extension creates no sidecar state, receipt, cache, or answer file outside `tmpDir`. It does not enable jevhelper's cache. Pi records the short advisory in its own session, but the extension does not persist raw answers in Pi entries or logs.

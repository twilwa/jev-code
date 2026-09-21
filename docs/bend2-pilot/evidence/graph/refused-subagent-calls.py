#!/usr/bin/env python3
"""List the encoder's sub-agent calls that a safety classifier refused.

CoderMind's LLMClient shells out to the `claude` CLI once per LLM call
(common/llm_client.py, cwd=<repo>), so each call leaves a session transcript
under ~/.claude/projects/<encoded-repo-path>/<session-id>.jsonl.  A refused
call exits 1 with an empty stderr, which the trajectory records only as
"LLM call failed with return code 1: " - the reason is in the transcript.

The brief requires failed retrievals be recorded as failed rather than
summarised from memory, so this enumerates them from the transcripts.

    python3 refused-subagent-calls.py <sessions-dir> <since-iso> [<self-session-id>]
"""
import datetime
import json
import os
import sys


def main() -> None:
    sessions_dir = sys.argv[1]
    since = datetime.datetime.fromisoformat(sys.argv[2])
    self_id = sys.argv[3] if len(sys.argv) > 3 else ""

    rows = []
    for name in sorted(os.listdir(sessions_dir)):
        if not name.endswith(".jsonl") or (self_id and self_id in name):
            continue
        path = os.path.join(sessions_dir, name)
        modified = datetime.datetime.fromtimestamp(os.path.getmtime(path))
        if modified < since:
            continue
        refusal, api_error, prompt_head = None, None, ""
        for line in open(path, errors="replace"):
            try:
                record = json.loads(line)
            except ValueError:
                continue
            if record.get("type") == "system" and record.get("subtype") == "model_refusal_no_fallback":
                refusal = "model_refusal_no_fallback"
            if record.get("isApiErrorMessage"):
                content = record.get("message", {}).get("content")
                if isinstance(content, list):
                    api_error = " ".join(b.get("text", "") for b in content if isinstance(b, dict))
                elif isinstance(content, str):
                    api_error = content
            if not prompt_head and record.get("type") == "user":
                content = record.get("message", {}).get("content")
                if isinstance(content, str):
                    prompt_head = " ".join(content.split())[:90]
        if refusal or api_error:
            rows.append((modified, name.split(".")[0], refusal or "-", (api_error or "-").strip(), prompt_head))

    print(f"sub-agent sessions since {since.isoformat()} ending in a refusal or API error: {len(rows)}")
    for modified, session_id, refusal, api_error, prompt_head in rows:
        print()
        print(f"  session   {session_id}")
        print(f"  finished  {modified.isoformat(timespec='seconds')}")
        print(f"  outcome   {refusal}")
        print(f"  message   {api_error}")
        print(f"  prompt    {prompt_head}...")


if __name__ == "__main__":
    main()

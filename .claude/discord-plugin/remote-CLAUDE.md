# Remote VPS — long-running Discord session

You are running as a long-lived Claude Code session on a remote VPS. The user reaches you via the Discord plugin, not an interactive terminal. Reply to Discord messages using the plugin's reply tool — your transcript output never reaches the user's chat.

## Project location

The working project is at `<PROJECT_PATH>`. Unless the user says otherwise, assume questions and tasks are about that repo.

## Staying current with main

Every periodic sync poke, and before doing any code work the user asks for, follow this flow:

1. Fetch:

       git -C <PROJECT_PATH> fetch origin main

2. Classify HEAD vs origin/main using merge-base:

       LOCAL=$(git -C <PROJECT_PATH> rev-parse HEAD)
       REMOTE=$(git -C <PROJECT_PATH> rev-parse origin/main)
       BASE=$(git -C <PROJECT_PATH> merge-base HEAD origin/main)

   Four possible states:

   - **Up to date** (`LOCAL == REMOTE`): nothing to do. Stop silently.

   - **Behind, fast-forwardable** (`LOCAL == BASE`): there are new commits and local has no diverging commits. Proceed with the clean-or-dirty stash dance below.

   - **Ahead only** (`REMOTE == BASE`): this session has local commits that aren't on origin yet. Do NOT reset or pull. Report in Discord: "Local is ahead of origin/main by N commits; no sync needed." Stop.

   - **Diverged** (none of the above): main was rebased or force-pushed and there are local commits too. The user has authorised clobbering in this case, but preserve a safety net:

         git -C <PROJECT_PATH> branch -f auto-sync-backup/$(date +%s) HEAD

     Then fall through to the stash + hard reset path below.

3. Handle the working tree:

   - **Clean tree, fast-forward case:**

         git -C <PROJECT_PATH> pull --ff-only origin main

     Report in Discord: "Pulled N commits from origin/main."

   - **Dirty tree, fast-forward case:**

         git -C <PROJECT_PATH> stash push -m "auto-sync stash $(date -Iseconds)"
         git -C <PROJECT_PATH> pull --ff-only origin main
         git -C <PROJECT_PATH> stash pop

     - Clean pop: "Pulled N commits; preserved your local changes in <files>."
     - Conflict on pop: STOP. Do not resolve. Report which files conflict; note the stash entry is still present; wait for instructions.

   - **Diverged case (clean or dirty), after creating the backup branch:**

         # stash only if dirty
         git -C <PROJECT_PATH> stash push -m "auto-sync stash $(date -Iseconds)"
         git -C <PROJECT_PATH> reset --hard origin/main
         git -C <PROJECT_PATH> stash pop

     Report in Discord: "origin/main was rewritten; reset HEAD to match. Previous HEAD saved as branch auto-sync-backup/<timestamp>. Local commits and any working-tree changes are recoverable from there / the stash."

Notes:

- `stash push` without `-u` deliberately leaves untracked files alone. If a pull fails because an untracked file would be overwritten, report it and stop — do not `rm` the file.
- Never `git stash drop`, `git branch -D auto-sync-backup/*`, or otherwise destroy safety nets as part of the sync flow.
- If the user explicitly asks you to clean up old `auto-sync-backup/*` branches, that's fine — but only on explicit request.

## Upkeep pokes

A host cron job may periodically send a sync prompt into this tmux session. When you receive it, execute the sync flow above quietly — no Discord reply needed unless something actually happened (pulled commits, diverged, conflict, etc).

## Health check and proactive monitoring

A host cron job periodically sends a health check prompt: "Perform a system health check and alert Discord if issues are found."

When you receive this, run the following diagnostic suite:

1.  **Docker Health**: Run `docker ps --format "{{.Names}}: {{.Status}}"`.
    - If any container is "unhealthy" or has "Exited", report it.
2.  **Disk Space**: Run `df -h /`.
    - If usage is > 85%, report "Low Disk Space: <details>".
3.  **Memory Stress**: Run `free -m`.
    - If available memory is < 5%, report high memory pressure.
4.  **Application Logs**: Grep the last 100 lines of key services for "ERROR" or "Exception" or "Panic".
5.  **Git State**: Check for unexpected dirty files or divergent branches (using the sync logic).

**Reporting Protocol:**
- If everything is within normal limits, **do not reply to Discord**.
- If issues are found, summarize them clearly and use the Discord plugin's reply tool to post an alert. Include enough context (e.g., which container is failing) for quick triage.

## When the user chats

Treat Discord messages as the primary input channel. Keep replies short (Discord is a chat UI, not a terminal). For long outputs, consider attaching a file via the reply tool rather than wall-of-text messages.

# Automatic Claude review of Cursor SRE pull requests

Cursor runs a site-reliability agent that opens PRs on `cursor/*` branches in
response to Seq threshold alerts. Those PRs arrive unreviewed and vary a lot in
quality - some are real fixes, some are narrow patches for an alert that fired
once. This adds an automatic Claude review pass over them.

## What was here before

`ui/.github/workflows/claude.yml` - a stock `@claude` mention workflow, pinned
to `anthropics/claude-code-action@beta`.

It had never run once. `gh run list` on the repo returns nothing, because
**GitHub only reads workflows from `.github/workflows` at the repository root**.
Nested copies are inert. It looks like `/install-github-app` was run from inside
`ui/`, so the file landed one directory too deep.

That file has been moved to the repo root and upgraded to `@v1`.

## What was added

### `.github/workflows/claude-cursor-review.yml`

Automatic review pass.

- **Triggers** on `pull_request` `opened` / `reopened`, gated by
  `startsWith(github.head_ref, 'cursor/')`. Also `workflow_dispatch` with a PR
  number, for reviewing a PR on demand.
- **Agent mode.** Supplying `prompt` to `claude-code-action@v1` makes it run
  directly off the event - no `@claude` mention needed.
- **Can edit the PR in place.** The branch is checked out by name (not the
  detached merge ref), `permissions: contents: write` is granted, and
  `Bash(git:*)` is allowlisted, so Claude can commit and push to the PR branch.
- **Three outcomes**, one of which the prompt forces Claude to pick: approve,
  edit in place, or reject-and-close with reasoning. Each one applies a
  `claude:*` label, which is what gates the E2E job.
- **Two jobs.** `review` runs `dotnet build` + API unit tests and then Claude;
  `e2e` runs the full `./scripts/verify.sh` afterwards, and only for PRs the
  review left open. Rationale and the cost comparison are in
  `features/worktree-pre-pr-verification/`.

### `.github/workflows/claude.yml`

The relocated `@claude` mention workflow. This is the follow-up path: after the
automatic pass, a human can comment `@claude have another look` on the PR.

## Design decisions

**No `synchronize` trigger.** This is deliberate and load-bearing. Claude pushes
commits to the PR branch as part of reviewing it; a `synchronize` trigger would
re-invoke the workflow on Claude's own commit and loop. Re-review is on-demand
instead - `@claude` on the PR, or a manual `workflow_dispatch`.

**Review criteria are repo-specific, not generic.** A generic "check for bugs
and security issues" prompt is close to useless on these PRs. The failure mode
that actually matters here is an SRE agent making a global change to fix one
alert. So the prompt points explicitly at the single-node deployment budget,
`deploy/PRODUCTION_ISSUES.md`, and `SqliteConnectionInterceptor.cs` - the file
that has already caused a node outage, and which applies to every connection in
the process.

**Claude sees build and unit test results, but not E2E.** `dotnet build` and
`dotnet test` run before the review as `continue-on-error` steps and their
outcomes are injected into the prompt, so a red build is a review finding Claude
can act on rather than a gate that stops it running. The Playwright suite runs
*after* the verdict, so the prompt says so explicitly and tells Claude not to
claim it passed. (Originally Claude was told not to run tests at all; then the
full suite ran before it. The current ordering is explained in
`features/worktree-pre-pr-verification/`.)

**No PR-authored text is interpolated into the prompt.** Only the repo name, PR
number and branch are passed. PR title and body are untrusted input; the action
fetches that context itself rather than having it spliced into the instructions.

**`workflow_dispatch` input is validated as numeric** before it reaches a shell,
and all event data reaches `run:` blocks through `env:` rather than direct
`${{ }}` interpolation.

## Prerequisites

- **The Claude GitHub App is NOT required.** Both workflows pass
  `github_token: ${{ secrets.GITHUB_TOKEN }}` explicitly, so GitHub auth uses
  the built-in Actions token rather than the app's OIDC exchange. Comments come
  from `github-actions[bot]`. Removing that line switches to the app (comments
  then come from `claude[bot]`), but the app must be installed for it to work.
- **Subscription auth, not a metered API key.** Both workflows use
  `claude_code_oauth_token: ${{ secrets.CLAUDE_CODE_OAUTH_TOKEN }}`, so review
  runs draw on the Pro/Max subscription rather than billing per token.

  Generate the token locally and store it as a repository secret:

  ```
  claude setup-token
  ```

  Then Settings -> Secrets and variables -> Actions -> New repository secret,
  named `CLAUDE_CODE_OAUTH_TOKEN`.

  The token expires periodically and has to be regenerated the same way. A 401
  from the Claude step, on a workflow that used to work, is the usual symptom -
  it is an expired token, not a broken workflow.

  If this ever needs to move to metered billing, swap that one input for
  `anthropic_api_key: ${{ secrets.ANTHROPIC_API_KEY }}` in both files.
- If `cursor/*` branches are ever protected, the push in the "edit in place"
  path will fail; Claude will fall back to commenting. Checked 2026-09-07:
  `main` has no branch protection and the repo has no rulesets, so pushes are
  unobstructed.
- The repo is public, and `GITHUB_TOKEN` is read-only for `pull_request` events
  raised **from forks**. Cursor pushes `cursor/*` branches to this repo
  directly, so the edit-in-place path works; a fork-based PR would degrade to
  comment-only.

## Verified state as of 2026-09-07

Checked against `sila-skandia/bfstats` with admin credentials:

Checked against `sila-skandia/bfstats` with admin credentials:

| Check | Result |
| --- | --- |
| Actions enabled | yes (`allowed_actions: all`) |
| `CLAUDE_CODE_OAUTH_TOKEN` secret | present (added 2026-09-07) |
| Other repository secrets | none - notably no `ANTHROPIC_API_KEY` |
| Branch protection on `main` | none |
| Rulesets | none |
| Historical workflow runs | none, ever |

Before this change the repo had *zero* Actions secrets. That is the second
independent reason the old `ui/` workflow could never have worked: it referenced
`ANTHROPIC_API_KEY`, which did not exist. Even in the right directory it would
have failed at the Claude step.

## Troubleshooting

### A failed review says only `is_error:true`

The action runs Claude with output hidden ("full output hidden for security"),
so an authentication or model failure surfaces as nothing but
`is_error:true`. Rerunning with `gh run rerun --debug` does **not** unhide it.

The `Explain Claude failure` step exists for this. It reads the execution log
the action already writes (`claude-execution-output.json`, exposed as the
`execution_file` step output) and prints only the diagnostic scalars - error
text, result subtype, denial count. It deliberately does not print assistant
message content, which is what `show_full_output: true` would do, and this is a
public repo.

### `401 OAuth access token is invalid`

The `CLAUDE_CODE_OAUTH_TOKEN` secret is not a valid token. Seen on the first
live run (PR #19, 2026-09-07): the workflow itself was fine - trigger gating,
PR resolution, checkout, git identity and tool config all worked - and Claude
initialised on `claude-sonnet-5` before failing in 2s with an empty
`modelUsage`, which is the signature of the very first API call being rejected.

Regenerate and re-set the secret:

```
claude setup-token
gh secret set CLAUDE_CODE_OAUTH_TOKEN --repo sila-skandia/bfstats
```

The value must be the whole token and nothing else - it looks like
`sk-ant-oat01-...`. A truncated paste, a stray newline, or wrapping quotes all
produce this same 401. `claude setup-token` also needs the local CLI to be on a
Pro/Max subscription; if it is signed in some other way, check `/status` in
`claude` first.

An expired token gives the same error, so this is also the fix when a workflow
that used to work starts failing.

## Status

Working end to end as of 2026-09-07. Run 34106870476 reviewed PR #19 and
posted an APPROVE verdict.

That run confirmed the prompt does what it is meant to, not just that the
plumbing works. The review picked one of the three outcomes and acted on it,
stated up front that tests were not run, checked specifically for
`SqliteConnectionInterceptor` changes, new pragmas and memory-sized settings,
and answered the recurring-pattern-versus-one-off question by citing a sibling
`cursor/*` branch and the earlier covering-index migration. It also caught a
real correctness bug the alert had nothing to do with: `Rank + offset` double
counted, because `ROW_NUMBER()` is evaluated before `LIMIT`/`OFFSET`.

Getting there took two fixes, both recorded above: the workflow was in the
wrong directory, and the first `CLAUDE_CODE_OAUTH_TOKEN` was invalid.

## Verification

`actionlint` passes clean on both workflows (includes shellcheck over the `run`
blocks). End-to-end behaviour can only be confirmed once the workflows are on
the default branch - GitHub schedules `pull_request` workflows from the base
branch, so the first real exercise is the next `cursor/*` PR, or a manual
`workflow_dispatch` against a past one (#17, #18).

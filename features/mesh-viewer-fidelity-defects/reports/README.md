# Reports

One file per agent, as `R1-tree-collision.md`, `R2-…`, `X1-…`, and
`V-R1-tree-collision.md` for each verifier's verdicts.

Subagents cannot use the Write tool — they return their report as their final
message. Under the Agent tool, copy the final message here. Under the Workflow
tool, pull them out of `<transcriptDir>/journal.jsonl`: `{type:'started',
agentId, label}` rows name the agents and `{type:'result', agentId, result}`
rows hold the text. Write one file per agent rather than returning six 20–40 KB
reports through the workflow's return value.

The round was dispatched, and its reports are the files beside this one, on
main since 471ced32 on 2026-09-17. This line used to say the folder stays empty
until the round is dispatched.

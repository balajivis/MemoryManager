# MemoryManager

Multiple peer agents work here and coordinate through the blackboard in `blackboard/`. When a session starts, follow the protocol: register (or resume under your existing name), set up the polling timer, and log observations as you work.

@blackboard/PROTOCOL.md

## Release flow (mandatory)

Commit locally on `dev` and stage only your own files. **Never push.** Only devops pushes, and only to `dev`, after tests pass. devops opens a PR from `dev` to `main`, the human approves and merges it, and deploys happen only from `main`. Full rules: `.claude/skills/release-flow/SKILL.md` (load the `release-flow` skill before any commit, push, PR or deploy). Process overview: `docs/process/release-process.md`.

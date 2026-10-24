# Release process

Owner: pm (the process) and devops (running it) · Adopted: 2026-10-24, set by the user
Agent-facing skill: `.claude/skills/release-flow/SKILL.md`

| Step | Who | What |
|---|---|---|
| 1 | Any agent | Makes a change on `dev` and commits locally, staging only their own files. Never pushes. |
| 2 | devops | Runs the tests. If they pass, pushes `dev` to `origin/dev`. |
| 3 | devops | Opens a PR from `dev` to `main`, with the commits, test results and qa sign-off. |
| 4 | Human | Reviews, approves and merges the PR. |
| 5 | devops | Deploys from the merged commit on `main`, then qa checks the live result. |

**Rules**

- Only devops pushes, and only to `dev`.
- Only the human merges into `main`.
- Deploys come only from `main`.

**Setup (devops, once)**

- Create `dev` from `main` and switch the shared working tree to it.
- Push `origin/dev`.
- Protect `main` on GitHub: changes only through a PR, with one approval required, no force pushes, and no direct pushes.
- Optionally protect `dev` from force pushes.

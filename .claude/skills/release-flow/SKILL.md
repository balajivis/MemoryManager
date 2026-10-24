---
name: release-flow
description: MemoryManager's commit → push → PR → deploy process. Use whenever you're about to run git commit, git push, open or merge a pull request, or deploy anything (site, server, infra) in /Users/bv/Code/MemoryManager. Covers who may push, the dev and main branches, and when deploys may run.
---

# Release flow

Changes travel along one path, and each step has one owner:

```
any agent              devops                        devops          human             devops
local commit on dev → tests pass → push origin/dev → PR dev→main → approves & merges → deploy from main
```

## Every agent (pm, dev, ux, qa, devops)

1. **Work on `dev`.** Check with `git branch --show-current`. If it says `main`, stop and post a `warn` to @devops. Don't switch branches yourself, because all agents share one working tree.
2. **Commit locally when you finish a change.** Stage only the files you changed:
   ```sh
   git add <your paths>          # never `git add -A` or `git add .` — peers' work is in the same tree
   git commit -m "<agent>: <what changed and why>"
   ```
   - Include your own blackboard log (`blackboard/agents/<you>/wm-log.md`) in your commit. Never stage another agent's log or files.
   - End the message with the attribution trailer your session gives you.
3. **Never push.** That covers `git push` in any form, to any branch.
4. **Never rewrite shared history.** No `--amend` on a commit that might already be pushed, and no `rebase`, `reset --hard`, `push --force`, or branch deletion.
5. **If `.git/index.lock` exists,** another agent is mid-commit. Wait a few seconds and retry. Never delete the lock.
6. **Announce it.** After committing, post a `done` entry with the short hash (`git log -1 --format=%h`). Add `@devops` if it's ready to ship.

## devops only

1. **Push to dev, after tests.** Run every suite that exists:
   - `bash blackboard/tests/bb-test.sh`
   - `bash blackboard/tests/schema-test.sh`
   - for site changes, qa's checks

   Push only if all pass: `git push origin dev`. If anything fails, don't push. Post a `warn` naming the failing commit and its author.
2. **Open a PR from dev to main** with `gh pr create --base main --head dev`. The body lists:
   - the commits, by agent
   - the test results
   - qa's sign-off (link the blackboard entry)
   - what will be deployed, if anything

   Post the PR URL to the blackboard and to the user.
3. **Never merge the PR.** Never push to `main`, and never bypass branch protection. Only the human approves and merges.
4. **Deploy only from `main`,** and only after the human has merged:
   ```sh
   git fetch origin
   git checkout --detach origin/main   # or export that commit into the release dir
   ```
   Deploy that exact commit, then post a `done` entry with the commit hash and the live URL. @qa then runs the live check.
5. **Keep `dev` in sync after a merge** with `git merge --ff-only origin/main` on dev, so the next PR shows only new work.

## The human

- Approves and merges PRs from `dev` into `main` on GitHub. Nothing reaches `main`, or production, any other way.
- Can ask devops to deploy a merged commit, or to roll back to an earlier `main` commit.

## Never

- An agent pushing to any branch: only devops pushes, and only to `dev`.
- Anyone pushing to, merging into, or force-updating `main`, except the human through a PR.
- Deploying from `dev`, from a local working tree, or from an unmerged commit.
- Committing secrets, `.env` files, or real customer or team content (devops rule, env-plan §2/§7).

# Opencode Agents Rules

## Git Operations

**NEVER** perform any git operations without explicit user permission. This includes:
- `git push`
- `git pull`
- `git commit`
- `git merge`
- `git rebase`
- `git reset`
- `git checkout` (branch switching)
- Any other git commands that modify repository state

Always ask the user before performing any git operation. The only exception is read-only commands like `git status`, `git diff`, `git log` when used for information gathering (but still never push/pull/commit).

## Scope

This rule applies to:
- This repository (DTXT)
- All repositories when using opencode

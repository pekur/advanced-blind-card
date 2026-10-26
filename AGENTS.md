# Repository rules

## Workflow

- The main Codex session coordinates development, implements changes, and fixes accepted review findings.
- Follow `PROJECT_PLAN.md` incrementally; do not duplicate its requirements in process documents.
- Before each new phase, assess the current state and next logical step, recommend planning, implementation, or review, and wait for explicit user approval before proceeding.
- Within an approved phase, handle routine details autonomously; seek approval for significant architectural or behavioral decisions.
- After implementation, run relevant checks and evaluate whether independent review is appropriate.
- Recommend independent review after Phase 1, grouped-cover implementation, configuration API changes, and before release. Obtain explicit approval before launching any review.
- At each phase end, report completed work, actual verification results, remaining issues, and the recommended next action; end with an explicit approval question and wait.
- Never advance phases, commit, publish, deploy, or perform Git remote operations without explicit approval.

## Independent review

- Prefer a separate read-only Codex agent or session; review must not modify files.
- Inspect actual tracked diffs, staged and untracked changes, relevant source, and tests; do not rely only on implementation summaries.
- Prioritize correctness, regressions, Home Assistant API compatibility, and safe motor control. Report findings with severity and file references, plus verification gaps.
- If automatic launch is unavailable, provide the exact Codex CLI command and review prompt for the user to start a separate read-only review in the same working tree.

## Implementation and repository hygiene

- Keep TypeScript, Lit, esbuild, and Biome minimal; avoid additional tooling.
- Use Home Assistant's public frontend API and supported cover services.
- Never move motors during initialization, rendering, or group expansion.
- Respect supported features, missing values, unavailable entities, and partial failures.
- Send slider commands only after interaction completes; never hide mixed group states.
- Run `pnpm check`, `pnpm build`, and `pnpm test` for relevant changes.
- Preserve existing changes. Keep all Codex working plans, notes, review reports, handoffs, and agent communication files exclusively in `.codex-handoffs/`.
- Never track `.codex-handoffs/`; verify exclusion with `git check-ignore`, check for tracked files, and inspect `git status` for unintended files.
- Create no unnecessary process documents or duplicate project plans.

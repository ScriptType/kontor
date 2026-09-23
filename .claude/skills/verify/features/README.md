# Kontor verification map

This directory is the maintained source for verifying what a Kontor user can do. Read this index before driving the app, then use the matching feature file as the recipe. The commands come from [../SKILL.md](../SKILL.md). `K` below stands for `.claude/skills/verify/scripts/kontor-verify`, run from the repo root.

## Baseline preconditions

- Launch a fresh demo run with `K launch`. Note the printed `run` id and pass it as `--run <id>` to every command.
- Require `K doctor --run <id>` to exit 0 before the first action.
- The run starts from the seed workspace at revision 0 with five cases (V-1042, V-1041, V-1039, V-1037, V-1035), an empty browser profile, and the default Jev gate `g4-lean`.
- Never drive the user's instance on ports 3000 or 4200, and never launch with `--live` unless the user asked for a paid Jev check.

## Driving conventions

- Start each recipe from the baseline state unless its preconditions say otherwise. When a recipe saved data, use a fresh run or the reset recipe before the next one.
- Prefer `[data-action]` and `[data-field]` handles, then exact ARIA names (`role=button[name="…"s]`), then the few classes the SKILL lists.
- Type the demo request texts exactly. Demo mode matches them character for character.
- After every `command`, wait for a terminal `.activity-label` text before reading state. `Jev meldet den Auftrag als erledigt` means done. `Antwort ausstehend` means Jev asks a question.
- Treat `eval` as read-only.

## Proof and skip reporting

- A UI proof is a screenshot and an ARIA snapshot taken after the action, plus the `actions.jsonl` lines for that action.
- A mutation proof is also a `K state --run <id> <name>` file that shows the stored value, the `revision`, and the `receipts` rows.
- A read-only proof shows that `revision` and the receipt count stayed the same.
- Name the feature file and sub-feature ids you exercised, and the run id and evidence directory.
- If an entry point is unreachable in demo mode, say which one and why. Do not report it as verified through a different entry point.

## Feature entry contract

Each feature file starts with an H1 title and one paragraph describing the user-visible behavior. It then uses exactly four H2 sections in this order.

1. `Sub-features` lists short ids with one line for each behavior.
2. `How to get to it (user POV)` lists every user entry point.
3. `Driving it with kontor-verify` starts with `Preconditions:` and uses labeled bullets that pair each user action with an exact command and observable result.
4. `Gotchas` lists traps that can waste or invalidate a verification run.

Keep implementation details out of the map. Name only user paths, stable handles, required state, commands, and observable proof.

## Features

- [Jev palette run](./palette-run.md) covers a request typed into the command palette that Jev carries out to a saved change or a page sequence.
- [Missing value question](./missing-value.md) covers Jev asking for a value the request left out, the answer panel, and prefill.
- [Case list filters](./case-filters.md) covers search, status, customer, and technician filters, their reset, and the overview links that set them.
- [Case detail edit](./case-edit.md) covers opening a case, drafting changes, saving, discarding, and the completion blocker.
- [Reset demo data](./workspace-reset.md) covers the confirmation dialog and what a reset clears and keeps.

Not mapped yet: the customers, team, and reports pages beyond the links above, appointment editing, reviews and approvals that only live Jev produces, and the Jev confidence setting.

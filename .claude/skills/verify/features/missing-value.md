# Missing value question

When a request needs a value it does not state, Jev opens the case and asks instead of inventing one. The palette shows an answer panel with the field name and an input. The user's answer goes into the draft, and the run continues to the save. In live mode the input can arrive prefilled with a value Jev read from the request, and a date without a time asks only for the time.

## Sub-features

- `ask-open` shows `Antwort ausstehend` with the field label and focuses the input.
- `ask-no-write` stores nothing while the question is open.
- `ask-answer` saves the explicit answer after `Wert bestätigen`.
- `ask-stop` ends the run from the panel with `Auftrag stoppen`.
- `ask-prefill` prefills the input from the request (live Jev only).

## How to get to it (user POV)

- Send a request that leaves a needed value out, such as `Erfasse Arbeitszeit für V-1042 und speichere.`
- Choose `Antworten` next to the Jev status line to reopen a closed question.

## Driving it with kontor-verify

Preconditions:

- A fresh demo run from `K launch`, with `K doctor --run <id>` at exit 0.
- V-1042 has 0 minutes and no draft is open.

- **Ask.** Run `K browser --run <id> command "Erfasse Arbeitszeit für V-1042 und speichere."` and `K browser --run <id> wait .answer-panel`. `K browser --run <id> text .answer-panel` shows `Antwort ausstehend` and `V-1042 · Arbeitszeit in Minuten`. `K browser --run <id> eval 'document.activeElement.getAttribute("aria-label")'` prints `V-1042 · Arbeitszeit in Minuten`.
- **No write yet.** Run `K state --run <id> ask-open`. It shows `revision` 0 and no receipts.
- **Capture the question.** Run `K browser --run <id> screenshot ask-open` and `K browser --run <id> snapshot ask-open`.
- **Answer.** Run `K browser --run <id> fill '.answer-panel [data-answer-part="value"]' 47` and `K browser --run <id> click '.answer-panel [data-answer-submit]'`. Then run `K browser --run <id> wait .activity-label --text "Jev meldet den Auftrag als erledigt"`.
- **Prove the answer saved.** Run `K state --run <id> ask-answer`. It shows V-1042 with `minutes` 47, `revision` 1, and one receipt.
- **Stop instead.** In a fresh run, ask as above, then run `K browser --run <id> click 'role=button[name="Auftrag stoppen"s]'`. The status line reads `Gestoppt · bereits gespeicherte Änderungen bleiben erhalten`, and `state` still shows revision 0. The palette stays open. Close it with `K browser --run <id> press Escape` before clicking anything outside it.
- **Prefill.** Demo mode cannot reach this sub-feature, because only live Jev reads values from the request. Run the existing specs, which drive the real UI against a scripted Jev at the provider HTTP boundary with an in-memory database. Run `npx playwright test tests/missing-value.e2e.ts -g "prefilled" --reporter=line --output=/tmp/kontor-verify/<id>-playwright`. Two tests pass: a date is prefilled while its time stays empty, and the duration input holds the new value `90`, not the old one. A paid check needs `K launch --live` and the user's approval.

## Gotchas

- In demo mode the input is never prefilled. An empty input there is correct.
- Pressing Escape closes the palette and leaves the question open. The status line still reads `Antwort ausstehend`, and `K browser --run <id> click 'role=button[name="Antworten"s]'` reopens the panel.
- The answer input enforces the field's min and max (0 to 10000 minutes). An out-of-range value such as `20000` shows `Bitte einen gültigen Wert angeben.` as a `role=alert` in the panel, and the status line stays `Antwort ausstehend`.
- Without `--output`, Playwright writes `test-results/` into the repo. It is gitignored, but keep evidence under `/tmp/kontor-verify/`.

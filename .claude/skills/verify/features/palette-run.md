# Jev palette run

A user types a request into the Jev command palette. Jev then works through the visible controls step by step until the request is done: it opens pages, opens a case, drafts a change, and saves it. A save goes through the same save path as a manual save and leaves a receipt.

## Sub-features

- `palette-open` opens the palette from the header button or the keyboard shortcut.
- `palette-save` runs a request to a saved change, such as `Weise V-1042 Lea Sommer zu und speichere.`
- `palette-value-save` saves a number stated in the request, such as `Erfasse 45 Minuten für V-1042 und speichere.`
- `palette-navigate` opens one page (`Zeig mir die Kunden.`) or pages in order (`Zeige zuerst Kunden, danach Berichte und zuletzt Team.`) without changing data.
- `palette-history` lists earlier requests and their outcome under `Verlauf`.
- `palette-abstain` stops without acting when Jev cannot choose a step.

## How to get to it (user POV)

- Choose `✦ Jev · Befehl eingeben` in the header.
- Press `⌘ K` on macOS or `Ctrl K` elsewhere while no other dialog is open.
- Choose `Verlauf` next to the Jev status line to reopen the palette with its history.

## Driving it with kontor-verify

Preconditions:

- A fresh demo run from `K launch`, with `K doctor --run <id>` at exit 0.
- `K state --run <id>` shows revision 0, no receipts, and V-1042 assigned to `jonas`.

- **Run a saving request.** Type the request and submit it. Run `K browser --run <id> command "Weise V-1042 Lea Sommer zu und speichere."`. The palette closes and Jev starts.
- **Wait for the outcome.** Run `K browser --run <id> wait .activity-label --text "Jev meldet den Auftrag als erledigt"`. The status line reads exactly that text.
- **Read the visible result.** Run `K browser --run <id> text '.editor-footer [role=status]'` and `K browser --run <id> text '[data-action="menu:technician"]'`. They print `V-1042 gespeichert` and `Lea Sommer` followed by `⌄` on its own line.
- **Prove the stored change.** Run `K state --run <id> palette-save`. The file shows `revision` 1, one receipt for `V-1042`, and V-1042 with `technicianId` `lea`. All other cases are unchanged.
- **Second view.** Choose `Team`. Run `K browser --run <id> click '[data-action="nav:team"]'` and `K browser --run <id> text '.card'`. Lea Sommer's card lists V-1042.
- **Capture.** Run `K browser --run <id> screenshot palette-save` and `K browser --run <id> snapshot palette-save`.
- **Stated value.** In a fresh run, run `K browser --run <id> command "Erfasse 45 Minuten für V-1042 und speichere."` and wait as above. `K state --run <id>` shows V-1042 with `minutes` 45 at revision 1.
- **Navigation only.** In a fresh run, run `K browser --run <id> command "Zeige zuerst Kunden, danach Berichte und zuletzt Team."` and wait as above. `K browser --run <id> text h1` prints `Team & Kapazität`. `K state --run <id>` still shows revision 0 and no receipts.
- **History.** Choose `Verlauf`. Run `K browser --run <id> click 'role=button[name="Verlauf"s]'` and `K browser --run <id> text .history`. The list shows each request with its time and outcome. Close the palette with `K browser --run <id> press Escape`.
- **Abstain.** Send any text that is not one of the five demo texts. Run `K browser --run <id> command "Zeig mir bitte Berichte."`. `K browser --run <id> text '.choice-review h3'` prints `Jev hält bei Unklarheit an`, and the status line reads `Jev kann keinen sinnvollen nächsten Schritt wählen. …`. Nothing is saved.

## Gotchas

- Demo mode only knows the five texts in `shared/command.ts`. A changed character or missing period makes Jev abstain. That is correct demo behavior, not a regression.
- Opening the palette pauses a running request. Do not open it while you wait for an outcome. Read the status line instead.
- A request refuses to start while another case has an unsaved draft. The status line then says `Offenen Entwurf oder unbekanntes Speicherergebnis zuerst prüfen. …`. Save or discard the draft first.
- `Jev meldet den Auftrag als erledigt` alone is not proof. Check the receipt and the stored value with `state`.
- Demo decisions are fixed, so a demo run proves the app's step loop, gates, and save path, not Jev's understanding of German. Live checks need `--live` and the user's approval.

# Case detail edit

A user opens a case from the table and edits it in the detail form below: priority, assigned technician, work minutes, appointment, completion, and the inspection note. Every edit changes a draft first. `Speichern` stores the draft after the domain rules pass again. `Entwurf verwerfen` restores the saved state. An unsaved draft keeps the case open and blocks opening another one.

## Sub-features

- `edit-open` opens a case's detail and focuses its heading.
- `edit-draft` changes fields into an unsaved draft.
- `edit-save` stores the draft and shows `<id> gespeichert`.
- `edit-discard` restores the saved values.
- `edit-lock` keeps a dirty case open and disables `✕`.
- `edit-qualification` disables technicians without the case's skill.
- `edit-blocker` disables `Als erledigt markieren` until a user inspection note exists.

## How to get to it (user POV)

- Choose a case title in the `Vorgänge` table.
- Choose a case under a customer, a team member, or a report on the other pages.
- Choose `Vorgang öffnen ⌄` in the header and pick the case.

## Driving it with kontor-verify

Preconditions:

- A fresh demo run from `K launch` with `K doctor --run <id>` at exit 0.
- V-1041 is saved with priority `Normal` and 45 minutes.

- **Open.** Run `K browser --run <id> click '[data-action="case:V-1041"]'`. `K browser --run <id> text '.editor h2'` prints `Zugang für Einkauf einrichten`, and the footer status reads `Gespeicherter Stand`.
- **Draft.** Run `K browser --run <id> click '[data-action="priority:Hoch"]'` and `K browser --run <id> fill '[data-field="minutes"]' 60`. The footer status reads `Ungespeicherter Entwurf`, and `K state --run <id>` still shows revision 0.
- **Lock.** Run `K browser --run <id> eval 'document.querySelector("[data-action=close]").disabled'`. It prints `true`. Clicking `[data-action="case:V-1042"]` leaves `.editor h2` on `Zugang für Einkauf einrichten`.
- **Save.** Run `K browser --run <id> click '[data-action="save"]'` and `K browser --run <id> wait '.editor-footer [role=status]' --text "V-1041 gespeichert"`.
- **Prove the save.** Run `K state --run <id> edit-save`. It shows V-1041 with `priority` `Hoch`, `minutes` 60, the unchanged appointment, `revision` 1, and one receipt. Capture with `K browser --run <id> screenshot edit-save` and `K browser --run <id> snapshot edit-save`.
- **Discard.** Open V-1039, run `K browser --run <id> click '[data-action="menu:technician"]'` and `K browser --run <id> click '[data-action="technician:jonas"]'`, then run `K browser --run <id> click '[data-action="discard"]'`. The footer reads `Entwurf verworfen`, `K browser --run <id> text '[data-action="menu:technician"]'` starts with `Lea Sommer`, and `state` shows no new receipt.
- **Qualification.** With V-1039 open and the technician menu open, run `K browser --run <id> eval '[...document.querySelectorAll("[data-action^=technician]")].map(e => e.dataset.action + " " + e.disabled)'`. `technician:mara` is disabled, and its label reads `ohne Qualifikation Elektro`.
- **Blocker.** With V-1039 open, run `K browser --run <id> text '.editor .blocker'`. It prints `Die Prüfung vor Ort ist nicht belegt. …`, and `[data-action="complete"]` is disabled.

## Gotchas

- The minutes input is `[data-field="minutes"]` (also `#minutes`). Filling it marks the draft dirty on input. There is no blur step.
- `Speichern` is disabled until the draft differs from the saved state. A click on it then fails with `element is not enabled`.
- The inspection note is a human-only input. Jev may never fill it, and a save by Jev that changes it is refused. Do not use Jev to prove the completion path.
- Reopening a case with a draft keeps the draft values. Discard or save before starting the next recipe.

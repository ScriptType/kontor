# Reset demo data

`Demodaten zurücksetzen` in the page footer asks for confirmation and then restores the seed cases. It clears this tab's drafts, filters, request text, and Jev history, and it ends a running request. Stored receipts, the operating mode, and the confidence setting stay.

## Sub-features

- `reset-confirm` opens a dialog with focus on `Abbrechen`.
- `reset-cancel` closes the dialog by `Abbrechen`, Escape, or a backdrop click, and changes nothing.
- `reset-apply` restores the seed cases at the next revision and reports `Demodaten zurückgesetzt.`
- `reset-clears-ui` empties the search, filters, open case, and palette history.

## How to get to it (user POV)

- Choose `Demodaten zurücksetzen` in the footer of any page.

## Driving it with kontor-verify

Preconditions:

- A demo run from `K launch` with `K doctor --run <id>` at exit 0.
- At least one saved change, for example from the palette recipe `Weise V-1042 Lea Sommer zu und speichere.`, so `state` shows revision 1 and V-1042 with `lea`.

- **Open the dialog.** Run `K browser --run <id> click 'role=button[name="Demodaten zurücksetzen"s]'` and `K browser --run <id> wait 'role=dialog'`. `K browser --run <id> eval 'document.activeElement.textContent.trim()'` prints `Abbrechen`.
- **Cancel.** Run `K browser --run <id> press Escape` and `K browser --run <id> wait 'role=dialog' --gone`. `state` still shows revision 1.
- **Set some UI state.** Run `K browser --run <id> fill '[data-field="search"]' Nord` and `K browser --run <id> click '[data-action="filter:open"]'`.
- **Apply.** Open the dialog again, then run `K browser --run <id> click 'role=button[name="Jetzt zurücksetzen"s]'` and `K browser --run <id> wait '.workspace-foot [role=status]' --text "Demodaten zurückgesetzt."`.
- **Prove the data.** Run `K state --run <id> reset`. It shows `revision` 2, V-1042 back on `jonas`, all five seed cases, and the one earlier receipt still present.
- **Prove the UI.** `K browser --run <id> text '.titleline .muted'` includes `5 von 5 Vorgängen`. `[data-field="search"]` is empty. `K browser --run <id> text .activity-label` prints `Bereit für deinen Auftrag`. `K browser --run <id> eval 'localStorage.getItem("kontor-command-v1")'` shows `"command":""`, `"history":[]`, and `"unfinished":false`.
- **Capture.** Run `K browser --run <id> screenshot reset` and `K browser --run <id> snapshot reset`.

## Gotchas

- The dialog is modal. The palette shortcut does nothing while it is open.
- Reset needs the revision the tab last saw. If another tab or run saved in between, the dialog shows a `role=alert` conflict and keeps the data. That cannot happen across verification runs, because each has its own database.
- Reset does not delete receipts. A proof that expects zero receipts after a reset is wrong.
- A fresh `K launch` is the cheaper way to get seed data. Use this recipe only to prove the reset itself.

# Case list filters

The `Vorgänge` page lists every service case in a table. A user narrows it with a search box, a status choice, a customer menu, and a technician menu, and the filters combine. `Zurücksetzen` clears all of them. Links on the customers, team, and reports pages open the case list with their own filter instead of the current one. Filters never change stored data.

## Sub-features

- `filter-search` narrows rows to cases whose text matches the search.
- `filter-status` shows `Alle`, `Offen`, or `Erledigt` cases.
- `filter-customer` limits rows to one customer.
- `filter-technician` limits rows to one assigned technician.
- `filter-combine` applies several filters at once.
- `filter-reset` clears every filter and the search.
- `filter-links` replaces the filters from a customer, team, or report link.

## How to get to it (user POV)

- Open `Vorgänge` in the sidebar. The toolbar above the table holds the search box, `Kunde · Alle ⌄`, `Zuständig · Alle ⌄`, the `Vorgangsstatus` group, and `Zurücksetzen`.
- On `Kunden`, choose a customer's link to open that customer's cases.
- On `Team`, choose a person's link to open that person's open cases.
- On `Berichte`, choose the open or done count, or a customer under `Arbeitszeit nach Kunde`.
- Ask Jev in the palette (live mode only for free text).

## Driving it with kontor-verify

Preconditions:

- A demo run from `K launch` with `K doctor --run <id>` at exit 0, showing the unfiltered `Vorgänge` page.
- `K browser --run <id> text '.titleline .muted'` includes `5 von 5 Vorgängen`.

- **Search.** Run `K browser --run <id> fill '[data-field="search"]' Wartung`. The count reads `2 von 5 Vorgängen`, and `K browser --run <id> text 'tbody tr'` lists V-1042 and V-1039 only.
- **Status.** Run `K browser --run <id> click '[data-action="filter:open"]'`. That button now has `aria-pressed="true"` and is disabled. `filter:done` alone shows one row, V-1035.
- **Customer.** Run `K browser --run <id> click '[data-action="menu:customer"]'` and `K browser --run <id> click '[data-action="customer:nord"]'`. The menu button reads `Kunde · Nordwerk GmbH ⌄`.
- **Technician.** Run `K browser --run <id> click '[data-action="menu:filter-technician"]'` and `K browser --run <id> click '[data-action="filter-technician:lea"]'`. With the search `Wartung`, status `Offen`, and Nordwerk still set, `tbody tr` shows only V-1039, because seed data assigns V-1042 to Jonas Weber. The count reads `1 von 5 Vorgängen`.
- **Capture.** Run `K browser --run <id> screenshot filters-combined` and `K browser --run <id> snapshot filters-combined`.
- **Reset filters.** Run `K browser --run <id> click '[data-action="filter:reset"]'`. The count reads `5 von 5 Vorgängen`, the search box is empty, and both menus read `Alle`.
- **Links.** Run `K browser --run <id> click '[data-action="nav:customers"]'` then `K browser --run <id> click '[data-action="customer-cases:hafen"]'`. The case page shows V-1041 and V-1035 with `Kunde · Hafen & Partner ⌄`. From `nav:team`, `technician-cases:mara` shows Mara Schulz's open case V-1037. From `nav:reports`, `status-cases:done` shows V-1035.
- **Read-only proof.** Run `K state --run <id> filters`. It still shows `revision` 0 and no receipts.

## Gotchas

- Filters live in the page, not the database, so `state` never shows them. Prove them from the table rows and the count.
- A disabled filter button is the active one. Clicking it fails with `element is not enabled`, which is expected.
- The menus are popovers. A second click on `menu:customer` closes it. Open the menu before choosing an item in each call.
- The header menu `Vorgang öffnen ⌄` (`menu:open-case`, then `open-case:<id>`) opens any case whatever the filters hide, and leaves the filters unchanged.

import assert from "node:assert/strict";
import { test } from "node:test";
import { seedWorkspace } from "../shared/domain.js";
import { requestHints, requestOrdinals } from "../shared/request-hints.js";

const workspace = seedWorkspace();
test("request hints bind hour phrases and field words to numbers and name cases in request order", () => {
  const hints = requestHints(
    "1042 bekommt Termin für eine Stunde, und 55 Minuten Arbeit, dann die 1039",
    workspace,
  );
  assert.deepEqual(hints.cases, ["V-1042", "V-1039"]);
  assert.deepEqual(
    hints.numbers.map(({ value, from, fields }) => ({ value, from, fields })),
    [
      { value: 60, from: "eine Stunde", fields: ["duration"] },
      { value: 55, from: undefined, fields: ["minutes"] },
    ],
  );
});
test("request hints map names with a one-letter typo and skip common words that look like a name", () => {
  const hints = requestHints(
    "jonsa soll die 1041 von hafn übernehmen, wir haben keine Zeit",
    workspace,
  );
  assert.deepEqual(
    hints.technicians.map((t) => t.id),
    ["jonas"],
  );
  assert.deepEqual(
    hints.customers.map((c) => [c.id, c.mention]),
    [["hafen", "hafn"]],
  );
});
test("request hints list page words in the order the request names them", () => {
  assert.deepEqual(
    requestHints("erst Berichte, dann Kunden und zuletzt das Team", workspace)
      .pageWordsInOrder,
    ["reports", "customers", "team"],
  );
});
test("request ordinals name list rows with an article and skip 'erst' as an order word", () => {
  assert.deepEqual(
    requestOrdinals(
      "zeig die offenen vorgänge von jonas weber.\nWähle den ersten aus und gib den lea",
    ),
    [{ mention: "den ersten", row: 1 }],
  );
  assert.deepEqual(
    requestOrdinals("Nimm die zweite und danach den letzten Vorgang"),
    [
      { mention: "die zweite", row: 2 },
      { mention: "den letzten", row: -1 },
    ],
  );
  assert.deepEqual(
    requestOrdinals("erst die Berichte, zuerst 1042, als erstes Lea"),
    [],
  );
});

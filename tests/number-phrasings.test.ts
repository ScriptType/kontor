import assert from "node:assert/strict";
import { test } from "node:test";
import type { FieldDescription } from "../shared/command.js";
import { fieldValues } from "../shared/field-values.js";

const ids = ["V-1035", "V-1037", "V-1039", "V-1041", "V-1042"];
const field = (
  id: "minutes" | "duration",
  scope: string,
): FieldDescription => ({
  id,
  scope,
  label: id,
  kind: "draft",
  type: "number",
  current: "0",
  min: id === "duration" ? 15 : 0,
  max: id === "duration" ? 480 : 10000,
  jev: { name: id },
});
const offered = (id: "minutes" | "duration", scope: string, request: string) =>
  fieldValues(field(id, scope), request, [], ids).map((v) => v.value);

// request, case whose fields are on screen, worked-minutes and duration candidates
const phrasings: [string, string, string[], string[]][] = [
  ["1039 arbeitszeit 45, termin 60 min", "V-1039", ["45"], ["60"]],
  ["bei 1041 war lea 2 stunden dran", "V-1041", [], []],
  ["hab an 1039 anderthalb stunden gearbeitet", "V-1039", [], []],
  ["1041 termin morgen 9 uhr, dauert 2 stunden", "V-1041", [], []],
  ["1042 termin 45 min", "V-1042", [], ["45"]],
  ["1041 auf lea mit 75 min dann teamansicht", "V-1041", ["75"], ["75"]],
  ["V-1042: 30 min", "V-1042", ["30"], ["30"]],
  ["arbeitszeit 1,5 h bei 1037", "V-1037", [], []],
  ["1039 dauer 90min", "V-1039", [], ["90"]],
  ["termin um 9 für 1041, 60 min", "V-1041", [], ["60"]],
  ["den termin von 1041 um 30 min kürzen", "V-1041", [], ["30"]],
  ["1037 termin am 2026-09-28 09:00, 45 min", "V-1037", [], ["45"]],
  ["termin 28.9. 14:30, dauer 60", "V-1037", [], ["60"]],
  ["jonas war 40 min dran bei 1042", "V-1042", ["40"], []],
  ["worked 50 minutes on V-1041", "V-1041", ["50"], []],
  ["appointment for 1039 is 120 minutes", "V-1039", [], ["120"]],
  ["1041 arbeitszeit 45 und termin 60", "V-1041", ["45"], ["60"]],
  ["bei 1037 arbeitszeit auf 35. 1039 termin 90 min", "V-1037", ["35"], []],
  ["bei 1037 arbeitszeit auf 35. 1039 termin 90 min", "V-1039", [], ["90"]],
  ["45 min für 1042", "V-1042", ["45"], ["45"]],
  ["45 min für 1042", "V-1041", [], []],
  [
    "termin bei 1041 von 120 auf 60 min kürzen, arbeitszeit bleibt",
    "V-1041",
    [],
    ["120", "60"],
  ],
  ["1042: 2 std", "V-1042", [], []],
  ["V-1041 erledigt, 45 minuten", "V-1041", ["45"], ["45"]],
  ["gegen 10 uhr termin für 1039, 30 minuten", "V-1039", [], ["30"]],
  ["halb elf termin 1037, 45 min dauer", "V-1037", [], ["45"]],
  [
    "1041 hatte 3 rückfragen, 20 min telefoniert",
    "V-1041",
    ["3", "20"],
    ["20"],
  ],
  ["Termin V-1039 at 2026-10-02 07:30 for 180 minutes", "V-1039", [], ["180"]],
  ["1041: prio hoch + termin 90 min", "V-1041", [], ["90"]],
  // A clause that names no case leaves its number to every case.
  [
    "zeiten: 1041 → 70; der ohne arbeitszeit → 25",
    "V-1041",
    ["70", "25"],
    ["70"],
  ],
  ["zeiten: 1041 → 70; der ohne arbeitszeit → 25", "V-1042", ["25"], []],
  ["sie hat 40 Minuten dort gearbeitet", "V-1042", ["40"], []],
  ["morgen um 9, 60 min", "V-1037", ["60"], ["60"]],
  ["am 24.9. um 14 uhr 90 min termin", "V-1039", [], ["90"]],
  ["45 min arbeit, termin 60", "V-1041", ["45"], ["60"]],
  ["das hat 40 min gedauert bei 1037", "V-1037", ["40"], ["40"]],
];

for (const [request, scope, minutes, duration] of phrasings)
  test(`"${request}" on ${scope}`, () => {
    assert.deepEqual(offered("minutes", scope, request), minutes, "minutes");
    assert.deepEqual(offered("duration", scope, request), duration, "duration");
  });

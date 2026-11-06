import { test } from "node:test";
import assert from "node:assert/strict";
import * as S from "../js/store.js";

const day = "2026-11-01";

test("rejects blank, long and duplicate names (case-insensitive)", () => {
  const st = S.emptyState();
  assert.ok(S.addPerson(st, "Alice").person);
  assert.equal(S.addPerson(st, "  ").error, "Enter a name");
  assert.equal(S.addPerson(st, " alice ").error, "That name is already used");
  assert.match(S.addPerson(st, "x".repeat(41)).error, /40/);
  assert.equal(st.people.length, 1);
});

test("same-day entry replaces the earlier one", () => {
  const st = S.emptyState();
  const a = S.addPerson(st, "Alice").person;
  S.logWeight(st, a.id, day, 70);
  S.logWeight(st, a.id, day, 69.5);
  assert.deepEqual(S.entriesFor(st, a.id).map((e) => e.kg), [69.5]);
});

test("entries come back sorted by date", () => {
  const st = S.emptyState();
  const a = S.addPerson(st, "Alice").person;
  S.logWeight(st, a.id, "2026-11-05", 70);
  S.logWeight(st, a.id, "2026-10-30", 71);
  assert.deepEqual(S.entriesFor(st, a.id).map((e) => e.date), ["2026-10-30", "2026-11-05"]);
});

test("deleting a person removes only their entries", () => {
  const st = S.emptyState();
  const a = S.addPerson(st, "Alice").person;
  const b = S.addPerson(st, "Bob").person;
  S.logWeight(st, a.id, day, 70);
  S.logWeight(st, b.id, day, 80);
  S.deletePerson(st, a.id);
  assert.deepEqual(st.people.map((p) => p.name), ["Bob"]);
  assert.deepEqual(st.entries.map((e) => e.personId), [b.id]);
});

test("rename refuses a clash but allows changing your own case", () => {
  const st = S.emptyState();
  const a = S.addPerson(st, "Alice").person;
  S.addPerson(st, "Bob");
  assert.ok(S.renamePerson(st, a.id, "BOB").error);
  assert.ok(S.renamePerson(st, a.id, "ALICE").person);
});

test("parseKg accepts comma decimals and rejects nonsense", () => {
  assert.equal(S.parseKg("72,5"), 72.5);
  assert.equal(S.parseKg(" 72.5 "), 72.5);
  for (const bad of ["", "abc", "0", "-3", "900", "7e1", "72.5kg", "1.2.3"]) assert.equal(S.parseKg(bad), null, bad);
});

test("date helpers", () => {
  assert.equal(S.todayISO(new Date(2026, 0, 5)), "2026-01-05");
  assert.ok(S.isValidISODate("2024-02-29"));
  assert.ok(!S.isValidISODate("2026-02-29"));
  assert.ok(!S.isValidISODate("2026-13-01"));
  assert.equal(S.dayNumber("2026-11-02") - S.dayNumber("2026-10-31"), 2);
  assert.equal(S.isoFromDay(S.dayNumber("2026-03-29")), "2026-03-29"); // across DST
});

test("export then import round-trips exactly", () => {
  const st = S.emptyState();
  const a = S.addPerson(st, "Alice").person;
  const b = S.addPerson(st, "Bob").person;
  S.logWeight(st, a.id, day, 70.25);
  S.logWeight(st, b.id, "2026-10-01", 88);
  const json = JSON.stringify(S.toExport(st));
  const back = S.parseState(json);
  assert.deepEqual(back.people, st.people);
  assert.deepEqual(S.entriesFor(back, a.id), S.entriesFor(st, a.id));
  assert.equal(JSON.parse(json).format, "weigh-in");
  // New ids never collide with imported ones.
  const c = S.addPerson(back, "Cat").person;
  assert.ok(c.id > Math.max(...back.entries.map((e) => e.id), ...back.people.map((p) => p.id)) - 1);
  assert.ok(!back.entries.some((e) => e.id === c.id));
});

test("import rejects bad files with readable messages", () => {
  const ok = { format: "weigh-in", version: 1, people: [{ id: 1, name: "A" }], entries: [{ id: 2, personId: 1, date: day, kg: 70 }] };
  const bad = (patch) => JSON.stringify({ ...ok, ...patch });
  assert.throws(() => S.parseState("{nope"), /valid JSON/);
  assert.throws(() => S.parseState("[]"), /doesn't look like/);
  assert.throws(() => S.parseState(bad({ format: "other" })), /different app/);
  assert.throws(() => S.parseState(bad({ version: 99 })), /newer version/);
  assert.throws(() => S.parseState(bad({ people: [{ id: 1, name: "A" }, { id: 3, name: "a" }] })), /appears twice/);
  assert.throws(() => S.parseState(bad({ entries: [{ id: 2, personId: 9, date: day, kg: 70 }] })), /unknown person/);
  assert.throws(() => S.parseState(bad({ entries: [{ id: 2, personId: 1, date: "2026-02-30", kg: 70 }] })), /invalid date/);
  assert.throws(() => S.parseState(bad({ entries: [{ id: 2, personId: 1, date: day, kg: "70" }] })), /invalid weight/);
  assert.throws(() => S.parseState(bad({ entries: [{ id: 1, personId: 1, date: day, kg: 70 }] })), /Duplicate id/);
  assert.equal(S.parseState(JSON.stringify(ok)).entries.length, 1);
});

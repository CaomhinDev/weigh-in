// Pure data logic: no DOM, no storage. Functions mutate the state they're given.

export const FORMAT = "weigh-in";
export const VERSION = 1;
export const MAX_KG = 700;

export function emptyState() {
  return { nextId: 1, people: [], entries: [] };
}

// ---- Dates: stored as local "YYYY-MM-DD" strings ----

export function todayISO(now = new Date()) {
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, "0");
  const d = String(now.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

export function isValidISODate(s) {
  if (typeof s !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const [y, m, d] = s.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
}

/** Whole days since 1970-01-01, for spacing points on the time axis. */
export function dayNumber(iso) {
  const [y, m, d] = iso.split("-").map(Number);
  return Date.UTC(y, m - 1, d) / 86_400_000;
}

export function isoFromDay(n) {
  return new Date(n * 86_400_000).toISOString().slice(0, 10);
}

// ---- Validation ----

/** Accepts "72.5" or "72,5"; returns null unless it's a plausible body weight. */
export function parseKg(text) {
  const t = String(text ?? "").trim().replace(",", ".");
  if (!/^\d+(\.\d+)?$/.test(t)) return null;
  const kg = Number(t);
  return kg > 0 && kg < MAX_KG ? kg : null;
}

function nameTaken(state, name, exceptId) {
  const n = name.toLocaleLowerCase();
  return state.people.some((p) => p.id !== exceptId && p.name.toLocaleLowerCase() === n);
}

/** Returns an error message, or null when the name can be used. */
export function nameError(state, name, exceptId = null) {
  const clean = name.trim();
  if (!clean) return "Enter a name";
  if (clean.length > 40) return "Keep names under 40 characters";
  if (nameTaken(state, clean, exceptId)) return "That name is already used";
  return null;
}

// ---- Mutations ----

export function addPerson(state, name) {
  const error = nameError(state, name);
  if (error) return { error };
  const person = { id: state.nextId++, name: name.trim() };
  state.people.push(person);
  return { person };
}

export function renamePerson(state, id, name) {
  const person = state.people.find((p) => p.id === id);
  if (!person) return { error: "Person not found" };
  const error = nameError(state, name, id);
  if (error) return { error };
  person.name = name.trim();
  return { person };
}

export function deletePerson(state, id) {
  state.people = state.people.filter((p) => p.id !== id);
  state.entries = state.entries.filter((e) => e.personId !== id);
}

/** Logs a weight; a second entry for the same person and day replaces the first. */
export function logWeight(state, personId, date, kg) {
  const existing = state.entries.find((e) => e.personId === personId && e.date === date);
  if (existing) {
    existing.kg = kg;
    return existing;
  }
  const entry = { id: state.nextId++, personId, date, kg };
  state.entries.push(entry);
  return entry;
}

export function deleteEntry(state, id) {
  state.entries = state.entries.filter((e) => e.id !== id);
}

export function entriesFor(state, personId) {
  return state.entries
    .filter((e) => e.personId === personId)
    .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
}

// ---- Export / import ----

export function toExport(state, now = new Date()) {
  return {
    format: FORMAT,
    version: VERSION,
    exportedAt: now.toISOString(),
    people: state.people.map(({ id, name }) => ({ id, name })),
    entries: entriesSorted(state).map(({ id, personId, date, kg }) => ({ id, personId, date, kg })),
  };
}

function entriesSorted(state) {
  return [...state.entries].sort((a, b) => a.personId - b.personId || (a.date < b.date ? -1 : 1));
}

/**
 * Parses and validates exported JSON (or the stored state, which has the same
 * people/entries shape). Throws an Error with a readable message on bad input.
 */
export function parseState(text) {
  let data;
  try {
    data = typeof text === "string" ? JSON.parse(text) : text;
  } catch {
    throw new Error("This file isn't valid JSON.");
  }
  if (!data || typeof data !== "object" || !Array.isArray(data.people) || !Array.isArray(data.entries)) {
    throw new Error("This doesn't look like a Weigh In export.");
  }
  if (data.format !== undefined && data.format !== FORMAT) {
    throw new Error("This file is from a different app.");
  }
  if (typeof data.version === "number" && data.version > VERSION) {
    throw new Error("This file is from a newer version of Weigh In.");
  }

  const state = emptyState();
  const ids = new Set();
  const useId = (id, what) => {
    if (!Number.isInteger(id) || id < 1) throw new Error(`A ${what} has an invalid id.`);
    if (ids.has(id)) throw new Error(`Duplicate id ${id} in file.`);
    ids.add(id);
  };

  for (const p of data.people) {
    useId(p?.id, "person");
    const name = typeof p.name === "string" ? p.name.trim() : "";
    if (!name) throw new Error(`Person ${p.id} has no name.`);
    if (nameTaken(state, name, null)) throw new Error(`The name "${name}" appears twice.`);
    state.people.push({ id: p.id, name });
  }
  const personIds = new Set(state.people.map((p) => p.id));
  const seen = new Map(); // "personId|date" -> entry, later entries win
  for (const e of data.entries) {
    useId(e?.id, "entry");
    if (!personIds.has(e.personId)) throw new Error(`Entry ${e.id} belongs to an unknown person.`);
    if (!isValidISODate(e.date)) throw new Error(`Entry ${e.id} has an invalid date.`);
    if (typeof e.kg !== "number" || !(e.kg > 0 && e.kg < MAX_KG)) throw new Error(`Entry ${e.id} has an invalid weight.`);
    seen.set(`${e.personId}|${e.date}`, { id: e.id, personId: e.personId, date: e.date, kg: e.kg });
  }
  state.entries = [...seen.values()];
  state.nextId = Math.max(0, ...ids) + 1;
  return state;
}

// Security rules tests, run against the local Firestore emulator: npm run test:rules
import { test, before, after, beforeEach } from "node:test";
import { readFileSync } from "node:fs";
import { initializeTestEnvironment, assertSucceeds, assertFails } from "@firebase/rules-unit-testing";
import { doc, getDoc, setDoc, updateDoc, deleteDoc, collection, getDocs, writeBatch } from "firebase/firestore";

let env;
const ADMIN = { uid: "admin", email: "Boss@Example.com" }; // mixed case on purpose
const ANN = { uid: "ann", email: "ann@example.com" };
const BOB = { uid: "bob", email: "bob@example.com" };
const STRANGER = { uid: "x", email: "stranger@example.com" };

const as = (u, verified = true) => env.authenticatedContext(u.uid, { email: u.email, email_verified: verified }).firestore();
const person = (id, name = "Ann") => ({ id, name });
const entry = (personId, date, kg = 70.5, id = 99) => ({ id, personId, date, kg });

before(async () => {
  env = await initializeTestEnvironment({
    projectId: "demo-weighin",
    firestore: { rules: readFileSync("firestore.rules", "utf8"), host: "127.0.0.1", port: 8096 },
  });
});
after(() => env.cleanup());
beforeEach(async () => {
  await env.clearFirestore();
  await env.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore();
    await setDoc(doc(db, "allow/boss@example.com"), { name: "Boss", role: "admin" });
    await setDoc(doc(db, "allow/ann@example.com"), { name: "Ann", role: "member" });
    await setDoc(doc(db, "allow/bob@example.com"), { name: "Bob" }); // no role = member
    await setDoc(doc(db, "users/ann/people/1"), person(1));
    await setDoc(doc(db, "users/ann/entries/1_2026-11-01"), entry(1, "2026-11-01"));
  });
});

test("an invited user reads and writes their own data", async () => {
  const db = as(ANN);
  await assertSucceeds(getDocs(collection(db, "users/ann/people")));
  await assertSucceeds(getDocs(collection(db, "users/ann/entries")));
  await assertSucceeds(setDoc(doc(db, "users/ann/people/2"), person(2, "Kid")));
  await assertSucceeds(setDoc(doc(db, "users/ann/entries/2_2026-11-02"), entry(2, "2026-11-02", 30)));
  await assertSucceeds(updateDoc(doc(db, "users/ann/entries/1_2026-11-01"), { kg: 70 })); // whole kg is an int
  await assertSucceeds(updateDoc(doc(db, "users/ann/people/1"), { name: "Annie" }));
  await assertSucceeds(deleteDoc(doc(db, "users/ann/entries/1_2026-11-01")));
  await assertSucceeds(deleteDoc(doc(db, "users/ann/people/1")));
});

test("nobody else can see or touch a user's data, not even the admin", async () => {
  for (const db of [as(BOB), as(ADMIN), as(STRANGER), as(ANN, false), env.unauthenticatedContext().firestore()]) {
    await assertFails(getDocs(collection(db, "users/ann/people")));
    await assertFails(getDoc(doc(db, "users/ann/entries/1_2026-11-01")));
    await assertFails(setDoc(doc(db, "users/ann/people/5"), person(5, "Evil")));
    await assertFails(updateDoc(doc(db, "users/ann/entries/1_2026-11-01"), { kg: 50 }));
    await assertFails(deleteDoc(doc(db, "users/ann/people/1")));
  }
  // A user can't read the parent or collection-group style paths either.
  await assertFails(getDoc(doc(as(ANN), "users/ann")));
  await assertFails(setDoc(doc(as(ANN), "users/ann"), { x: 1 }));
  await assertFails(setDoc(doc(as(ANN), "users/ann/other/1"), { x: 1 }));
});

test("someone who isn't invited can't store anything, even under their own uid", async () => {
  const db = as(STRANGER);
  await assertFails(setDoc(doc(db, "users/x/people/1"), person(1)));
  await assertFails(getDocs(collection(db, "users/x/people")));
  // ...but may check their own (missing) invite, which is how the app says "not invited".
  await assertSucceeds(getDoc(doc(db, "allow/stranger@example.com")));
});

test("bad data is refused", async () => {
  const db = as(ANN);
  const bad = [
    ["users/ann/people/3", { id: 3, name: "" }],
    ["users/ann/people/3", { id: 3, name: "x".repeat(101) }],
    ["users/ann/people/3", { id: 4, name: "Wrong id" }],
    ["users/ann/people/3", { id: "3", name: "String id" }],
    ["users/ann/people/3", { id: 3, name: "Extra", admin: true }],
    ["users/ann/people/3", { id: 3 }],
    ["users/ann/people/0", { id: 0, name: "Zero" }],
    ["users/ann/entries/1_2026-11-03", entry(1, "2026-11-03", 0)],
    ["users/ann/entries/1_2026-11-03", entry(1, "2026-11-03", 700)],
    ["users/ann/entries/1_2026-11-03", entry(1, "2026-11-03", "70")],
    ["users/ann/entries/1_2026-11-03", entry(1, "2026-11-04")], // key doesn't match
    ["users/ann/entries/1_2026-13-03", entry(1, "2026-13-03")],
    ["users/ann/entries/1_<script>", entry(1, "<script>")],
    ["users/ann/entries/1_2026-11-03", { ...entry(1, "2026-11-03"), note: "x".repeat(10000) }],
    ["users/ann/entries/1_2026-11-03", { personId: 1, date: "2026-11-03", kg: 70 }],
  ];
  for (const [path, data] of bad) await assertFails(setDoc(doc(db, path), data));
});

test("large imports work in batches of 20", async () => {
  const db = as(ANN);
  const batch = writeBatch(db);
  for (let i = 1; i <= 20; i++) batch.set(doc(db, `users/ann/entries/1_2025-01-${String(i).padStart(2, "0")}`), entry(1, `2025-01-${String(i).padStart(2, "0")}`, 70, i));
  await assertSucceeds(batch.commit());
});

test("only the admin lists and manages invites, and never the admin entry", async () => {
  await assertSucceeds(getDocs(collection(as(ADMIN), "allow")));
  await assertFails(getDocs(collection(as(ANN), "allow")));
  await assertSucceeds(getDoc(doc(as(ANN), "allow/ann@example.com")));
  await assertFails(getDoc(doc(as(ANN), "allow/bob@example.com")));

  await assertSucceeds(setDoc(doc(as(ADMIN), "allow/new@example.com"), { name: "New", role: "member", addedBy: "boss@example.com" }));
  await assertSucceeds(updateDoc(doc(as(ADMIN), "allow/ann@example.com"), { name: "Annie" }));
  await assertSucceeds(deleteDoc(doc(as(ADMIN), "allow/bob@example.com")));
  await assertFails(setDoc(doc(as(ADMIN), "allow/two@example.com"), { name: "Two", role: "admin" }));
  await assertFails(setDoc(doc(as(ADMIN), "allow/Upper@example.com"), { name: "U", role: "member" }));
  await assertFails(setDoc(doc(as(ADMIN), "allow/not-an-email"), { name: "U", role: "member" }));
  await assertFails(setDoc(doc(as(ADMIN), "allow/x@example.com"), { name: "U", role: "member", extra: 1 }));
  await assertFails(updateDoc(doc(as(ADMIN), "allow/ann@example.com"), { role: "admin" }));
  await assertFails(updateDoc(doc(as(ADMIN), "allow/boss@example.com"), { name: "Me" }));
  await assertFails(deleteDoc(doc(as(ADMIN), "allow/boss@example.com")));

  await assertFails(setDoc(doc(as(ANN), "allow/friend@example.com"), { name: "F", role: "member" }));
  await assertFails(updateDoc(doc(as(ANN), "allow/ann@example.com"), { role: "admin" }));
  await assertFails(deleteDoc(doc(as(ANN), "allow/bob@example.com")));
  await assertFails(setDoc(doc(as(STRANGER), "allow/stranger@example.com"), { name: "Me", role: "member" }));
});

test("someone removed from the list loses access to their data straight away", async () => {
  await env.withSecurityRulesDisabled((ctx) => deleteDoc(doc(ctx.firestore(), "allow/ann@example.com")));
  await assertFails(getDocs(collection(as(ANN), "users/ann/people")));
  await assertFails(setDoc(doc(as(ANN), "users/ann/people/2"), person(2)));
});

// Firebase: Google sign-in, the invite list, and each user's private data.
//
// Only loaded when someone chooses to sign in; "this device only" never loads it.
//
// Data layout (enforced by firestore.rules):
//   allow/{email}                      { name, role: "admin" | "member", addedBy }
//   users/{uid}/people/{id}            { id, name }
//   users/{uid}/entries/{personId}_{date}  { id, personId, date, kg }
// Only the owner can read or write users/{uid}, not even the admin.

import { firebaseConfig, useEmulator } from "./firebase-config.js";
import { initializeApp } from "https://www.gstatic.com/firebasejs/13.2.0/firebase-app.js";
import {
  getAuth, onAuthStateChanged, GoogleAuthProvider, signInWithPopup, signInWithRedirect,
  signOut as fbSignOut, connectAuthEmulator, signInWithCredential,
} from "https://www.gstatic.com/firebasejs/13.2.0/firebase-auth.js";
import {
  initializeFirestore, persistentLocalCache, persistentMultipleTabManager, connectFirestoreEmulator,
  doc, getDoc, setDoc, deleteDoc, onSnapshot, collection, writeBatch, terminate, clearIndexedDbPersistence,
} from "https://www.gstatic.com/firebasejs/13.2.0/firebase-firestore.js";

const config = useEmulator
  ? { apiKey: "demo-key", authDomain: "demo-weighin.firebaseapp.com", projectId: "demo-weighin", appId: "demo" }
  : firebaseConfig;
if (!config) throw new Error("Firebase isn't set up (js/firebase-config.js).");

const app = initializeApp(config);
const auth = getAuth(app);
let db;
try {
  // Offline support: reads come from a cache in this browser, writes queue until back online.
  // The cache is wiped on sign-out (see signOut).
  db = initializeFirestore(app, { localCache: persistentLocalCache({ tabManager: persistentMultipleTabManager() }) });
} catch {
  db = initializeFirestore(app, {});
}
if (useEmulator) {
  connectAuthEmulator(auth, "http://127.0.0.1:9119", { disableWarnings: true });
  connectFirestoreEmulator(db, "127.0.0.1", 8096);
}

export const isEmulator = useEmulator;

export function onUser(cb) {
  return onAuthStateChanged(auth, (u) => cb(u ? { uid: u.uid, email: (u.email ?? "").toLowerCase(), name: u.displayName || "" } : null));
}

export async function signIn() {
  const provider = new GoogleAuthProvider();
  provider.setCustomParameters({ prompt: "select_account" });
  try {
    await signInWithPopup(auth, provider);
  } catch (e) {
    if (e?.code === "auth/popup-blocked" || e?.code === "auth/operation-not-supported-in-this-environment") {
      await signInWithRedirect(auth, provider);
    } else if (e?.code !== "auth/popup-closed-by-user" && e?.code !== "auth/cancelled-popup-request") {
      throw e;
    }
  }
}

/** Signs out and wipes this browser's offline copy of the account's data. Reload afterwards. */
export async function signOut() {
  await fbSignOut(auth);
  try {
    await terminate(db);
    await clearIndexedDbPersistence(db);
  } catch (e) {
    console.warn("Couldn't clear the offline cache:", e);
  }
}

/** Emulator only: sign in as any Google account, for automated tests. */
export async function testSignIn(email, name = "") {
  if (!useEmulator) throw new Error("testSignIn is only available with the emulator");
  const token = JSON.stringify({ sub: email.replace(/\W/g, "_"), email, email_verified: true, name });
  await signInWithCredential(auth, GoogleAuthProvider.credential(token));
}

/** { role, name } if this account is invited, false if not, null if it can't be checked (offline). */
export async function getAccess(user) {
  try {
    const snap = await getDoc(doc(db, "allow", user.email));
    if (!snap.exists()) return false;
    const d = snap.data();
    return { role: d.role === "admin" ? "admin" : "member", name: String(d.name ?? "") };
  } catch (e) {
    if (e?.code === "permission-denied") return false;
    return null;
  }
}

/**
 * cb(access) whenever this account's invite changes: { role, name }, or false once
 * it's removed. (Open listeners aren't re-checked against the rules when an invite
 * is deleted, so the app watches for that itself.)
 */
export function watchAccess(user, cb, onError) {
  return onSnapshot(doc(db, "allow", user.email), (snap) => {
    if (!snap.exists()) return cb(false);
    const d = snap.data();
    cb({ role: d.role === "admin" ? "admin" : "member", name: String(d.name ?? "") });
  }, onError);
}

// ---- the signed-in user's own data

/** cb({ people, entries }) with raw documents once both have loaded, then on every change. */
export function watchData(uid, cb, onError) {
  const data = {};
  const emit = () => { if (data.people && data.entries) cb({ ...data }); };
  const subs = ["people", "entries"].map((kind) =>
    onSnapshot(collection(db, "users", uid, kind), (s) => { data[kind] = s.docs.map((d) => d.data()); emit(); }, onError));
  return () => subs.forEach((u) => u());
}

// Each write checks the invite list once, and rules allow at most 20 such checks
// per batch, so writes go in batches of 20.
const BATCH = 20;

/** Applies ops from store.diffState: [{ op: "set" | "delete", kind, id, data }]. */
export async function applyChanges(uid, ops) {
  const commits = [];
  for (let i = 0; i < ops.length; i += BATCH) {
    const batch = writeBatch(db);
    for (const o of ops.slice(i, i + BATCH)) {
      const ref = doc(db, "users", uid, o.kind, o.id);
      if (o.op === "set") batch.set(ref, o.data);
      else batch.delete(ref);
    }
    commits.push(batch.commit());
  }
  await Promise.all(commits);
}

// ---- invite list (admin only)

export function watchMembers(cb, onError) {
  return onSnapshot(collection(db, "allow"), (s) => cb(s.docs.map((d) => {
    const x = d.data();
    return { email: d.id, name: String(x.name ?? ""), role: x.role === "admin" ? "admin" : "member" };
  })), onError);
}

export const addMember = (email, name, addedBy) =>
  setDoc(doc(db, "allow", email.trim().toLowerCase()), { name: String(name ?? "").trim().slice(0, 60), role: "member", addedBy });

export const removeMember = (email) => deleteDoc(doc(db, "allow", email));

import * as S from "./store.js";
import { MAX_CHART_PEOPLE, toggleSlot, niceTicks, spreadLabels, nearestBy } from "./chart-math.js";
import * as storage from "./storage.js";
import { cloudAvailable } from "./firebase-config.js";

// ---------------------------------------------------------------- state
//
// Two modes:
//   local – data lives in this browser's localStorage only (anyone can use it).
//   cloud – signed in with Google; data lives in the user's own private space in
//           Firestore. Only people the admin has invited get in.
// mode null = not chosen yet (first visit): the start screen offers both.

const loaded = storage.loadState();
const app = {
  mode: initialMode(),
  state: loaded.state,
  // Cloud mode
  user: null,
  access: "checking", // "checking" | "signed-out" | "denied" | "unverifiable" | "no-cloud" | "allowed"
  authError: null,
  role: null, // "admin" | "member"
  cloudLoaded: false,
  syncError: null,
  members: [], // admin: the invite list
  meta: storage.loadMeta(),
  loadProblem: loaded.problem,
  storageOk: storage.storageAvailable(),
  persisted: null,
  // Log form
  logPersonId: null,
  logDate: null, // null = today
  weightDraft: "",
  message: null, // { text, undo? }
  // Chart
  crosshairDay: null,
};
app.tab = app.meta.ui.tab ?? (app.state.people.length ? "log" : "people");
app.range = app.meta.ui.range ?? "all";
app.slots = Array.isArray(app.meta.ui.slots) && app.meta.ui.slots.length === MAX_CHART_PEOPLE
  ? app.meta.ui.slots
  : defaultSlots();
// Until someone picks people on the chart, it shows the first few with data.
app.slotsChosen = app.meta.ui.slotsChosen === true;

function initialMode() {
  if (!cloudAvailable) return "local";
  const m = storage.loadMode();
  if (m === "local" || m === "cloud") return m;
  // People who used the app before sign-in existed carry on as they were.
  return loaded.state.people.length ? "local" : null;
}

function defaultSlots() {
  const withData = app.state.people
    .filter((p) => app.state.entries.some((e) => e.personId === p.id))
    .slice(0, MAX_CHART_PEOPLE)
    .map((p) => p.id);
  return [...withData, ...Array(MAX_CHART_PEOPLE - withData.length).fill(null)];
}

/** Applies a data change, saves it, and redraws. */
function commit(mutate) {
  if (app.mode === "cloud") return commitCloud(mutate);
  mutate(app.state);
  app.storageOk = storage.saveState(app.state);
  app.meta.changesSinceExport = (app.meta.changesSinceExport ?? 0) + 1;
  saveMeta();
  render();
}

/**
 * Cloud: apply the change on screen straight away, then write just the documents
 * that changed. Writes made offline are queued and sent later by Firestore.
 */
function commitCloud(mutate) {
  const before = S.cloneState(app.state);
  app.state.nextId = S.randomId(); // ids made on different devices mustn't collide
  mutate(app.state);
  const ops = S.diffState(before, app.state);
  if (ops.length) {
    cloud.applyChanges(app.user.uid, ops).catch((e) => {
      console.error(e);
      app.syncError = `Couldn't save a change: ${e.code === "permission-denied" ? "not allowed" : e.message}`;
      render();
    });
  }
  render();
}

function saveMeta() {
  app.meta.ui = { tab: app.tab, range: app.range, slots: app.slots, slotsChosen: app.slotsChosen };
  storage.saveMeta(app.meta);
}

// ---------------------------------------------------------------- formatting

const kgFormat = new Intl.NumberFormat(undefined, { minimumFractionDigits: 1, maximumFractionDigits: 1 });
const fmtKg = (kg) => `${kgFormat.format(kg)} kg`;
const dateFmt = (opts) => new Intl.DateTimeFormat(undefined, { timeZone: "UTC", ...opts });
const longDate = dateFmt({ day: "numeric", month: "short", year: "numeric" });
const shortDate = dateFmt({ day: "numeric", month: "short" });
const monthYear = dateFmt({ month: "short", year: "2-digit" });
const fromISO = (iso) => new Date(S.dayNumber(iso) * 86_400_000);
const fmtDate = (iso) => longDate.format(fromISO(iso));
const personName = (id) => app.state.people.find((p) => p.id === id)?.name ?? "?";
const plural = (n, one, many = one + "s") => `${n} ${n === 1 ? one : many}`;

// ---------------------------------------------------------------- DOM helpers

function h(tag, props, ...kids) {
  const el = document.createElement(tag);
  setProps(el, props);
  el.append(...kids.flat(Infinity).filter((k) => k != null && k !== false));
  return el;
}

const SVG_NS = "http://www.w3.org/2000/svg";
function s(tag, props, ...kids) {
  const el = document.createElementNS(SVG_NS, tag);
  setProps(el, props);
  el.append(...kids.flat(Infinity).filter((k) => k != null && k !== false));
  return el;
}

function setProps(el, props = {}) {
  for (const [k, v] of Object.entries(props ?? {})) {
    if (v == null || v === false) continue;
    if (k.startsWith("on")) el.addEventListener(k.slice(2), v);
    else if (k === "value") el.value = v;
    else el.setAttribute(k, v === true ? "" : v);
  }
}

// ---------------------------------------------------------------- dialog

const dialog = document.getElementById("dialog");
let dialogOk = null;
document.getElementById("dialog-cancel").addEventListener("click", () => dialog.close());
document.getElementById("dialog-form").addEventListener("submit", (e) => {
  const error = dialogOk?.();
  if (error) {
    e.preventDefault();
    const p = document.getElementById("dialog-error");
    p.textContent = error;
    p.hidden = false;
  }
});

/** onOk returns an error string to keep the dialog open, or nothing to close it. */
function openDialog({ title, body, okLabel = "OK", danger = false, onOk }) {
  document.getElementById("dialog-title").textContent = title;
  document.getElementById("dialog-body").replaceChildren(...[body].flat());
  document.getElementById("dialog-error").hidden = true;
  const ok = document.getElementById("dialog-ok");
  ok.textContent = okLabel;
  ok.className = danger ? "btn btn-danger" : "btn";
  dialogOk = onOk;
  dialog.showModal();
  dialog.querySelector("#dialog-body input")?.select();
}

// ---------------------------------------------------------------- export / import

function exportData() {
  const json = JSON.stringify(S.toExport(app.state), null, 2);
  const url = URL.createObjectURL(new Blob([json], { type: "application/json" }));
  const a = h("a", { href: url, download: `weigh-in-${S.todayISO()}.json` });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  app.meta.lastExportAt = new Date().toISOString();
  app.meta.changesSinceExport = 0;
  saveMeta();
  render();
}

async function importFile(file) {
  let incoming;
  try {
    incoming = S.parseState(await file.text());
  } catch (e) {
    openDialog({ title: "Can't import that file", body: h("p", {}, e.message), okLabel: "OK", onOk: () => {} });
    document.getElementById("dialog-cancel").hidden = true;
    dialog.addEventListener("close", () => (document.getElementById("dialog-cancel").hidden = false), { once: true });
    return;
  }
  confirmReplace(incoming, { title: "Import this file?", source: "The file has" });
}

/** Asks, then replaces the current data (this browser's, or the account's) with `incoming`. */
function confirmReplace(incoming, { title, source }) {
  const cur = app.state;
  const hasData = cur.people.length > 0;
  const where = app.mode === "cloud" ? "your account" : "this browser";
  openDialog({
    title,
    body: [
      h("p", {}, `${source} ${plural(incoming.people.length, "person", "people")} and ${plural(incoming.entries.length, "entry", "entries")}.`),
      hasData && h("p", {}, `It will replace what's in ${where} now (${plural(cur.people.length, "person", "people")}, ${plural(cur.entries.length, "entry", "entries")}). Export first if you want to keep a copy.`),
    ],
    okLabel: hasData ? "Replace" : "Import",
    danger: hasData,
    onOk: () => {
      commit((st) => Object.assign(st, incoming));
      app.meta.changesSinceExport = 0;
      app.slots = defaultSlots();
      app.slotsChosen = false;
      app.logPersonId = null;
      app.message = { text: "Import complete." };
      saveMeta();
      render();
    },
  });
}

// ---------------------------------------------------------------- views

const view = document.getElementById("view");

const isAdmin = () => app.mode === "cloud" && app.role === "admin";

function render() {
  const tabs = document.querySelector(".tabs");
  const headerExport = document.getElementById("header-export");
  if (app.mode == null || (app.mode === "cloud" && app.access !== "allowed")) {
    tabs.hidden = true;
    headerExport.hidden = true;
    document.getElementById("banner").hidden = true;
    view.replaceChildren(viewGate());
    return;
  }
  tabs.hidden = false;
  tabs.querySelector('[data-tab="admin"]').hidden = !isAdmin();
  if (app.tab === "admin" && !isAdmin()) app.tab = "log";
  renderBanner();
  for (const b of document.querySelectorAll(".tabs button")) {
    b.toggleAttribute("aria-current", false);
    if (b.dataset.tab === app.tab) b.setAttribute("aria-current", "page");
  }
  if (app.mode === "cloud" && !app.cloudLoaded) {
    headerExport.hidden = true;
    view.replaceChildren(h("p", { class: "muted", id: "loading" }, "Loading your data…"));
    return;
  }
  headerExport.hidden = app.state.people.length === 0;
  const views = { log: viewLog, chart: viewChart, people: viewPeople, data: viewData, admin: viewAdmin };
  view.replaceChildren(views[app.tab]());
  if (app.tab === "chart") mountChart();
}

function renderBanner() {
  const banner = document.getElementById("banner");
  const exportBtn = h("button", { type: "button", class: "btn btn-small", onclick: exportData }, "Export now");
  const m = app.meta;
  let content = null;
  if (app.mode === "cloud") {
    // Data is in the account, so the browser-storage warnings and backup nags don't apply.
    content = app.syncError && [h("span", {}, app.syncError),
      h("button", { type: "button", class: "btn btn-small btn-quiet", onclick: () => { app.syncError = null; render(); } }, "Dismiss")];
  } else if (!app.storageOk) {
    content = [h("span", {}, "This browser isn't saving your data (storage is blocked or full). Export to keep it."), app.state.people.length && exportBtn];
  } else if (app.loadProblem) {
    content = [h("span", {}, app.loadProblem), h("button", { type: "button", class: "btn btn-small btn-quiet", onclick: () => { app.loadProblem = null; render(); } }, "Dismiss")];
  } else if (m.changesSinceExport > 0 && app.state.entries.length > 0) {
    const days = m.lastExportAt ? (Date.now() - Date.parse(m.lastExportAt)) / 86_400_000 : Infinity;
    const due = m.lastExportAt ? days >= 14 || m.changesSinceExport >= 20 : app.state.entries.length >= 5;
    if (due) {
      const when = m.lastExportAt ? `since your last backup on ${longDate.format(new Date(m.lastExportAt))}` : "and you haven't backed up yet";
      content = [h("span", {}, `${plural(m.changesSinceExport, "change")} ${when}. Browser storage can be cleared, so keep a copy.`), exportBtn];
    }
  }
  banner.hidden = !content;
  banner.replaceChildren(...(content ?? []).filter(Boolean));
}

// ---- Log

function viewLog() {
  const st = app.state;
  if (!st.people.length) {
    return h("section", {},
      h("h2", {}, "Log weight"),
      h("p", {}, "Add someone before logging a weight."),
      h("button", { type: "button", class: "btn", onclick: () => go("people") }, "Add people"));
  }
  if (!st.people.some((p) => p.id === app.logPersonId)) app.logPersonId = st.people[0].id;
  const today = S.todayISO();
  const date = app.logDate ?? today;
  const history = S.entriesFor(st, app.logPersonId).reverse();

  const weight = h("input", {
    id: "weight", name: "weight", inputmode: "decimal", autocomplete: "off", placeholder: "e.g. 72.5",
    value: app.weightDraft, "aria-describedby": "weight-error",
    oninput: (e) => { app.weightDraft = e.target.value; app.message = null; validate(); },
  });
  const weightError = h("p", { id: "weight-error", class: "field-error", hidden: true }, `Enter a weight between 0 and ${S.MAX_KG} kg`);
  const dateInput = h("input", {
    type: "date", id: "date", name: "date", max: today, value: date, required: true,
    onchange: (e) => { app.logDate = e.target.value && e.target.value !== today ? e.target.value : null; app.message = null; render(); },
  });
  const save = h("button", { type: "submit", class: "btn btn-block", id: "save" }, "Save");

  function validate() {
    const kg = S.parseKg(app.weightDraft);
    const bad = app.weightDraft.trim() !== "" && kg == null;
    weight.setAttribute("aria-invalid", bad);
    weightError.hidden = !bad;
    const dateOk = S.isValidISODate(dateInput.value) && dateInput.value <= today;
    save.disabled = kg == null || !dateOk;
  }

  const form = h("form", {
    novalidate: true,
    onsubmit: (e) => {
      e.preventDefault();
      const kg = S.parseKg(app.weightDraft);
      const d = dateInput.value;
      if (kg == null || !S.isValidISODate(d) || d > today) return;
      app.weightDraft = "";
      app.logDate = null;
      app.message = { text: `Saved ${fmtKg(kg)} for ${personName(app.logPersonId)} on ${fmtDate(d)}.` };
      commit((st) => S.logWeight(st, app.logPersonId, d, Math.round(kg * 100) / 100));
      document.getElementById("weight")?.focus();
    },
  },
    h("div", { class: "field" }, h("label", { for: "weight" }, "Weight (kg)"), weight, weightError),
    h("div", { class: "field" },
      h("label", { for: "date" }, "Date"),
      h("div", { class: "row" },
        h("div", { class: "grow" }, dateInput),
        date !== today && h("button", { type: "button", class: "btn btn-quiet", onclick: () => { app.logDate = null; render(); } }, "Today")),
      date === today && h("p", { class: "muted small", style: "margin:6px 0 0" }, "Today")),
    save);
  validate();

  return h("section", {},
    h("h2", {}, "Log weight"),
    h("div", { class: "chips", role: "group", "aria-label": "Person" },
      st.people.map((p) => h("button", {
        type: "button", class: "chip", "aria-pressed": String(p.id === app.logPersonId), "data-person": p.name,
        onclick: () => { app.logPersonId = p.id; app.message = null; render(); },
      }, p.name))),
    form,
    app.message && h("p", { class: "success", role: "status", id: "message", style: "margin-top:12px" },
      app.message.text, " ",
      app.message.undo && h("button", { type: "button", class: "btn btn-small btn-quiet", onclick: app.message.undo }, "Undo")),
    h("h3", {}, `History for ${personName(app.logPersonId)}`),
    history.length
      ? [h("p", { class: "muted small" }, "Select an entry to edit it."),
         h("ul", { class: "list", id: "history" }, history.map((e) => h("li", { "data-date": e.date },
           h("div", { class: "main" },
             h("button", {
               type: "button",
               onclick: () => { app.weightDraft = String(e.kg); app.logDate = e.date === today ? null : e.date; app.message = null; render(); document.getElementById("weight")?.focus(); },
             }, h("div", { class: "primary" }, fmtKg(e.kg)), h("div", { class: "secondary" }, fmtDate(e.date)))),
           h("button", {
             type: "button", class: "icon-btn", "aria-label": `Delete entry for ${fmtDate(e.date)}`,
             onclick: () => {
               const removed = { ...e };
               app.message = {
                 text: `Deleted ${fmtKg(e.kg)} on ${fmtDate(e.date)}.`,
                 undo: () => { app.message = null; commit((st) => st.entries.push(removed)); },
               };
               commit((st) => S.deleteEntry(st, e.id));
             },
           }, "Delete"))))]
      : h("p", { class: "muted" }, "No entries yet."));
}

// ---- People

function viewPeople() {
  const st = app.state;
  const input = h("input", { id: "new-person", name: "name", autocomplete: "off", maxlength: 40, "aria-describedby": "person-error" });
  const error = h("p", { id: "person-error", class: "field-error", hidden: true });
  input.addEventListener("input", () => { error.hidden = true; input.removeAttribute("aria-invalid"); });

  const form = h("form", {
    novalidate: true,
    onsubmit: (e) => {
      e.preventDefault();
      const msg = S.nameError(st, input.value);
      if (msg) {
        error.textContent = msg;
        error.hidden = false;
        input.setAttribute("aria-invalid", "true");
        input.focus();
        return;
      }
      commit((st) => S.addPerson(st, input.value));
      document.getElementById("new-person")?.focus();
    },
  },
    h("label", { for: "new-person" }, "Add a person"),
    h("div", { class: "row" }, h("div", { class: "grow" }, input), h("button", { type: "submit", class: "btn", id: "add-person" }, "Add")),
    error);

  return h("section", {},
    h("h2", {}, "People"),
    form,
    st.people.length > 0 && h("h3", {}, "Tracking"),
    st.people.length
      ? h("ul", { class: "list" }, st.people.map((p) => {
          const n = st.entries.filter((e) => e.personId === p.id).length;
          return h("li", {},
            h("div", { class: "main" }, h("div", { class: "primary" }, p.name), h("div", { class: "secondary" }, plural(n, "entry", "entries"))),
            h("button", { type: "button", class: "icon-btn", "aria-label": `Rename ${p.name}`, onclick: () => renameDialog(p) }, "Rename"),
            h("button", { type: "button", class: "icon-btn", "aria-label": `Delete ${p.name}`, onclick: () => deleteDialog(p, n) }, "Delete"));
        }))
      : h("p", { class: "muted" }, "Add the people whose weight you want to track."));
}

function renameDialog(p) {
  const input = h("input", { value: p.name, maxlength: 40, "aria-label": "New name" });
  openDialog({
    title: `Rename ${p.name}`,
    body: input,
    okLabel: "Save",
    onOk: () => {
      const msg = S.nameError(app.state, input.value, p.id);
      if (msg) return msg;
      commit((st) => S.renamePerson(st, p.id, input.value));
    },
  });
}

function deleteDialog(p, n) {
  openDialog({
    title: `Delete ${p.name}?`,
    body: h("p", {}, n ? `This also deletes their ${plural(n, "entry", "entries")}. It can't be undone unless you have an export.` : "They have no entries."),
    okLabel: "Delete",
    danger: true,
    onOk: () => commit((st) => S.deletePerson(st, p.id)),
  });
}

// ---- Data

function viewData() {
  const st = app.state;
  const m = app.meta;
  const cloudMode = app.mode === "cloud";
  const where = cloudMode ? "your account" : "this browser";
  const fileInput = h("input", {
    type: "file", accept: ".json,application/json", id: "import-file", class: "visually-hidden",
    onchange: (e) => { const f = e.target.files[0]; e.target.value = ""; if (f) importFile(f); },
  });
  const local = cloudMode ? storage.loadState().state : null; // this browser's own data, if any
  return h("section", {},
    h("h2", {}, "Your data"),
    cloudMode
      ? h("div", { class: "card", id: "account" },
          h("p", {}, "Signed in as ", h("strong", {}, app.user.email), "."),
          h("p", {}, "Your data is stored in your own private space online. Only you can see it, and it's the same on every device you sign in on."),
          h("p", { class: "muted small" }, `${plural(st.people.length, "person", "people")}, ${plural(st.entries.length, "entry", "entries")}.`),
          h("button", { type: "button", class: "btn btn-quiet", id: "sign-out", onclick: signOut }, "Sign out"))
      : h("div", { class: "card" },
          h("p", {}, "Everything is stored in this browser on this device only. Nothing is sent anywhere."),
          h("p", { class: "muted small", id: "storage-status" },
            app.storageOk ? "✓ Saving automatically in browser storage." : "✗ Browser storage isn't available. Export to keep your data.",
            app.persisted === true ? " The browser has agreed not to clear it automatically." : "",
            app.persisted === false ? " The browser may clear it if space runs low or site data is cleared." : ""),
          h("p", { class: "muted small", style: "margin:0" }, `${plural(st.people.length, "person", "people")}, ${plural(st.entries.length, "entry", "entries")}.`)),
    !cloudMode && cloudAvailable && [
      h("h3", {}, "Sign in"),
      h("p", {}, "Been invited? Sign in with Google to keep your data in your own private account and use it on any device. Your data in this browser stays here, and you can copy it in after signing in."),
      h("button", { type: "button", class: "btn", id: "go-sign-in", onclick: chooseCloud }, "Sign in…")],
    cloudMode && local.people.length > 0 && [
      h("h3", {}, "Data saved in this browser"),
      h("p", {}, `This browser also has data from using Weigh In without signing in (${plural(local.people.length, "person", "people")}, ${plural(local.entries.length, "entry", "entries")}).`),
      h("button", {
        type: "button", class: "btn btn-quiet", id: "copy-local",
        onclick: () => confirmReplace(storage.loadState().state, { title: "Copy into your account?", source: "This browser has" }),
      }, "Copy it into my account")],
    h("h3", {}, "Back up"),
    h("p", {}, "Download everything as a JSON file. Keep it somewhere safe, or use it to move to another browser or device."),
    h("p", { class: "muted small" }, m.lastExportAt
      ? `Last export: ${longDate.format(new Date(m.lastExportAt))}${m.changesSinceExport && !cloudMode ? ` (${plural(m.changesSinceExport, "change")} since)` : cloudMode ? "" : " (up to date)"}.`
      : "Not exported yet."),
    h("button", { type: "button", class: "btn", id: "export", onclick: exportData, disabled: st.people.length === 0 }, "Export JSON"),
    h("h3", {}, "Restore"),
    h("p", {}, `Load a JSON file you exported earlier. It replaces the data in ${where}.`),
    fileInput,
    h("label", { for: "import-file", class: "btn btn-quiet", style: "display:inline-flex;align-items:center;margin:0" }, "Import JSON…"),
    st.people.length > 0 && [
      h("h3", {}, "Start over"),
      h("button", {
        type: "button", class: "btn btn-danger", id: "delete-all",
        onclick: () => openDialog({
          title: "Delete all data?",
          body: h("p", {}, `This removes every person and entry from ${where}. Export first if you might want it back.`),
          okLabel: "Delete everything", danger: true,
          onOk: () => { commit((st) => Object.assign(st, S.emptyState())); app.slots = defaultSlots(); app.slotsChosen = false; saveMeta(); },
        }),
      }, "Delete all data")]);
}

// ---- Admin (cloud, admin only): who's invited

function viewAdmin() {
  const email = h("input", { id: "member-email", type: "email", autocomplete: "off", maxlength: 254, placeholder: "name@gmail.com", "aria-label": "Google email address" });
  const name = h("input", { id: "member-name", autocomplete: "off", maxlength: 60, placeholder: "Name (optional)", "aria-label": "Name" });
  const err = h("p", { class: "field-error", hidden: true, id: "member-error" });
  const form = h("form", {
    novalidate: true,
    onsubmit: async (e) => {
      e.preventDefault();
      const address = email.value.trim().toLowerCase();
      const problem = !S.validEmail(address) ? "Enter their Google (Gmail) address"
        : app.members.some((p) => p.email === address) ? "That address is already invited" : null;
      if (problem) { err.textContent = problem; err.hidden = false; email.focus(); return; }
      err.hidden = true;
      try {
        await cloud.addMember(address, name.value, app.user.email);
        email.value = "";
        name.value = "";
      } catch (x) {
        err.textContent = `Couldn't invite ${address}: ${x.code === "permission-denied" ? "not allowed" : x.message}`;
        err.hidden = false;
      }
    },
  },
    h("label", { for: "member-email" }, "Invite someone"),
    h("div", { class: "field" }, email),
    h("div", { class: "field" }, name),
    h("button", { type: "submit", class: "btn btn-block", id: "member-add" }, "Invite"),
    err);
  const members = [...app.members].sort((a, b) => (a.role === "admin" ? -1 : b.role === "admin" ? 1 : a.email.localeCompare(b.email)));
  return h("section", { id: "admin" },
    h("h2", {}, "Who can sign in"),
    h("p", { class: "muted small" }, "Invited people sign in with that Google account and get their own private data. You can't see their data, and they can't see each other's."),
    h("div", { class: "card" }, form),
    h("ul", { class: "list", id: "members" }, members.map((p) => h("li", { "data-email": p.email },
      h("div", { class: "main" },
        h("div", { class: "primary" }, p.name || p.email, p.role === "admin" && " (admin)"),
        p.name && h("div", { class: "secondary" }, p.email)),
      p.role !== "admin" && h("button", {
        type: "button", class: "icon-btn", "aria-label": `Remove ${p.email}`,
        onclick: () => openDialog({
          title: `Remove ${p.name || p.email}?`,
          body: h("p", {}, "They won't be able to sign in any more. Their data is kept but nobody can see it. Invite them again to give it back."),
          okLabel: "Remove", danger: true,
          onOk: () => { cloud.removeMember(p.email).catch((x) => { app.syncError = `Couldn't remove: ${x.message}`; render(); }); },
        }),
      }, "Remove")))),
    h("p", { class: "muted small" }, "The admin's own invite is managed in the Firebase console."));
}

// ---- Start screen (sign in, or use without an account)

function viewGate() {
  const signInBtn = h("button", {
    type: "button", class: "btn btn-block", id: "sign-in",
    onclick: async () => {
      app.authError = null;
      try {
        await ensureCloud();
        await cloud.signIn();
      } catch (e) {
        app.authError = e?.message ?? String(e);
        render();
      }
    },
  }, "Sign in with Google");
  const localBtn = h("button", { type: "button", class: "btn btn-quiet btn-block", id: "use-local", onclick: chooseLocal }, "Use without signing in");
  const localNote = h("p", { class: "muted small" }, "Without signing in, your data is kept in this browser on this device only.");
  const choose = [
    h("p", {}, "Track weight for several people and chart it over time."),
    h("p", { class: "muted" }, "Sign in with the Google account you were invited with. Your data is private to you and available on all your devices."),
    signInBtn, localBtn, localNote,
  ];
  const access = app.mode == null ? "choose" : app.access;
  const screens = {
    choose,
    "signed-out": choose,
    checking: [h("p", { class: "muted" }, "Checking your account…")],
    denied: [
      h("p", {}, h("strong", {}, app.user?.email), " hasn't been invited."),
      h("p", { class: "muted" }, "Ask the admin to invite this Google account, or sign in with a different one."),
      h("button", { type: "button", class: "btn btn-block", onclick: signOut }, "Use a different account"),
      localBtn, localNote,
    ],
    unverifiable: [
      h("p", {}, "Can't check your account while offline."),
      h("button", { type: "button", class: "btn btn-block", onclick: () => location.reload() }, "Try again"),
      localBtn,
    ],
    "no-cloud": [
      h("p", {}, "Can't reach Google right now. Check your connection and try again."),
      h("button", { type: "button", class: "btn btn-block", onclick: () => location.reload() }, "Try again"),
      localBtn, localNote,
    ],
  };
  return h("section", { class: "gate", id: "gate", "data-access": access },
    screens[access] ?? screens.checking,
    app.authError && h("p", { class: "field-error", role: "alert" }, app.authError));
}

// ---- Chart

const RANGES = [
  { id: "1m", label: "1M", days: 30 },
  { id: "3m", label: "3M", days: 90 },
  { id: "1y", label: "1Y", days: 365 },
  { id: "all", label: "All", days: null },
];

function liveSlots() {
  const ids = new Set(app.state.people.map((p) => p.id));
  return app.slots.map((id) => (ids.has(id) ? id : null));
}

function chartData() {
  const slots = liveSlots();
  const range = RANGES.find((r) => r.id === app.range) ?? RANGES[3];
  const today = S.dayNumber(S.todayISO());
  const firstDay = range.days == null ? null : today - range.days;
  const series = slots.flatMap((id, slot) => {
    if (id == null) return [];
    const all = S.entriesFor(app.state, id).map((e) => ({ ...e, day: S.dayNumber(e.date) }));
    return [{ id, slot, name: personName(id), all, shown: all.filter((p) => firstDay == null || p.day >= firstDay) }];
  });
  return { slots, firstDay, today, series };
}

function viewChart() {
  const st = app.state;
  if (!st.people.length) {
    return h("section", {}, h("h2", {}, "Weight over time"), h("p", {}, "Add people on the People tab, then log some weights."));
  }
  if (!app.slotsChosen) app.slots = defaultSlots();
  const { slots, series } = chartData();
  const full = !slots.includes(null);
  const anyShown = series.some((s) => s.shown.length);

  return h("section", {},
    h("h2", {}, "Weight over time"),
    h("div", { class: "chips", role: "group", "aria-label": `People to show (up to ${MAX_CHART_PEOPLE})` },
      st.people.map((p) => {
        const slot = slots.indexOf(p.id);
        const on = slot >= 0;
        return h("button", {
          type: "button", class: "chip", "aria-pressed": String(on), disabled: !on && full, "data-person": p.name,
          onclick: () => { app.slots = toggleSlot(slots, p.id); app.slotsChosen = true; saveMeta(); render(); },
        }, on && h("span", { class: `dot b${slot}`, "aria-hidden": "true" }), p.name);
      })),
    h("p", { class: "muted small", id: "chart-hint" }, full
      ? `Showing ${MAX_CHART_PEOPLE} people (the maximum). Deselect someone to swap.`
      : `Pick up to ${MAX_CHART_PEOPLE} people to compare.`),
    h("div", { class: "segmented", role: "group", "aria-label": "Time range" },
      RANGES.map((r) => h("button", {
        type: "button", "aria-pressed": String(app.range === r.id), "data-range": r.id,
        onclick: () => { app.range = r.id; saveMeta(); render(); },
      }, r.label))),
    !series.length
      ? h("div", { class: "chart-empty" }, "Pick someone above to see their chart.")
      : !anyShown
        ? h("div", { class: "chart-empty" }, "No entries in this time range.")
        : [h("div", { class: "readout", id: "readout", "aria-live": "polite" }), h("div", { class: "chart-wrap", id: "chart" })],
    anyShown && h("details", {},
      h("summary", {}, "Show data as a table"),
      h("table", {},
        h("thead", {}, h("tr", {}, h("th", {}, "Date"), series.map((s) => h("th", { class: "num" }, s.name)))),
        h("tbody", {}, [...new Set(series.flatMap((s) => s.shown.map((p) => p.date)))].sort().reverse().map((d) =>
          h("tr", {}, h("td", {}, fmtDate(d)), series.map((s) => {
            const e = s.shown.find((p) => p.date === d);
            return h("td", { class: "num" }, e ? fmtKg(e.kg) : "—");
          })))))));
}

let chartObserver = null;
function mountChart() {
  chartObserver?.disconnect();
  const wrap = document.getElementById("chart");
  if (!wrap) return;
  let lastWidth = 0;
  chartObserver = new ResizeObserver(() => {
    if (wrap.clientWidth !== lastWidth) {
      lastWidth = wrap.clientWidth;
      drawChart();
    }
  });
  chartObserver.observe(wrap);
  drawChart();
}

function drawChart() {
  const wrap = document.getElementById("chart");
  const readout = document.getElementById("readout");
  if (!wrap || !readout) return;
  const { firstDay, today, series } = chartData();
  const shownPts = series.flatMap((s) => s.shown);
  if (!shownPts.length) return;

  // Domain: the chosen window, or the data's own extent for "All".
  let d0 = firstDay ?? Math.min(...shownPts.map((p) => p.day));
  let d1 = firstDay != null ? today : Math.max(...shownPts.map((p) => p.day));
  if (d0 === d1) { d0 -= 3; d1 += 3; }
  const yTicks = niceTicks(Math.min(...shownPts.map((p) => p.kg)), Math.max(...shownPts.map((p) => p.kg)));
  const y0 = yTicks[0];
  const y1 = yTicks[yTicks.length - 1];
  const yDecimals = yTicks.length > 1 && yTicks[1] - yTicks[0] < 1 ? 1 : 0;

  const W = wrap.clientWidth;
  const H = 300;
  const pad = { l: 40, r: Math.min(96, W * 0.24), t: 12, b: 28 };
  const plotW = Math.max(1, W - pad.l - pad.r);
  const plotH = H - pad.t - pad.b;
  const plotR = pad.l + plotW;
  const plotB = pad.t + plotH;
  const x = (day) => pad.l + ((day - d0) / (d1 - d0)) * plotW;
  const y = (kg) => pad.t + plotH - ((kg - y0) / (y1 - y0)) * plotH;

  // Crosshair snaps to the nearest day that has a visible entry.
  const days = [...new Set(shownPts.map((p) => p.day))].sort((a, b) => a - b);
  const sel = days.includes(app.crosshairDay) ? app.crosshairDay : null;
  const nearest = series.map((s) => (sel == null ? null : nearestBy(s.shown, (p) => p.day, sel)));

  // Readout: the touch-friendly stand-in for a hover tooltip.
  readout.replaceChildren(...[sel == null
    ? h("p", { class: "muted small" }, "Tap, drag or hover on the chart to see values. Arrow keys work too.")
    : [h("div", { class: "date" }, longDate.format(new Date(sel * 86_400_000))),
       h("div", { class: "values" }, series.map((s, i) => nearest[i] && h("span", {},
         h("span", { class: `dot b${s.slot}`, "aria-hidden": "true" }),
         `${s.name}: ${fmtKg(nearest[i].kg)}${nearest[i].day !== sel ? ` (${shortDate.format(new Date(nearest[i].day * 86_400_000))})` : ""}`)))]].flat());

  const span = d1 - d0;
  const xFmt = span > 365 ? monthYear : shortDate;
  const xTicks = [...new Set([0, 1, 2, 3].map((i) => Math.round(d0 + (span * i) / 3)))];
  const clipId = "plot-clip";
  const description = series.map((s) => s.shown.length
    ? `${s.name}: ${plural(s.shown.length, "entry", "entries")}, latest ${fmtKg(s.shown.at(-1).kg)} on ${fmtDate(s.shown.at(-1).date)}`
    : `${s.name}: no entries in range`).join(". ");

  // Direct labels at each line's latest visible value, nudged apart.
  const labelled = series.filter((s) => s.shown.length);
  const labelYs = spreadLabels(labelled.map((s) => y(s.shown.at(-1).kg)), 16, pad.t, plotB);
  const maxChars = Math.max(3, Math.floor((pad.r - 26) / 7));
  const short = (n) => (n.length > maxChars ? n.slice(0, maxChars - 1) + "…" : n);

  const svg = s("svg", {
    viewBox: `0 0 ${W} ${H}`, role: "img", tabindex: 0, id: "chart-svg",
    "aria-label": `Weight chart. ${description}.`,
  },
    s("defs", {}, s("clipPath", { id: clipId }, s("rect", { x: pad.l, y: pad.t - 3, width: plotW, height: plotH + 6 }))),
    yTicks.map((v) => [
      s("line", { class: "grid-line", x1: pad.l, x2: plotR, y1: y(v), y2: y(v) }),
      s("text", { class: "axis-text", x: pad.l - 6, y: y(v), "text-anchor": "end", "dominant-baseline": "middle" }, v.toFixed(yDecimals)),
    ]),
    xTicks.map((d, i) => s("text", {
      class: "axis-text", x: x(d), y: plotB + 18,
      "text-anchor": i === 0 ? "start" : i === xTicks.length - 1 ? "end" : "middle",
    }, xFmt.format(new Date(d * 86_400_000)))),
    sel != null && s("line", { class: "crosshair", x1: x(sel), x2: x(sel), y1: pad.t, y2: plotB }),
    // Lines use every point and are clipped, so they enter from the edge in short ranges.
    s("g", { "clip-path": `url(#${clipId})` }, series.map((sr) => sr.all.length > 1 && s("path", {
      class: `series-line s${sr.slot}`,
      d: sr.all.map((p, i) => `${i ? "L" : "M"}${x(p.day).toFixed(1)},${y(p.kg).toFixed(1)}`).join(""),
    }))),
    series.map((sr, i) => {
      const dense = sr.shown.length > 12;
      return sr.shown.map((p) => {
        const hl = p === nearest[i];
        if (sr.shown.length > 60 && !hl) return null;
        const r = hl ? 5 : dense ? 2.5 : 4;
        return s("circle", { class: `marker f${sr.slot}`, cx: x(p.day), cy: y(p.kg), r, "stroke-width": hl || !dense ? 2 : 1 });
      });
    }),
    labelled.map((sr, k) => [
      s("line", { class: `series-line s${sr.slot}`, x1: plotR + 8, x2: plotR + 18, y1: labelYs[k], y2: labelYs[k] }),
      s("text", { class: "label-text", x: plotR + 22, y: labelYs[k], "dominant-baseline": "middle" }, short(sr.name)),
    ]));

  const pick = (clientX) => {
    const rect = svg.getBoundingClientRect();
    const day = d0 + ((clientX - rect.left - pad.l) / plotW) * (d1 - d0);
    const best = nearestBy(days, (d) => d, day);
    if (best !== app.crosshairDay) {
      app.crosshairDay = best;
      drawChart();
    }
  };
  svg.addEventListener("pointerdown", (e) => pick(e.clientX));
  svg.addEventListener("focus", () => svg.classList.toggle("kbd", lastInput === "key"));
  svg.addEventListener("pointermove", (e) => { if (e.pointerType === "mouse" || e.buttons) pick(e.clientX); });
  svg.addEventListener("keydown", (e) => {
    if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
    e.preventDefault();
    const i = sel == null ? days.length : days.indexOf(sel);
    const next = e.key === "ArrowLeft" ? Math.max(0, i - 1) : Math.min(days.length - 1, i + 1);
    app.crosshairDay = days[next];
    drawChart();
    const fresh = document.getElementById("chart-svg");
    fresh?.classList.add("kbd");
    fresh?.focus();
  });
  wrap.replaceChildren(svg);
}

// ---------------------------------------------------------------- wiring

let lastInput = "pointer";
window.addEventListener("keydown", () => (lastInput = "key"), true);
window.addEventListener("pointerdown", () => (lastInput = "pointer"), true);

function go(tab) {
  app.tab = tab;
  app.message = null;
  saveMeta();
  render();
  view.focus({ preventScroll: true });
  window.scrollTo(0, 0);
}

for (const b of document.querySelectorAll(".tabs button")) b.addEventListener("click", () => go(b.dataset.tab));
document.getElementById("header-export").addEventListener("click", exportData);

// Another tab changed the data: pick it up.
window.addEventListener("storage", (e) => {
  if (app.mode !== "local" || e.key !== storage.STORAGE_KEYS.DATA_KEY) return;
  const fresh = storage.loadState();
  if (!fresh.problem) {
    app.state = fresh.state;
    app.meta = { ...storage.loadMeta(), ui: app.meta.ui };
    render();
  }
});

// ---------------------------------------------------------------- cloud

let cloud = null;
let cloudLoading = null;
let stopWatching = null;
let leaving = false; // signing out: the page is about to reload

/** Loads Firebase (only once someone wants to sign in) and follows the signed-in user. */
function ensureCloud() {
  cloudLoading ??= import("./cloud.js").then((mod) => {
    cloud = mod;
    if (cloud.isEmulator) window.__weighin = { signInAs: cloud.testSignIn };
    cloud.onUser((user) => { if (app.mode !== "local" && !leaving) startAccount(user); });
  }, (e) => {
    console.warn("Firebase unavailable:", e);
    cloudLoading = null;
    app.access = "no-cloud";
    render();
    throw e;
  });
  return cloudLoading;
}

function stopAccount() {
  stopWatching?.();
  stopWatching = null;
}

async function startAccount(user) {
  stopAccount();
  app.user = user;
  app.cloudLoaded = false;
  app.syncError = null;
  document.body.dataset.sync = "";
  if (!user) {
    app.access = "signed-out";
    app.role = null;
    return render();
  }
  if (app.mode !== "cloud") {
    app.mode = "cloud";
    storage.saveMode("cloud");
  }
  app.access = "checking";
  render();
  const access = await cloud.getAccess(user);
  if (app.user !== user) return;
  if (access === null) { app.access = "unverifiable"; return render(); }
  if (access === false) { app.access = "denied"; return render(); }
  app.access = "allowed";
  app.role = access.role;
  app.state = S.emptyState();
  render();

  const lost = (e) => {
    stopAccount();
    if (app.user !== user) return;
    // Removed from the invite list while signed in: the rules start refusing reads.
    if (e?.code === "permission-denied") { app.access = "denied"; return render(); }
    console.error(e);
    app.syncError = `Couldn't load your data: ${e.message}. Reload to try again.`;
    render();
  };
  const subs = [cloud.watchData(user.uid, (docs) => {
    const fresh = S.stateFromDocs(docs.people, docs.entries);
    const same = app.cloudLoaded && JSON.stringify([fresh.people, fresh.entries]) === JSON.stringify([app.state.people, app.state.entries]);
    if (same) return; // our own write coming back: already on screen
    // Chart picks remembered from using the app without signing in don't apply here.
    if (!app.cloudLoaded && !app.slots.some((id) => fresh.people.some((p) => p.id === id))) app.slotsChosen = false;
    app.state = fresh;
    app.cloudLoaded = true;
    document.body.dataset.sync = "ready";
    rerenderKeepingInput();
  }, lost)];
  subs.push(cloud.watchAccess(user, (now) => {
    if (now === false) return lost({ code: "permission-denied" }); // removed by the admin
    if (now.role !== app.role) { stopAccount(); startAccount(user); } // role changed in the console
  }, lost));
  if (app.role === "admin") {
    subs.push(cloud.watchMembers((members) => {
      app.members = members;
      if (app.tab === "admin") rerenderKeepingInput();
    }, (e) => console.error(e)));
  }
  stopWatching = () => subs.forEach((u) => u());
}

/** Redraws after a change from elsewhere (another device), keeping half-typed input and focus. */
function rerenderKeepingInput() {
  const typed = new Map([...view.querySelectorAll("input[id]:not([type=file])")].map((el) => [el.id, el.value]));
  const focused = view.contains(document.activeElement) ? document.activeElement.id : null;
  const tab = app.tab;
  const y = window.scrollY;
  render();
  if (app.tab !== tab) return;
  for (const [id, v] of typed) {
    const el = document.getElementById(id);
    if (el && view.contains(el) && v && !el.value && el.type !== "date") el.value = v;
  }
  if (focused) document.getElementById(focused)?.focus({ preventScroll: true });
  window.scrollTo(0, y);
}

/** Signs out, wipes this browser's offline copy of the account data, and starts afresh. */
async function signOut() {
  leaving = true;
  stopAccount();
  app.access = "checking";
  render();
  try { await cloud?.signOut(); } finally { location.reload(); }
}

/** From the start screen or after being refused: use this browser's storage instead. */
async function chooseLocal() {
  storage.saveMode("local");
  if (app.user) return signOut(); // reloads into local mode
  stopAccount();
  app.mode = "local";
  app.state = storage.loadState().state;
  app.slotsChosen = false;
  app.tab = app.state.people.length ? "log" : "people";
  saveMeta();
  render();
}

/** From local mode: go to the sign-in screen. Local data stays in this browser. */
function chooseCloud() {
  storage.saveMode("cloud");
  app.mode = "cloud";
  app.access = cloud ? "signed-out" : "checking";
  render();
  ensureCloud().catch(() => {});
}

// ---------------------------------------------------------------- start

if (app.mode === "local") {
  storage.requestPersistence().then((ok) => {
    app.persisted = ok;
    if (app.tab === "data" && app.mode === "local") render();
  });
} else {
  // Signing in, or choosing: load Firebase now so the sign-in popup opens straight from the tap.
  ensureCloud().catch(() => {});
}
render();

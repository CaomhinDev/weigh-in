// Sign-in test setup: pages talk to the local Firebase emulators. Each test uses
// fresh accounts, so tests can run in parallel against one emulator.
import { test as base, expect, devices } from "@playwright/test";

const FIRESTORE = "http://127.0.0.1:8096/v1/projects/demo-weighin/databases/(default)/documents";

/** Puts an email on the invite list, as the admin would in the console (bypassing rules). */
export async function allow(email, name, role = "member") {
  const fields = { name: { stringValue: name }, role: { stringValue: role } };
  const res = await fetch(`${FIRESTORE}/allow/${encodeURIComponent(email.toLowerCase())}`, {
    method: "PATCH", headers: { Authorization: "Bearer owner", "Content-Type": "application/json" }, body: JSON.stringify({ fields }),
  });
  if (!res.ok) throw new Error(`seed failed: ${res.status} ${await res.text()}`);
}

let n = 0;
export const freshEmail = (tag) => `${tag}-${Date.now()}-${process.pid}-${n++}@example.com`;

/** A new browser (own storage) with the app open on the start screen. */
export async function openFresh(browser, { setup } = {}) {
  const context = await browser.newContext({ ...devices["Pixel 7"] });
  await context.addInitScript(() => { window.__WEIGHIN_EMULATOR = true; });
  if (setup) await context.addInitScript(setup);
  const page = await context.newPage();
  page.on("pageerror", (e) => { throw e; });
  // The page's Content-Security-Policy must not block anything the app needs.
  page.on("console", (m) => { if (/Content Security Policy/i.test(m.text())) throw new Error(m.text()); });
  await page.goto("./");
  return page;
}

/** Signs in on an open page (the app must have loaded Firebase). */
export async function signIn(page, email, { expectAccess = true } = {}) {
  await page.waitForFunction(() => window.__weighin?.signInAs);
  await page.evaluate((e) => window.__weighin.signInAs(e), email);
  if (expectAccess) await expect(page.locator("body")).toHaveAttribute("data-sync", "ready");
}

/** Opens the app in a new browser, signed in as email. */
export async function openAs(browser, email, options) {
  const page = await openFresh(browser);
  await signIn(page, email, options);
  return page;
}

export const tab = (page, name) => page.getByRole("button", { name, exact: true }).click();

export { base as test, expect };

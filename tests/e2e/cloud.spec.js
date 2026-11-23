// Signing in: invites, private per-user data, and the "without signing in" option.
// Runs against the Firebase emulators (npm run test:e2e).
import { test, expect, allow, freshEmail, openFresh, openAs, signIn, tab } from "./fixtures.js";

async function addPerson(page, name) {
  await tab(page, "People");
  await page.locator("#new-person").fill(name);
  await page.locator("#add-person").click();
  await expect(page.locator(".list li", { hasText: name })).toBeVisible();
}

async function logWeight(page, name, kg) {
  await tab(page, "Log");
  await page.locator(`.chip[data-person="${name}"]`).click();
  await page.locator("#weight").fill(kg);
  await page.locator("#save").click();
}

test("first visit offers both; without signing in, Firebase is never contacted", async ({ browser }) => {
  const page = await openFresh(browser);
  await expect(page.locator("#gate")).toHaveAttribute("data-access", "choose");
  await expect(page.locator("#sign-in")).toBeVisible();
  await expect(page.locator(".tabs")).toBeHidden();
  await page.locator("#use-local").click();
  await expect(page.getByRole("heading", { name: "People" })).toBeVisible();
  await addPerson(page, "Alice");

  // A new tab in the same browser opens straight into local mode and talks to nobody.
  const again = await page.context().newPage();
  const external = [];
  again.on("request", (r) => { if (!r.url().startsWith("http://127.0.0.1:8123/")) external.push(r.url()); });
  await again.goto("./");
  await expect(again.locator(".list li", { hasText: "Alice" })).toBeVisible();
  await tab(again, "Data");
  await expect(again.locator("#go-sign-in")).toBeVisible();
  expect(external).toEqual([]);
});

test("someone who isn't invited can't get in, but can use it without signing in", async ({ browser }) => {
  const email = freshEmail("stranger");
  const page = await openAs(browser, email, { expectAccess: false });
  await expect(page.locator("#gate")).toHaveAttribute("data-access", "denied");
  await expect(page.locator("#gate")).toContainText(`${email} hasn't been invited`);
  await expect(page.locator(".tabs")).toBeHidden();
  await page.locator("#use-local").click(); // signs out and reloads
  await expect(page.getByRole("heading", { name: "People" })).toBeVisible();
  await expect(page.locator("#gate")).toHaveCount(0);
});

test("each invited person has their own private data, synced across their devices", async ({ browser }) => {
  const ann = freshEmail("ann");
  const bob = freshEmail("bob");
  await allow(ann, "Ann");
  await allow(bob, "Bob");

  const phone = await openAs(browser, ann);
  await expect(phone.locator('[data-tab="admin"]')).toBeHidden();
  await addPerson(phone, "Ann");
  await logWeight(phone, "Ann", "70.5");
  await expect(phone.locator("#history li")).toContainText("70.5 kg");

  // Ann's other device has it, and gets new entries live.
  const laptop = await openAs(browser, ann);
  await tab(laptop, "Log");
  await expect(laptop.locator("#history li")).toContainText("70.5 kg");
  await addPerson(phone, "Kid");
  await expect(laptop.locator('.chip[data-person="Kid"]')).toBeVisible();

  // ...and survives a reload (from the server, not the page).
  await laptop.reload();
  await expect(laptop.locator("body")).toHaveAttribute("data-sync", "ready");
  await tab(laptop, "People");
  await expect(laptop.locator(".list li")).toHaveCount(2);

  // Bob sees none of it.
  const bobPage = await openAs(browser, bob);
  await tab(bobPage, "People");
  await expect(bobPage.getByText("Add the people whose weight you want to track.")).toBeVisible();
  await addPerson(bobPage, "Bob");
  await tab(phone, "People");
  await expect(phone.locator(".list li", { hasText: "Bob" })).toHaveCount(0);
});

test("the admin invites and removes people; removing someone locks them out", async ({ browser }) => {
  const boss = freshEmail("boss");
  const carl = freshEmail("carl");
  await allow(boss, "Boss", "admin");
  const admin = await openAs(browser, boss);
  await tab(admin, "Admin");
  await expect(admin.locator(`#members li[data-email="${boss}"]`)).toContainText("(admin)");
  await expect(admin.locator(`#members li[data-email="${boss}"] button`)).toHaveCount(0);

  await admin.locator("#member-email").fill("not an email");
  await admin.locator("#member-add").click();
  await expect(admin.locator("#member-error")).toContainText("Enter their Google");
  await admin.locator("#member-email").fill(carl.toUpperCase());
  await admin.locator("#member-name").fill("Carl");
  await admin.locator("#member-add").click();
  await expect(admin.locator(`#members li[data-email="${carl}"]`)).toContainText("Carl");

  const carlPage = await openAs(browser, carl);
  await addPerson(carlPage, "Carl");

  await admin.getByRole("button", { name: `Remove ${carl}` }).click();
  await admin.locator("#dialog-ok").click();
  await expect(admin.locator(`#members li[data-email="${carl}"]`)).toHaveCount(0);
  await expect(carlPage.locator("#gate")).toHaveAttribute("data-access", "denied");
});

test("data from using it without signing in can be copied into the account; sign-out clears the account", async ({ browser }) => {
  const dee = freshEmail("dee");
  await allow(dee, "Dee");
  const page = await openFresh(browser, {
    setup: () => {
      if (location.protocol !== "http:" || sessionStorage.getItem("seeded")) return;
      sessionStorage.setItem("seeded", "1");
      localStorage.setItem("weighin.data.v1", JSON.stringify({
        nextId: 3, people: [{ id: 1, name: "Dee" }], entries: [{ id: 2, personId: 1, date: "2026-01-02", kg: 64 }],
      }));
    },
  });
  // Has local data, so it opens straight into the app as before.
  await expect(page.locator(".list li", { hasText: "Dee" }).or(page.locator(".chip[data-person=Dee]"))).toBeVisible();
  await tab(page, "Data");
  await page.locator("#go-sign-in").click();
  await expect(page.locator("#gate")).toHaveAttribute("data-access", "signed-out");
  await signIn(page, dee);

  await tab(page, "Data");
  await page.locator("#copy-local").click();
  await expect(page.locator("#dialog")).toContainText("1 person and 1 entry");
  await page.locator("#dialog-ok").click();
  await tab(page, "Log");
  await expect(page.locator("#history li")).toContainText("64.0 kg");

  await tab(page, "Data");
  await page.locator("#sign-out").click();
  await expect(page.locator("#gate")).toHaveAttribute("data-access", "signed-out");
  // The browser's own data is still there for "without signing in".
  await page.locator("#use-local").click();
  await tab(page, "Log");
  await expect(page.locator("#history li")).toContainText("64.0 kg");
});

test("signing in as someone else in the same browser never shows the first account's data", async ({ browser }) => {
  const eve = freshEmail("eve");
  const fay = freshEmail("fay");
  await allow(eve, "Eve");
  await allow(fay, "Fay");
  const page = await openAs(browser, eve);
  await addPerson(page, "Eve");
  await tab(page, "Data");
  await page.locator("#sign-out").click();
  await expect(page.locator("#gate")).toHaveAttribute("data-access", "signed-out");
  await signIn(page, fay);
  await tab(page, "People");
  await expect(page.getByText("Add the people whose weight you want to track.")).toBeVisible();
});

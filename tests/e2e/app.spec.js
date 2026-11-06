import { test, expect } from "@playwright/test";
import fs from "node:fs";

const today = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};
const daysAgo = (n) => {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};

// Fail any test that logs a page error.
test.beforeEach(async ({ page }) => {
  page.on("pageerror", (e) => { throw e; });
  page.on("console", (m) => { if (m.type() === "error") throw new Error(m.text()); });
});

async function addPeople(page, ...names) {
  await page.getByRole("button", { name: "People", exact: true }).click();
  for (const n of names) {
    await page.locator("#new-person").fill(n);
    await page.locator("#add-person").click();
  }
}

async function logWeight(page, name, kg, date) {
  await page.getByRole("button", { name: "Log", exact: true }).click();
  await page.locator(`.chip[data-person="${name}"]`).click();
  await page.locator("#weight").fill(kg);
  if (date) await page.locator("#date").fill(date);
  await page.locator("#save").click();
}

test("first launch opens People and rejects duplicate names", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "People" })).toBeVisible();
  await addPeople(page, "Alice", "alice");
  await expect(page.locator("#person-error")).toHaveText("That name is already used");
  await expect(page.locator(".list li")).toHaveCount(1);
});

test("logs for today by default and survives a reload", async ({ page }) => {
  await page.goto("/");
  await addPeople(page, "Alice");
  await page.getByRole("button", { name: "Log", exact: true }).click();
  await expect(page.locator("#date")).toHaveValue(today());
  await expect(page.locator("#date")).toHaveAttribute("max", today());
  await expect(page.locator("#save")).toBeDisabled();
  await page.locator("#weight").fill("abc");
  await expect(page.locator("#weight-error")).toBeVisible();
  await logWeight(page, "Alice", "72,4");
  await expect(page.locator("#message")).toContainText("Saved 72.4 kg for Alice");
  await expect(page.locator(`#history li[data-date="${today()}"]`)).toContainText("72.4 kg");

  await page.reload();
  await page.getByRole("button", { name: "Log", exact: true }).click();
  await expect(page.locator(`#history li[data-date="${today()}"]`)).toContainText("72.4 kg");
});

test("date can be changed, entries can be edited and deleted with undo", async ({ page }) => {
  await page.goto("/");
  await addPeople(page, "Alice");
  await logWeight(page, "Alice", "70", daysAgo(10));
  await expect(page.locator(`#history li[data-date="${daysAgo(10)}"]`)).toContainText("70.0 kg");
  // Date resets to today after saving.
  await expect(page.locator("#date")).toHaveValue(today());

  // Edit: tapping the entry loads it into the form; saving replaces it.
  await page.locator(`#history li[data-date="${daysAgo(10)}"] .main button`).click();
  await expect(page.locator("#date")).toHaveValue(daysAgo(10));
  await page.locator("#weight").fill("69.6");
  await page.locator("#save").click();
  await expect(page.locator("#history li")).toHaveCount(1);
  await expect(page.locator("#history li")).toContainText("69.6 kg");

  await page.getByRole("button", { name: /Delete entry/ }).click();
  await expect(page.locator("#history")).toHaveCount(0);
  await page.getByRole("button", { name: "Undo" }).click();
  await expect(page.locator("#history li")).toContainText("69.6 kg");
});

test("chart shows at most three people and keeps colours stable", async ({ page }) => {
  await page.goto("/");
  await addPeople(page, "Ann", "Ben", "Cat", "Dan");
  for (const [i, n] of ["Ann", "Ben", "Cat", "Dan"].entries()) {
    await logWeight(page, n, String(70 + i), daysAgo(3));
    await logWeight(page, n, String(71 + i), daysAgo(1));
  }
  await page.getByRole("button", { name: "Chart", exact: true }).click();
  const chip = (n) => page.locator(`.chip[data-person="${n}"]`);

  await expect(page.locator("#chart svg")).toBeVisible();
  await expect(page.locator("#chart .series-line")).toHaveCount(6); // 3 lines + 3 label keys
  await expect(chip("Dan")).toBeDisabled();
  await expect(page.locator("#chart-hint")).toContainText("maximum");

  const catColour = await chip("Cat").locator(".dot").getAttribute("class");
  await chip("Ben").click();
  await expect(chip("Dan")).toBeEnabled();
  await chip("Dan").click();
  await expect(chip("Ben")).toBeDisabled();
  // Cat kept her colour through the swap; Dan took Ben's freed slot.
  await expect(chip("Cat").locator(".dot")).toHaveAttribute("class", catColour);
  await expect(chip("Dan").locator(".dot")).toHaveClass(/b1/);

  // Tapping the chart shows a readout for each person.
  const box = await page.locator("#chart svg").boundingBox();
  await page.mouse.click(box.x + box.width * 0.6, box.y + box.height / 2);
  await expect(page.locator("#readout .values > span")).toHaveCount(3);
  await expect(page.locator("#readout")).toContainText("Dan:");

  // Range filter: nothing older than a month exists, so 1M still shows data.
  await page.locator('[data-range="1m"]').click();
  await expect(page.locator("#chart svg")).toBeVisible();
});

test("export downloads JSON that import restores after storage is cleared", async ({ page }) => {
  await page.goto("/");
  await addPeople(page, "Alice", "Bob");
  await logWeight(page, "Alice", "70.5", daysAgo(2));
  await logWeight(page, "Bob", "88");

  await page.getByRole("button", { name: "Data", exact: true }).click();
  const [download] = await Promise.all([page.waitForEvent("download"), page.locator("#export").click()]);
  expect(download.suggestedFilename()).toBe(`weigh-in-${today()}.json`);
  const file = await download.path();
  const json = JSON.parse(fs.readFileSync(file, "utf8"));
  expect(json.format).toBe("weigh-in");
  expect(json.people.map((p) => p.name)).toEqual(["Alice", "Bob"]);
  expect(json.entries).toHaveLength(2);
  await expect(page.getByText("up to date")).toBeVisible();

  // Simulate the browser clearing site data.
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await expect(page.getByText("Add the people whose weight you want to track.")).toBeVisible();

  await page.getByRole("button", { name: "Data", exact: true }).click();
  await page.locator("#import-file").setInputFiles(file);
  await expect(page.getByRole("heading", { name: "Import this file?" })).toBeVisible();
  await expect(page.locator("#dialog")).toContainText("2 people and 2 entries");
  await page.locator("#dialog-ok").click();
  await page.getByRole("button", { name: "Log", exact: true }).click();
  await expect(page.locator(`#history li[data-date="${daysAgo(2)}"]`)).toContainText("70.5 kg");
});

test("importing over existing data asks before replacing; bad files are refused", async ({ page }, info) => {
  await page.goto("/");
  await addPeople(page, "Zed");
  await page.getByRole("button", { name: "Data", exact: true }).click();

  const bad = info.outputPath("bad.json");
  fs.writeFileSync(bad, '{"hello": 1}');
  await page.locator("#import-file").setInputFiles(bad);
  await expect(page.getByRole("heading", { name: "Can't import that file" })).toBeVisible();
  await page.locator("#dialog-ok").click();

  const good = info.outputPath("good.json");
  fs.writeFileSync(good, JSON.stringify({ format: "weigh-in", version: 1, people: [{ id: 1, name: "Amy" }], entries: [] }));
  await page.locator("#import-file").setInputFiles(good);
  await expect(page.locator("#dialog")).toContainText("It will replace");
  await page.locator("#dialog-cancel").click();
  await page.getByRole("button", { name: "People", exact: true }).click();
  await expect(page.locator(".list li")).toContainText("Zed"); // cancelled: untouched
});

test("warns when browser storage is unavailable", async ({ page }) => {
  await page.addInitScript(() => {
    Storage.prototype.setItem = () => { throw new DOMException("blocked", "SecurityError"); };
  });
  await page.goto("/");
  await expect(page.locator("#banner")).toContainText("isn't saving your data");
});

test("nags to back up once there are unexported entries", async ({ page }) => {
  await page.goto("/");
  await addPeople(page, "Alice");
  for (let i = 0; i < 5; i++) await logWeight(page, "Alice", String(70 + i), daysAgo(i));
  await expect(page.locator("#banner")).toContainText("haven't backed up yet");
  const [dl] = await Promise.all([page.waitForEvent("download"), page.locator("#banner button").click()]);
  expect(dl.suggestedFilename()).toMatch(/^weigh-in-.*\.json$/);
  await expect(page.locator("#banner")).toBeHidden();
});

test("deleting a person asks first and removes their entries", async ({ page }) => {
  await page.goto("/");
  await addPeople(page, "Alice", "Bob");
  await logWeight(page, "Alice", "70");
  await page.getByRole("button", { name: "People", exact: true }).click();
  await page.getByRole("button", { name: "Delete Alice" }).click();
  await expect(page.locator("#dialog")).toContainText("1 entry");
  await page.locator("#dialog-ok").click();
  await expect(page.locator(".list li")).toHaveCount(1);
  await page.getByRole("button", { name: "Rename Bob" }).click();
  await page.locator("#dialog input").fill("Robert");
  await page.locator("#dialog-ok").click();
  await expect(page.locator(".list li")).toContainText("Robert");
});

test("no horizontal scrolling at phone width", async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 740 });
  await page.goto("/");
  await addPeople(page, "Alexandria-Marguerite", "Bob");
  await logWeight(page, "Alexandria-Marguerite", "70", daysAgo(5));
  await logWeight(page, "Alexandria-Marguerite", "71");
  for (const tab of ["Log", "Chart", "People", "Data"]) {
    await page.getByRole("button", { name: tab, exact: true }).click();
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    expect(overflow, tab).toBeLessThanOrEqual(0);
  }
});

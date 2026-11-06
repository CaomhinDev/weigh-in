import { test } from "@playwright/test";

// Seeds realistic data and saves screenshots to screenshots/ for review.
for (const scheme of ["light", "dark"]) {
  test(`screenshots (${scheme})`, async ({ page }) => {
    await page.emulateMedia({ colorScheme: scheme });
    await page.goto("/");
    await page.evaluate(() => {
      const iso = (n) => { const d = new Date(); d.setDate(d.getDate() - n); return d.toISOString().slice(0, 10); };
      const people = [{ id: 1, name: "Alice" }, { id: 2, name: "Bob" }, { id: 3, name: "Charlotte" }];
      const entries = [];
      let id = 10;
      for (let w = 0; w <= 17; w++) {
        entries.push({ id: id++, personId: 1, date: iso(w * 7), kg: +(74 - (17 - w) * 0.13 + (w % 3) * 0.2).toFixed(1) });
        entries.push({ id: id++, personId: 2, date: iso(w * 7 + 2), kg: +(88.5 - (17 - w) * 0.25 + (w % 2) * 0.4).toFixed(1) });
        if (w < 12) entries.push({ id: id++, personId: 3, date: iso(w * 7 + 1), kg: +(62 + (11 - w) * 0.05 + (w % 4) * 0.15).toFixed(1) });
      }
      localStorage.setItem("weighin.data.v1", JSON.stringify({ nextId: id, people, entries }));
    });
    await page.reload();
    const shot = (name) => page.screenshot({ path: `screenshots/${scheme}-${name}.png`, fullPage: true });
    await page.getByRole("button", { name: "Log", exact: true }).click();
    await shot("log");
    await page.getByRole("button", { name: "Chart", exact: true }).click();
    // locator.click retries if the chart is redrawn (e.g. on resize) mid-action.
    await page.locator("#chart svg").click();
    await shot("chart");
    await page.getByRole("button", { name: "Data", exact: true }).click();
    await shot("data");
  });
}

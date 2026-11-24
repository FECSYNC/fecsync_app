/**
 * Browser check: Actions → Copy on booking, membership, and menu category tables
 * puts the exact public link / iframe embed on the clipboard.
 * npx tsx scripts/verify-category-copy-actions.mts   (dev server on :3000)
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import bcrypt from "bcryptjs";
import { PrismaClient } from "@prisma/client";
import { loadDatabaseUrl } from "./prisma-env.mjs";

loadDatabaseUrl();
const prisma = new PrismaClient({ transactionOptions: { maxWait: 10_000, timeout: 20_000 } });
const BASE = "http://localhost:3000";
const CHROME = [
  "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
  "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
].find((p) => fs.existsSync(p));

let failed = 0;
function check(name: string, ok: boolean, detail = "") {
  if (ok) console.log(`PASS ${name}${detail ? ` — ${detail}` : ""}`);
  else {
    failed += 1;
    console.error(`FAIL ${name}${detail ? ` — ${detail}` : ""}`);
  }
}

async function main() {
  if (!CHROME) throw new Error("Chrome/Edge not found");
  const { createOrganizationWithPlatformAdmin } = await import("../src/lib/orgRegistration.ts");
  const { createBookingCategory, archiveBookingCategory } = await import("../src/lib/ticketing/categories.ts");
  const { createMembershipCategory, updateMembershipCategory } = await import("../src/lib/memberships/categories.ts");
  const { insertPublicCategoryPage } = await import("../src/lib/publicCategory/pages.ts");

  const stamp = Date.now();
  const password = `Copy-${stamp}-pw`;
  const email = `copy-actions-${stamp}@test.local`;
  const user = await prisma.user.create({
    data: {
      email,
      password: await bcrypt.hash(password, 10),
      username: `copyact${stamp}`,
      firstName: "Copy",
      lastName: "Tester",
      role: "client",
      isVerified: true,
      joinedAt: new Date(),
    },
  });
  const orgSlug = `copy-actions-${stamp}`;
  const reg = await createOrganizationWithPlatformAdmin({ name: `Copy Actions ${stamp}`, slug: orgSlug, userId: user.id });
  const orgId = reg.organization.id;
  await prisma.organization.update({
    where: { id: orgId },
    data: {
      status: "active",
      subscriptionPlan: "enterprise",
      subscriptionStatus: "active",
      subscriptionEndsAt: new Date(Date.now() + 30 * 86400000),
    },
  });
  const actor = { orgId, sub: user.id };
  const booking = await createBookingCategory(actor, { name: `Parties ${stamp}` });
  const archived = await createBookingCategory(actor, { name: `Old Parties ${stamp}` });
  await archiveBookingCategory(actor, archived.id);
  const membership = await createMembershipCategory(actor, { name: `Members ${stamp}` });
  await updateMembershipCategory(actor, membership.id, { embedEnabled: false });
  const menu = await prisma.$transaction(async (tx) => {
    const row = await tx.productCategory.create({ data: { orgId, name: `Snacks ${stamp}`, description: "menu" } });
    await insertPublicCategoryPage(tx, { orgId, kind: "menu", name: `Snacks ${stamp}`, productCategoryId: row.id });
    return row;
  });
  const slugOf = async (where: object) =>
    (await prisma.publicCategoryPage.findFirst({ where, select: { slug: true } }))?.slug ?? "";
  const bookingSlug = await slugOf({ bookingCategoryId: booking.id });
  const membershipSlug = await slugOf({ membershipCategoryId: membership.id });
  const menuSlug = await slugOf({ productCategoryId: menu.id });

  const login = await fetch(`${BASE}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password, companySlug: orgSlug }),
  });
  check("company admin signs in", login.status === 200, String(login.status));
  const cookies = login.headers.getSetCookie().map((c) => {
    const [pair] = c.split(";");
    const i = pair.indexOf("=");
    return { name: pair.slice(0, i), value: pair.slice(i + 1), url: BASE };
  });

  const puppeteer = (await import("puppeteer-core")).default;
  const browser = await puppeteer.launch({ executablePath: CHROME, headless: true, args: ["--no-first-run"] });
  const shotDir = path.join(os.tmpdir(), "verify-category-copy");
  fs.mkdirSync(shotDir, { recursive: true });
  try {
    await browser
      .defaultBrowserContext()
      .overridePermissions(BASE, ["clipboard-read", "clipboard-write", "clipboard-sanitized-write"]);
    const page = await browser.newPage();
    await page.setViewport({ width: 1440, height: 900 });
    await page.setCookie(...cookies);

    const rowButton = async (name: string) => {
      const handle = await page.waitForFunction(
        (n) =>
          [...document.querySelectorAll("tr")].find(
            (tr) => tr.textContent?.includes(n) && tr.querySelector('button[aria-haspopup="menu"]')
          ) ?? null,
        { timeout: 240_000, polling: 500 },
        name
      );
      const btn = await (handle.asElement() as import("puppeteer-core").ElementHandle<Element>).$(
        'button[aria-haspopup="menu"]'
      );
      if (!btn) throw new Error(`Copy button missing for ${name}`);
      return btn;
    };
    const clearClipboard = () => page.evaluate(() => navigator.clipboard.writeText("__cleared__"));
    const readClipboard = () => page.evaluate(() => navigator.clipboard.readText());
    const pick = async (name: string, item: "Copy link" | "Copy iframe embed") => {
      await clearClipboard();
      const btn = await rowButton(name);
      await btn.click();
      await page.waitForSelector('[role="menu"]', { timeout: 10_000 });
      const state = await page.evaluate((label) => {
        const el = [...document.querySelectorAll('[role="menuitem"]')].find((b) => b.textContent?.trim() === label) as
          | HTMLButtonElement
          | undefined;
        if (!el) return "missing";
        if (el.disabled) return "disabled";
        el.click();
        return "clicked";
      }, item);
      if (state !== "clicked") {
        await page.keyboard.press("Escape");
        return { state, text: "", label: "" };
      }
      await new Promise((r) => setTimeout(r, 400));
      const label = await btn.evaluate((b) => b.textContent?.trim() ?? "");
      return { state, text: await readClipboard(), label };
    };
    const expectedUrl = (slug: string) => `${BASE}/${orgSlug}/${slug}`;
    const checkCopies = async (title: string, name: string, slug: string, embedOn: boolean) => {
      const link = await pick(name, "Copy link");
      check(
        `${title}: Copy → Copy link puts the public URL on the clipboard`,
        link.text === expectedUrl(slug) && link.label.startsWith("Link copied"),
        `${link.text} [${link.label}]`
      );
      await new Promise((r) => setTimeout(r, 1900));
      const embed = await pick(name, "Copy iframe embed");
      if (embedOn) {
        check(
          `${title}: Copy → Copy iframe embed puts the iframe snippet on the clipboard`,
          embed.text.includes(`<iframe src="${expectedUrl(slug)}?embed=1"`) &&
            embed.text.includes(`${BASE}/embed/category.js`) &&
            embed.label.startsWith("Iframe copied"),
          `[${embed.label}] ${embed.text.split("\n")[1]?.slice(0, 90)}`
        );
      } else {
        check(`${title}: Copy iframe embed is disabled while embedding is off`, embed.state === "disabled", embed.state);
      }
      return { link: link.text, embed: embed.text };
    };

    await page.goto(`${BASE}/admin/ticketing/categories`, { waitUntil: "domcontentloaded", timeout: 240_000 });
    const bookingCopied = await checkCopies("Booking categories", `Parties ${stamp}`, bookingSlug, true);
    await page.screenshot({ path: path.join(shotDir, "booking.png") });

    const row = async (name: string) =>
      (
        await page.waitForFunction(
          (n) => [...document.querySelectorAll("tr")].find((tr) => tr.textContent?.includes(n)) ?? null,
          { timeout: 60_000 },
          name
        )
      ).asElement() as import("puppeteer-core").ElementHandle<HTMLTableRowElement>;
    const renamedSlug = `renamed-${stamp}`;
    const bookingRow = await row(`Parties ${stamp}`);
    check(
      "Booking categories: Name column has no settings form",
      await bookingRow.evaluate((tr) => tr.querySelectorAll("td")[1]?.querySelector("input, select") == null)
    );
    await bookingRow.evaluate((tr) => {
      const btn = [...tr.querySelectorAll("button")].find((b) => b.textContent?.trim() === "Public link");
      (btn as HTMLButtonElement | undefined)?.click();
    });
    const dialog = await page.waitForSelector('[role="dialog"][aria-label^="Public link"]', { timeout: 10_000 });
    const slugInput = await dialog!.$('input[autocomplete="off"]');
    await slugInput!.click({ clickCount: 3 });
    await slugInput!.type(renamedSlug);
    await (await dialog!.$('input[type="checkbox"]'))!.click();
    await dialog!.evaluate((d) => {
      const save = [...d.querySelectorAll("button")].find((b) => b.textContent?.includes("Save public page"));
      (save as HTMLButtonElement | undefined)?.click();
    });
    await page.waitForFunction(() => document.body.textContent?.includes("Public page saved"), { timeout: 60_000 });
    const dialogClosed = await page
      .waitForFunction(() => !document.querySelector('[role="dialog"][aria-label^="Public link"]'), { timeout: 10_000 })
      .then(() => true)
      .catch(() => false);
    check("Public link dialog saves and closes", dialogClosed);
    await new Promise((r) => setTimeout(r, 1900));
    const afterSave = await pick(`Parties ${stamp}`, "Copy link");
    check(
      "after Save public page, Copy link copies the new link without a reload",
      afterSave.text === expectedUrl(renamedSlug),
      afterSave.text
    );
    await new Promise((r) => setTimeout(r, 1900));
    const embedAfterSave = await pick(`Parties ${stamp}`, "Copy iframe embed");
    check(
      "after turning embedding off, Copy iframe embed is greyed out without a reload",
      embedAfterSave.state === "disabled",
      embedAfterSave.state
    );
    const saved = await prisma.publicCategoryPage.findFirst({ where: { bookingCategoryId: booking.id } });
    check(
      "saved link and embed flag are in the database",
      saved?.slug === renamedSlug && saved.embedEnabled === false,
      `${saved?.slug} embed=${saved?.embedEnabled}`
    );

    const reader = await browser.newPage();
    await reader.goto(`${BASE}/embed/category.js`, { waitUntil: "domcontentloaded" });
    await reader.evaluate(() => navigator.clipboard.writeText("__cleared__"));
    await page.bringToFront();
    await page.evaluate(() =>
      Object.defineProperty(navigator, "clipboard", { value: undefined, configurable: true })
    );
    await new Promise((r) => setTimeout(r, 1900));
    const noApiBtn = await rowButton(`Parties ${stamp}`);
    await noApiBtn.click();
    await page.waitForSelector('[role="menu"]', { timeout: 10_000 });
    await page.evaluate(() => {
      const el = [...document.querySelectorAll('[role="menuitem"]')].find(
        (b) => b.textContent?.trim() === "Copy link"
      ) as HTMLButtonElement | undefined;
      el?.click();
    });
    await new Promise((r) => setTimeout(r, 400));
    const noApiLabel = await noApiBtn.evaluate((b) => b.textContent?.trim() ?? "");
    await reader.bringToFront();
    const noApiText = await reader.evaluate(() => navigator.clipboard.readText());
    await reader.close();
    await page.bringToFront();
    check(
      "plain-http host (no navigator.clipboard): Copy link still copies via the fallback",
      noApiText === expectedUrl(renamedSlug) && noApiLabel.startsWith("Link copied"),
      `${noApiText} [${noApiLabel}]`
    );

    await page.evaluate(() => {
      const box = [...document.querySelectorAll("label")].find((l) => l.textContent?.includes("Show archived"))
        ?.querySelector("input") as HTMLInputElement | undefined;
      box?.click();
    });
    const archivedBtn = await rowButton(`Old Parties ${stamp}`);
    check(
      "Booking categories: archived row's Copy button is greyed out",
      await archivedBtn.evaluate((b) => (b as HTMLButtonElement).disabled)
    );

    await page.goto(`${BASE}/admin/memberships/categories`, { waitUntil: "domcontentloaded", timeout: 240_000 });
    await checkCopies("Membership categories", `Members ${stamp}`, membershipSlug, false);
    await page.screenshot({ path: path.join(shotDir, "membership.png") });

    await page.goto(`${BASE}/admin/categories`, { waitUntil: "domcontentloaded", timeout: 240_000 });
    const menuCopied = await checkCopies("Catalog (menu) categories", `Snacks ${stamp}`, menuSlug, true);
    check(
      "Catalog categories: name cell has no settings form; Public link button is in Actions",
      await (await row(`Snacks ${stamp}`)).evaluate(
        (tr) =>
          [...tr.querySelectorAll("td")].every((td) => td.querySelector("input, select") == null) &&
          [...tr.querySelectorAll("button")].some((b) => b.textContent?.trim() === "Public link")
      )
    );
    await new Promise((r) => setTimeout(r, 1900));
    await (await rowButton(`Snacks ${stamp}`)).click();
    const menuShown = await page
      .waitForSelector('[role="menu"]', { timeout: 10_000 })
      .then(() => true)
      .catch(() => false);
    check("menu opens again on a second click", menuShown);
    await page.screenshot({ path: path.join(shotDir, "menu-open.png") });
    await page.keyboard.press("Escape");
    const closed = await page.$('[role="menu"]');
    check("Escape closes the menu", closed == null);

    await page.goto(`${BASE}/admin/categories`, { waitUntil: "networkidle2", timeout: 240_000 });
    await new Promise((r) => setTimeout(r, 3000));
    await (await rowButton(`Snacks ${stamp}`)).click();
    const afterReload = await page
      .waitForSelector('[role="menu"]', { timeout: 10_000 })
      .then(() => true)
      .catch(() => false);
    check("menu opens after a fresh page load", afterReload);
    if (afterReload) {
      const reloadCopy = await page.evaluate(() => {
        const el = [...document.querySelectorAll('[role="menuitem"]')].find(
          (b) => b.textContent?.trim() === "Copy link"
        ) as HTMLButtonElement | undefined;
        el?.click();
        return Boolean(el);
      });
      await new Promise((r) => setTimeout(r, 400));
      const text = reloadCopy ? await readClipboard() : "";
      check("Copy link works after a fresh page load", text === expectedUrl(menuSlug), text);
    } else {
      await page.screenshot({ path: path.join(shotDir, "reload-no-menu.png") });
    }

    check("booking copies were the original link", bookingCopied.link === expectedUrl(bookingSlug));
    const linkRes = await fetch(menuCopied.link);
    check("copied menu link opens the public page", linkRes.status === 200, `${linkRes.status} ${menuCopied.link}`);
    const renamedRes = await fetch(expectedUrl(renamedSlug));
    const oldRes = await fetch(bookingCopied.link);
    check(
      "renamed booking link opens and the old one is gone",
      renamedRes.status === 200 && oldRes.status === 404,
      `${renamedRes.status} / ${oldRes.status}`
    );
    const src = /<iframe src="([^"]+)"/.exec(menuCopied.embed)?.[1]?.replace(/&amp;/g, "&") ?? "";
    const frameRes = src ? await fetch(src) : null;
    check("copied iframe src opens the embedded page", frameRes?.status === 200, `${frameRes?.status} ${src}`);
    await page.setViewport({ width: 420, height: 860 });
    await page.goto(`${BASE}/admin/categories`, { waitUntil: "networkidle2", timeout: 240_000 });
    await row(`Snacks ${stamp}`);
    await page.screenshot({ path: path.join(shotDir, "catalog-narrow.png"), fullPage: true });
    console.log(`Screenshots: ${shotDir}`);
  } finally {
    await browser.close().catch(() => {});
  }

  if (failed > 0) {
    console.error(`\n${failed} copy check(s) failed`);
    process.exitCode = 1;
  } else {
    console.log("Category copy actions OK");
  }
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());

import { chromium, expect } from "@playwright/test";
import { authenticator } from "otplib";
import { readFile, mkdir } from "node:fs/promises";
import { homedir } from "node:os";
import { resolve } from "node:path";

async function main() {
  if (process.env.NODE_ENV === "production")
    throw Error("Local development only");
  const config = JSON.parse(
    await readFile(".local-data/config.json", "utf8"),
  ) as { password: string; totp: Record<string, string> };
  const out = resolve(homedir(), "work/screenshots");
  await mkdir(out, { recursive: true });
  const browser = await chromium.launch({ headless: true });
  const errors: string[] = [];
  try {
    const member = await browser.newContext({
      ignoreHTTPSErrors: true,
      viewport: { width: 390, height: 1450 },
      isMobile: true,
      deviceScaleFactor: 1,
    });
    const page = await member.newPage();
    page.on("pageerror", (error) => errors.push(error.message));
    await page.goto("https://localhost:3000/app");
    await page.getByRole("checkbox").check();
    await page.getByRole("button", { name: "開發專用模擬登入" }).click();
    await expect(page.locator(".mission-card")).toHaveCount(2);
    await page.locator("h1").click();
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.screenshot({
      path: resolve(out, "member-list.png"),
      fullPage: true,
    });
    await page.locator(".mission-card").first().click();
    const follow = page.getByRole("switch", { name: "關注近況" }),
      push = page.getByRole("switch", { name: "接收 LINE 提醒" });
    await expect(push).not.toBeChecked();
    const wasFollowing = await follow.isChecked();
    await follow.setChecked(!wasFollowing);
    await expect(follow).toBeChecked({ checked: !wasFollowing });
    await expect(push).not.toBeChecked();
    await expect(page.getByText("✓ 偏好已更新", { exact: true })).toBeVisible();
    await page
      .getByRole("link", { name: /閱讀與代禱/ })
      .first()
      .click();
    await expect(
      page.getByRole("heading", { name: "一起為這些需要代禱" }),
    ).toBeVisible();
    const prayed = page.getByRole("button", {
      name: "♡ 我今天為此代禱",
      exact: true,
    });
    if (await prayed.count()) await prayed.click();
    await expect(
      page.getByRole("button", { name: "✓ 今天已代禱" }),
    ).toBeDisabled();
    await page.reload();
    await expect(
      page.getByRole("button", { name: "✓ 今天已代禱" }),
    ).toBeDisabled();
    await expect(page.getByText(/本週有/)).toHaveCount(0);
    await expect(
      page.getByRole("link", { name: "官方奉獻網站 ↗" }),
    ).toHaveCount(0);
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
    ).toBe(true);
    await page.locator("h1").click();
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.screenshot({
      path: resolve(out, "member-letter.png"),
      fullPage: true,
    });
    const admin = await browser.newContext({
      ignoreHTTPSErrors: true,
      viewport: { width: 1440, height: 1000 },
      deviceScaleFactor: 1,
    });
    const adminPage = await admin.newPage();
    adminPage.on("pageerror", (error) => errors.push(error.message));
    await adminPage.goto("https://localhost:3000/admin/login");
    await adminPage.screenshot({
      path: resolve(out, "admin-login.png"),
      fullPage: true,
    });
    async function login(name: string) {
      await adminPage.goto("https://localhost:3000/admin/login");
      await adminPage
        .getByLabel("工作電子郵件")
        .fill(name + "@mission-care.test");
      await adminPage.getByLabel("密碼", { exact: true }).fill(config.password);
      await adminPage.getByRole("button", { name: "繼續安全驗證 →" }).click();
      await expect(adminPage.getByLabel("六位數驗證碼")).toBeVisible();
      await adminPage
        .getByLabel("六位數驗證碼")
        .fill(authenticator.generate(config.totp[name]));
      await adminPage
        .getByRole("button", { name: "驗證並進入工作空間 →" })
        .click();
      await adminPage.waitForURL("**/admin");
    }
    await login("mission_lead");
    await expect(
      adminPage.getByRole("heading", {
        name: "把關懷放在心上，把安全落在細節。",
      }),
    ).toBeVisible();
    await adminPage.screenshot({
      path: resolve(out, "admin-overview.png"),
      fullPage: true,
    });
    await adminPage
      .getByRole("link", { name: "LINE 推播中心", exact: false })
      .first()
      .click();
    await expect(
      adminPage.getByText("有新的關懷消息", { exact: true }),
    ).toBeVisible();
    await adminPage
      .getByRole("link", { name: "通知偏好", exact: true })
      .click();
    await expect(
      adminPage.getByRole("heading", { name: "尊重每一次通知選擇" }),
    ).toBeVisible();
    await adminPage.getByRole("link", { name: "待發送", exact: true }).click();
    await expect(
      adminPage.getByRole("link", { name: "待發送", exact: true }),
    ).toHaveAttribute("aria-current", "page");
    await adminPage.locator("h1").click();
    await adminPage.evaluate(() => window.scrollTo(0, 0));
    await adminPage.screenshot({
      path: resolve(out, "admin-notifications.png"),
      fullPage: true,
    });
    const forbiddenResponse = await adminPage.goto(
      "https://localhost:3000/admin/audit",
    );
    expect(forbiddenResponse?.status()).toBe(403);
    await expect(
      adminPage.getByRole("heading", { name: "此工作不在目前授權範圍內" }),
    ).toBeVisible();
    await adminPage.context().clearCookies();
    await login("reviewer");
    await adminPage.goto("https://localhost:3000/admin/tasks");
    await adminPage.getByRole("link", { name: "開啟審核 →" }).first().click();
    await expect(
      adminPage.getByRole("heading", { name: "安全風險檢視" }),
    ).toBeVisible();
    await expect(
      adminPage.getByText("原始投稿 · 僅限授權編輯與審核人"),
    ).toBeVisible();
    await expect(
      adminPage.getByRole("button", { name: "核准此版本", exact: true }),
    ).toBeDisabled();
    await adminPage
      .getByRole("checkbox", { name: "已核對本修訂的當事人同意及圖片安全" })
      .check();
    await expect(
      adminPage.getByRole("button", { name: "核准此版本", exact: true }),
    ).toBeEnabled();
    await adminPage.locator("h1").click();
    await adminPage.evaluate(() => window.scrollTo(0, 0));
    await adminPage.screenshot({
      path: resolve(out, "admin-letter-review.png"),
      fullPage: true,
    });
    const memberLetterResponse = await page.reload();
    expect(memberLetterResponse?.headers()["cache-control"]).toContain(
      "no-store",
    );
    expect(errors).toEqual([]);
    console.log(
      "PASS：六個畫面、獨立偏好、代禱重載去重、小樣本隱藏、未核准 CTA 隱藏、審核同意控制、直接網址 403、no-store、無瀏覽器錯誤。",
    );
    for (const name of [
      "member-list",
      "member-letter",
      "admin-login",
      "admin-overview",
      "admin-letter-review",
      "admin-notifications",
    ])
      console.log(resolve(out, name + ".png"));
  } finally {
    await browser.close();
  }
}
main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

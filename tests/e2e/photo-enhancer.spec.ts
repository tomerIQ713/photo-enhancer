import { resolve } from "node:path";
import { expect, test, type Page } from "playwright/test";

const samplePath = resolve(process.cwd(), "tests/fixtures/sample.png");
const controls = {
  strength: 50,
  sharpness: 50,
  noiseReduction: 50,
  brightness: 50,
  contrast: 50
};

async function uploadAndEnhance(page: Page): Promise<void> {
  await page.goto("/");
  await page.getByLabel(/upload photos/i).setInputFiles(samplePath);
  await page.getByRole("button", { name: /auto enhance/i }).click();
  await page.getByRole("button", { name: /enhance photos/i }).click();
}

test("uploads, enhances, compares, and downloads a photo", async ({ page, request }) => {
  await uploadAndEnhance(page);

  await expect(page.getByRole("slider", { name: /before and after/i })).toBeVisible();
  const download = page.getByRole("link", { name: /download png/i });
  await expect(download).toBeVisible();

  const href = await download.getAttribute("href");
  expect(href).toBeTruthy();
  const downloadResponsePromise = request.get(new URL(href!, page.url()).toString());
  const downloadEvent = page.waitForEvent("download");
  await download.click();
  const [downloadResponse, browserDownload] = await Promise.all([
    downloadResponsePromise,
    downloadEvent
  ]);
  expect(downloadResponse.status()).toBe(200);
  expect(downloadResponse.headers()["content-type"]).toContain("image/png");
  expect((await downloadResponse.body()).length).toBeGreaterThan(0);
  expect(await browserDownload.failure()).toBeNull();
  expect(browserDownload.suggestedFilename()).toBe("photo-enhanced.png");
});

test("shows an error for an invalid image upload", async ({ page }) => {
  await page.goto("/");
  await page.getByLabel(/upload photos/i).setInputFiles({
    name: "not-an-image.png",
    mimeType: "image/png",
    buffer: Buffer.from("not a png")
  });
  await page.getByRole("button", { name: /enhance photos/i }).click();

  await expect(page.getByRole("alert")).toHaveText(/invalid request/i);
});

test("retries a failed task and shows its completed result", async ({ page }) => {
  await page.setExtraHTTPHeaders({ "x-e2e-retry": "true" });
  await uploadAndEnhance(page);
  const retry = page.getByRole("button", { name: /retry .*\.png/i });
  await expect(retry).toBeVisible();
  const retryResponsePromise = page.waitForResponse((response) =>
    response.request().method() === "POST" && new URL(response.url()).pathname.endsWith("/retry")
  );
  await retry.click();
  expect((await retryResponsePromise).status()).toBe(202);

  await expect(page.getByRole("slider", { name: /before and after/i })).toBeVisible();
  await expect(page.getByRole("link", { name: /download png/i })).toBeVisible();
});

for (const viewport of [
  { width: 1440, height: 900 },
  { width: 900, height: 1000 },
  { width: 390, height: 844 }
]) {
  test(`has no horizontal overflow at ${viewport.width}x${viewport.height}`, async ({ page }) => {
    await page.setViewportSize(viewport);
    await uploadAndEnhance(page);
    await expect(page.getByRole("slider", { name: /before and after/i })).toBeVisible();

    const overflow = await page.evaluate(() => ({
      documentWidth: document.documentElement.scrollWidth,
      viewportWidth: window.innerWidth
    }));
    expect(overflow.documentWidth).toBeLessThanOrEqual(overflow.viewportWidth);
  });
}

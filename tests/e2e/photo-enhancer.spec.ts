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

test("uploads, enhances, compares, and downloads a photo", async ({ page }) => {
  await uploadAndEnhance(page);

  await expect(page.getByRole("slider", { name: /before and after/i })).toBeVisible();
  const download = page.getByRole("link", { name: /download png/i });
  await expect(download).toBeVisible();

  const downloadEvent = page.waitForEvent("download");
  await download.click();
  expect((await downloadEvent).suggestedFilename()).toBe("photo-enhanced.png");
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
  let jobId: string | undefined;
  let taskId: string | undefined;
  let failedResponseSent = false;

  await page.route("**/api/jobs/**", async (route) => {
    const request = route.request();
    if (request.method() === "GET" && /\/api\/jobs\/[^/]+$/.test(request.url())) {
      const response = await route.fetch();
      const body = (await response.json()) as {
        jobId: string;
        preset: string;
        controls: typeof controls;
        createdAt: number;
        expiresAt: number;
        tasks: Array<Record<string, unknown> & { taskId: string }>;
      };
      jobId = body.jobId;
      taskId = body.tasks[0]?.taskId;
      if (failedResponseSent || !taskId) {
        await route.fulfill({
          status: response.status(),
          headers: response.headers(),
          body: JSON.stringify(body)
        });
        return;
      }

      failedResponseSent = true;
      await route.fulfill({
        contentType: "application/json",
        body: JSON.stringify({
          jobId,
          preset: "auto",
          controls,
          createdAt: body.createdAt,
          expiresAt: body.expiresAt,
          tasks: [{
            taskId,
            status: "failed",
            error: "Processing failed"
          }]
        })
      });
      return;
    }

    if (request.method() === "POST" && taskId && request.url().endsWith(`/tasks/${taskId}/retry`)) {
      await route.fulfill({
        status: 202,
        contentType: "application/json",
        body: JSON.stringify({ taskId, status: "queued" })
      });
      return;
    }

    await route.continue();
  });

  await uploadAndEnhance(page);
  const retry = page.getByRole("button", { name: /retry .*\.png/i });
  await expect(retry).toBeVisible();
  await retry.click();

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

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import sharp from "sharp";
// @ts-expect-error This repository does not include @types/supertest.
import request from "supertest";
import { afterEach, describe, expect, it } from "vitest";
import { createApp } from "./app";
import { JobStore } from "./jobs/job-store";
import { RateLimiter } from "./admission";
import type { ManualControls, OutputFormat, Preset } from "./types";

const defaultControls: ManualControls = {
  strength: 70,
  sharpness: 60,
  noiseReduction: 30,
  brightness: 50,
  contrast: 50
};

const tempDirectories: string[] = [];

function createTempDirectory(): string {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "photo-enhancer-api-test-"));
  tempDirectories.push(directory);
  return directory;
}

async function createSamplePng(color = { r: 120, g: 80, b: 40 }): Promise<Buffer> {
  return sharp({
    create: {
      width: 4,
      height: 3,
      channels: 3,
      background: color
    }
  })
    .png()
    .toBuffer();
}

class TestPipeline {
  calls = 0;
  failuresRemaining = 0;
  controls: ManualControls[] = [];

  async process(
    input: Buffer,
    _preset: Preset,
    controls: ManualControls,
    _outputFormat: OutputFormat
  ): Promise<Buffer> {
    this.calls += 1;
    this.controls.push(controls);
    if (this.failuresRemaining > 0) {
      this.failuresRemaining -= 1;
      throw new Error("provider response must not be exposed");
    }
    return Buffer.concat([Buffer.from("processed:"), input]);
  }
}

function createTestApp() {
  const directory = createTempDirectory();
  const store = new JobStore({ rootDir: path.join(directory, "jobs") });
  const pipeline = new TestPipeline();
  const app = createApp({ store, pipeline, cleanupIntervalMs: 60_000 });
  return { app, store, pipeline };
}

async function waitForStatus(
  app: ReturnType<typeof createApp>,
  jobId: string,
  status: string,
  taskIndex = 0
) {
  for (let attempt = 0; attempt < 40; attempt += 1) {
    const response = await request(app).get(`/api/jobs/${jobId}`);
    if (response.body.tasks?.[taskIndex]?.status === status) {
      return response;
    }
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  return request(app).get(`/api/jobs/${jobId}`);
}

afterEach(() => {
  for (const directory of tempDirectories.splice(0)) {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

describe("photo jobs API", () => {
  it("accepts a valid single-image upload and returns a job id", async () => {
    const { app } = createTestApp();

    const response = await request(app)
      .post("/api/jobs")
      .attach("files", await createSamplePng(), {
        filename: "sample.png",
        contentType: "image/png"
      })
      .field("preset", "auto");

    expect(response.status).toBe(202);
    expect(response.body.jobId).toEqual(expect.any(String));
    expect(response.body.tasks).toHaveLength(1);
    expect(response.body.tasks[0].taskId).toEqual(expect.any(String));
  });

  it("rejects an oversized or unsupported upload before creating a job", async () => {
    const { app, store } = createTestApp();

    const response = await request(app)
      .post("/api/jobs")
      .attach("files", Buffer.from("not an image"), {
        filename: "notes.txt",
        contentType: "text/plain"
      });

    expect(response.status).toBe(400);
    expect(response.body.error).toEqual(expect.any(String));
    expect(store.size).toBe(0);
  });

  it("validates controls and output format at the multipart boundary", async () => {
    const { app } = createTestApp();

    const response = await request(app)
      .post("/api/jobs")
      .attach("files", await createSamplePng(), {
        filename: "sample.png",
        contentType: "image/png"
      })
      .field("controls", JSON.stringify({ ...defaultControls, sharpness: 101 }))
      .field("outputFormat", "gif");

    expect(response.status).toBe(400);
  });

  it("persists and processes independent controls for queued images", async () => {
    const { app, pipeline } = createTestApp();
    const firstControls = { ...defaultControls, strength: 10 };
    const secondControls = { ...defaultControls, strength: 90 };
    const response = await request(app)
      .post("/api/jobs")
      .attach("files", await createSamplePng(), { filename: "first.png", contentType: "image/png" })
      .attach("files", await createSamplePng(), { filename: "second.png", contentType: "image/png" })
      .field("controls", JSON.stringify(defaultControls))
      .field("controlsByTask", JSON.stringify([firstControls, secondControls]));

    expect(response.status).toBe(202);
    await waitForStatus(app, response.body.jobId, "complete", 1);
    expect(pipeline.controls.map((controls) => controls.strength).sort()).toEqual([10, 90]);
    const status = await request(app).get(`/api/jobs/${response.body.jobId}`);
    expect(status.body.tasks.map((task: { controls: ManualControls }) => task.controls.strength)).toEqual([10, 90]);
  });

  it("processes tasks independently, reports temporary result metadata, and downloads output", async () => {
    const { app, pipeline, store } = createTestApp();
    pipeline.failuresRemaining = 1;
    const sample = await createSamplePng();

    const response = await request(app)
      .post("/api/jobs")
      .attach("files", sample, { filename: "first.png", contentType: "image/png" })
      .attach("files", sample, { filename: "second.png", contentType: "image/png" })
      .field("preset", "auto")
      .field("outputFormat", "png");

    expect(response.status).toBe(202);
    let terminalResponse = await request(app).get(`/api/jobs/${response.body.jobId}`);
    for (let attempt = 0; attempt < 40; attempt += 1) {
      const statuses = terminalResponse.body.tasks.map((task: { status: string }) => task.status);
      if (statuses.includes("failed") && statuses.includes("complete")) {
        break;
      }
      await new Promise((resolve) => setTimeout(resolve, 5));
      terminalResponse = await request(app).get(`/api/jobs/${response.body.jobId}`);
    }
    const failedTask = terminalResponse.body.tasks.find(
      (task: { status: string }) => task.status === "failed"
    );
    const completeTask = terminalResponse.body.tasks.find(
      (task: { status: string }) => task.status === "complete"
    );
    expect(failedTask.error).toBe("Processing failed");
    expect(completeTask.result).toMatchObject({
      format: "png",
      previewUrl: `/api/jobs/${response.body.jobId}/tasks/${completeTask.taskId}/preview`
    });
    const failedOriginalPath = store
      .get(response.body.jobId)
      ?.tasks.find((task) => task.id === failedTask.taskId)?.originalPath;
    expect(failedOriginalPath).toEqual(expect.any(String));
    expect(fs.existsSync(failedOriginalPath as string)).toBe(true);

    const retry = await request(app)
      .post(`/api/jobs/${response.body.jobId}/tasks/${failedTask.taskId}/retry`)
      .send();
    expect(retry.status).toBe(202);
    await waitForStatus(app, response.body.jobId, "complete", terminalResponse.body.tasks.indexOf(failedTask));

    const download = await request(app).get(
      `/api/jobs/${response.body.jobId}/tasks/${completeTask.taskId}/download?format=png`
    );
    expect(download.status).toBe(200);
    expect(download.headers["content-type"]).toContain("image/png");
    expect(download.headers["content-disposition"]).toContain("attachment");
    expect(download.body).toBeInstanceOf(Buffer);

    const preview = await request(app).get(
      `/api/jobs/${response.body.jobId}/tasks/${completeTask.taskId}/preview`
    );
    expect(preview.status).toBe(200);
    expect(preview.headers["content-type"]).toContain("image/png");
    expect(preview.headers["content-disposition"]).toBeUndefined();
    expect(preview.body).toBeInstanceOf(Buffer);
  });

  it("supports a fake-mode first failure followed by real retry processing", async () => {
    const previousFakeProcessing = process.env.E2E_FAKE_PROCESSING;
    process.env.E2E_FAKE_PROCESSING = "true";
    const { app, pipeline } = createTestApp();

    try {
      const response = await request(app)
        .post("/api/jobs")
        .set("x-e2e-retry", "true")
        .attach("files", await createSamplePng(), {
          filename: "retry.png",
          contentType: "image/png"
        });
      const jobId = response.body.jobId as string;
      const taskId = response.body.tasks[0].taskId as string;

      expect(response.status).toBe(202);
      const failed = await waitForStatus(app, jobId, "failed");
      expect(failed.body.tasks[0]).toMatchObject({
        taskId,
        status: "failed",
        error: "Processing failed"
      });
      expect(pipeline.calls).toBe(0);

      const retry = await request(app)
        .post(`/api/jobs/${jobId}/tasks/${taskId}/retry`)
        .send();

      expect(retry.status).toBe(202);
      const complete = await waitForStatus(app, jobId, "complete");
      expect(complete.body.tasks[0]).toMatchObject({ taskId, status: "complete" });
      expect(pipeline.calls).toBe(1);
    } finally {
      app.close();
      if (previousFakeProcessing === undefined) {
        delete process.env.E2E_FAKE_PROCESSING;
      } else {
        process.env.E2E_FAKE_PROCESSING = previousFakeProcessing;
      }
    }
  });

  it("returns 404 for unknown resources and 410 for expired results", async () => {
    const { app, store } = createTestApp();
    const response = await request(app)
      .post("/api/jobs")
      .attach("files", await createSamplePng(), {
        filename: "sample.png",
        contentType: "image/png"
      });
    const jobId = response.body.jobId as string;
    const taskId = response.body.tasks[0].taskId as string;

    expect((await request(app).get("/api/jobs/unknown")).status).toBe(404);
    await waitForStatus(app, jobId, "complete");
    store.removeExpired(Number.MAX_SAFE_INTEGER);

    expect(
      (await request(app).get(`/api/jobs/${jobId}/tasks/${taskId}/download?format=png`)).status
    ).toBe(410);
  });

  it("returns a sanitized 500 when accepted storage fails", async () => {
    const directory = createTempDirectory();
    class FailingStore extends JobStore {
      override createFromBuffers(..._args: Parameters<JobStore["createFromBuffers"]>): never {
        throw new Error("write failed at C:\\private\\photo-enhancer\\secret");
      }
    }
    const app = createApp({
      store: new FailingStore({ rootDir: path.join(directory, "jobs") }),
      pipeline: new TestPipeline(),
      cleanupIntervalMs: 60_000
    });

    const response = await request(app)
      .post("/api/jobs")
      .attach("files", await createSamplePng(), {
        filename: "sample.png",
        contentType: "image/png"
      });

    expect(response.status).toBe(500);
    expect(response.body.error).toBe("Internal server error");
    expect(JSON.stringify(response.body)).not.toContain("private");
    app.close();
  });

  it("maps a missing temporary result to 410 without a status-route exception", async () => {
    const { app, store } = createTestApp();
    const response = await request(app)
      .post("/api/jobs")
      .attach("files", await createSamplePng(), {
        filename: "sample.png",
        contentType: "image/png"
      });
    const jobId = response.body.jobId as string;
    await waitForStatus(app, jobId, "complete");
    const outputPath = store.get(jobId)?.tasks[0].outputPath;
    expect(outputPath).toEqual(expect.any(String));
    fs.unlinkSync(outputPath as string);

    const status = await request(app).get(`/api/jobs/${jobId}`);
    const download = await request(app).get(
      `/api/jobs/${jobId}/tasks/${response.body.tasks[0].taskId}/download?format=png`
    );
    const preview = await request(app).get(
      `/api/jobs/${jobId}/tasks/${response.body.tasks[0].taskId}/preview`
    );
    expect(status.status).toBe(200);
    expect(status.body.tasks[0].result).toBeUndefined();
    expect(download.status).toBe(410);
    expect(preview.status).toBe(410);
  });

  it("returns 410 when retry observes an expired job", async () => {
    const { app, store } = createTestApp();
    const response = await request(app)
      .post("/api/jobs")
      .attach("files", await createSamplePng(), {
        filename: "sample.png",
        contentType: "image/png"
      });
    const jobId = response.body.jobId as string;
    const taskId = response.body.tasks[0].taskId as string;
    store.markTask(jobId, taskId, { status: "failed", error: "Processing failed" });
    store.removeExpired(Number.MAX_SAFE_INTEGER);

    const retry = await request(app).post(`/api/jobs/${jobId}/tasks/${taskId}/retry`).send();

    expect(retry.status).toBe(410);
  });

  it("rate limits uploads by the socket client IP without trusting forwarded headers", async () => {
    const limiter = new RateLimiter({ maxRequests: 1, windowMs: 60_000 });
    const directory = createTempDirectory();
    const app = createApp({
      store: new JobStore({ rootDir: path.join(directory, "jobs") }),
      rateLimiter: limiter,
      cleanupIntervalMs: 60_000
    });
    const first = await request(app)
      .post("/api/jobs")
      .set("x-forwarded-for", "203.0.113.10")
      .attach("files", await createSamplePng(), { filename: "first.png", contentType: "image/png" });
    const second = await request(app)
      .post("/api/jobs")
      .set("x-forwarded-for", "198.51.100.12")
      .attach("files", await createSamplePng(), { filename: "second.png", contentType: "image/png" });

    expect(first.status).toBe(202);
    expect(second.status).toBe(429);
  });

  it("returns 503 before storing a job when tracked-job capacity is exhausted", async () => {
    const directory = createTempDirectory();
    const store = new JobStore({ rootDir: path.join(directory, "jobs"), maxTrackedJobs: 1 });
    const app = createApp({ store, cleanupIntervalMs: 60_000 });
    const sample = await createSamplePng();
    const first = await request(app).post("/api/jobs").attach("files", sample, {
      filename: "first.png", contentType: "image/png"
    });
    const second = await request(app).post("/api/jobs").attach("files", sample, {
      filename: "second.png", contentType: "image/png"
    });

    expect(first.status).toBe(202);
    expect(second.status).toBe(503);
    expect(second.body.error).toBe("Service temporarily at capacity");
    app.close();
  });

  it("marks temporary status, preview, and download responses private and uncached", async () => {
    const { app } = createTestApp();
    const response = await request(app).post("/api/jobs").attach("files", await createSamplePng(), {
      filename: "cache.png", contentType: "image/png"
    });
    const jobId = response.body.jobId as string;
    const taskId = response.body.tasks[0].taskId as string;
    await waitForStatus(app, jobId, "complete");

    const status = await request(app).get(`/api/jobs/${jobId}`);
    const preview = await request(app).get(`/api/jobs/${jobId}/tasks/${taskId}/preview`);
    const download = await request(app).get(`/api/jobs/${jobId}/tasks/${taskId}/download?format=png`);
    expect(status.headers["cache-control"]).toBe("no-store, private");
    expect(preview.headers["cache-control"]).toBe("no-store, private");
    expect(download.headers["cache-control"]).toBe("no-store, private");
  });

  it("maps a removed active job to 410 through the atomic lookup path", async () => {
    const { app, store } = createTestApp();
    const response = await request(app).post("/api/jobs").attach("files", await createSamplePng(), {
      filename: "expired.png", contentType: "image/png"
    });
    const jobId = response.body.jobId as string;
    store.removeExpired(Number.MAX_SAFE_INTEGER);

    expect((await request(app).get(`/api/jobs/${jobId}`)).status).toBe(410);
  });
});

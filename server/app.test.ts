import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import sharp from "sharp";
// @ts-expect-error This repository does not include @types/supertest.
import request from "supertest";
import { afterEach, describe, expect, it } from "vitest";
import { createApp } from "./app";
import { JobStore } from "./jobs/job-store";
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

  async process(
    input: Buffer,
    _preset: Preset,
    _controls: ManualControls,
    _outputFormat: OutputFormat
  ): Promise<Buffer> {
    this.calls += 1;
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
    expect(completeTask.result).toMatchObject({ format: "png" });
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
    expect(download.body).toBeInstanceOf(Buffer);
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
});

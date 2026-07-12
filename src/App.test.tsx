import "@testing-library/jest-dom/vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { App } from "./App";
import * as api from "./api";
import type { JobTask } from "./types";

vi.mock("./api", () => ({
  createJob: vi.fn(),
  getJob: vi.fn(),
  retryTask: vi.fn(),
  getDownloadUrl: vi.fn((jobId: string, taskId: string, format: string) =>
    `/api/jobs/${jobId}/tasks/${taskId}/download?format=${format}`
  )
}));

const pngFile = new File(["png"], "portrait.png", { type: "image/png" });

function mockJobStatus(status: Partial<JobTask> & Pick<JobTask, "status">) {
  vi.mocked(api.getJob).mockResolvedValue({
    jobId: "job-1",
    preset: "auto",
    controls: {
      strength: 50,
      sharpness: 50,
      noiseReduction: 50,
      brightness: 50,
      contrast: 50
    },
    createdAt: 0,
    expiresAt: Date.now() + 60_000,
    tasks: [
      {
        taskId: "task-1",
        status: status.status,
        originalUrl: status.originalUrl,
        outputUrl: status.outputUrl,
        error: status.error
      }
    ]
  });
}

describe("Photo enhancer workbench", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(api.createJob).mockResolvedValue({
      jobId: "job-1",
      tasks: [{ taskId: "task-1", status: "queued" }]
    });
  });

  it("shows both presets after a file is selected", async () => {
    const user = userEvent.setup();
    render(<App />);

    await user.upload(screen.getByLabelText(/upload photos/i), pngFile);

    expect(screen.getByRole("button", { name: /auto enhance/i })).toBeVisible();
    expect(screen.getByRole("button", { name: /upscale/i })).toBeVisible();
  });

  it("creates a job with the selected file and polls until it completes", async () => {
    const user = userEvent.setup();
    mockJobStatus({ status: "complete", originalUrl: "/original", outputUrl: "/output" });
    render(<App />);

    await user.upload(screen.getByLabelText(/upload photos/i), pngFile);
    await user.click(screen.getByRole("button", { name: /enhance photos/i }));

    await waitFor(() => expect(api.createJob).toHaveBeenCalled());
    expect(api.createJob).toHaveBeenCalledWith([pngFile], "auto", expect.objectContaining({ strength: 50 }), "png");
    expect(await screen.findByText(/complete/i)).toBeVisible();
  });

  it("shows a before and after comparison when a task completes", async () => {
    const user = userEvent.setup();
    mockJobStatus({ status: "complete", originalUrl: "/original", outputUrl: "/output" });
    render(<App />);

    await user.upload(screen.getByLabelText(/upload photos/i), pngFile);
    await user.click(screen.getByRole("button", { name: /enhance photos/i }));
    await waitFor(() => expect(api.getJob).toHaveBeenCalled());

    expect(await screen.findByRole("slider", { name: /before and after/i })).toBeVisible();
    expect(screen.getByAltText(/original/i)).toHaveAttribute("src", "/original");
    expect(screen.getByAltText(/enhanced/i)).toHaveAttribute("src", "/output");
  });

  it("offers retry for failed tasks and download for completed tasks", async () => {
    const user = userEvent.setup();
    vi.mocked(api.getJob)
      .mockResolvedValueOnce({
        jobId: "job-1",
        preset: "auto",
        controls: {
          strength: 50,
          sharpness: 50,
          noiseReduction: 50,
          brightness: 50,
          contrast: 50
        },
        createdAt: 0,
        expiresAt: Date.now() + 60_000,
        tasks: [{ taskId: "task-1", status: "failed", error: "Processing failed" }]
      })
      .mockResolvedValueOnce({
        jobId: "job-1",
        preset: "auto",
        controls: {
          strength: 50,
          sharpness: 50,
          noiseReduction: 50,
          brightness: 50,
          contrast: 50
        },
        createdAt: 0,
        expiresAt: Date.now() + 60_000,
        tasks: [{ taskId: "task-1", status: "complete", outputUrl: "/output" }]
      });
    render(<App />);

    await user.upload(screen.getByLabelText(/upload photos/i), pngFile);
    await user.click(screen.getByRole("button", { name: /enhance photos/i }));
    const retryButton = await screen.findByRole("button", { name: /retry/i });
    expect(screen.queryByRole("link", { name: /download/i })).not.toBeInTheDocument();
    await user.click(retryButton);

    expect(api.retryTask).toHaveBeenCalledWith("job-1", "task-1");
    expect(await screen.findByRole("link", { name: /download/i })).toHaveAttribute(
      "href",
      "/api/jobs/job-1/tasks/task-1/download?format=png"
    );
  });
});

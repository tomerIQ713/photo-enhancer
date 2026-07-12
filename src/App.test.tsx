import "@testing-library/jest-dom/vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { StrictMode } from "react";
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
const secondPngFile = new File(["second"], "landscape.png", { type: "image/png" });

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
        result: status.result,
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
    mockJobStatus({ status: "complete", result: { format: "png", size: 12, previewUrl: "/preview" } });
    render(<App />);

    await user.upload(screen.getByLabelText(/upload photos/i), pngFile);
    await user.click(screen.getByRole("button", { name: /enhance photos/i }));

    await waitFor(() => expect(api.createJob).toHaveBeenCalled());
    expect(api.createJob).toHaveBeenCalledWith(
      [pngFile],
      "auto",
      expect.objectContaining({ strength: 50 }),
      "png",
      expect.any(AbortSignal)
    );
    expect(await screen.findByText(/complete/i)).toBeVisible();
  });

  it("shows a before and after comparison when a task completes", async () => {
    const user = userEvent.setup();
    mockJobStatus({ status: "complete", result: { format: "png", size: 12, previewUrl: "/preview" } });
    render(<App />);

    await user.upload(screen.getByLabelText(/upload photos/i), pngFile);
    await user.click(screen.getByRole("button", { name: /enhance photos/i }));
    await waitFor(() => expect(api.getJob).toHaveBeenCalled());

    expect(await screen.findByRole("slider", { name: /before and after/i })).toBeVisible();
    expect(screen.getByAltText(/enhanced/i)).toHaveAttribute("src", "/preview");
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
        tasks: [{ taskId: "task-1", status: "complete", result: { format: "png", size: 12, previewUrl: "/preview" } }]
      });
    render(<App />);

    await user.upload(screen.getByLabelText(/upload photos/i), pngFile);
    await user.click(screen.getByRole("button", { name: /enhance photos/i }));
    const retryButton = await screen.findByRole("button", { name: /retry/i });
    expect(screen.queryByRole("link", { name: /download/i })).not.toBeInTheDocument();
    await user.click(retryButton);

    expect(api.retryTask).toHaveBeenCalledWith("job-1", "task-1", expect.any(AbortSignal));
    expect(await screen.findByRole("link", { name: /download/i })).toHaveAttribute(
      "href",
      "/api/jobs/job-1/tasks/task-1/download?format=png"
    );
  });

  it("accepts multiple files and drop interactions", async () => {
    const user = userEvent.setup();
    render(<App />);

    await user.upload(screen.getByLabelText(/upload photos/i), [pngFile, secondPngFile]);

    expect(screen.getByText("portrait.png")).toBeVisible();
    expect(screen.getByText("landscape.png")).toBeVisible();
    fireEvent.drop(screen.getByLabelText(/upload photos/i), {
      dataTransfer: { files: [pngFile] }
    });
    expect(screen.getByText("1 photo selected")).toBeVisible();
  });

  it("supports keyboard activation for the upload dropzone", async () => {
    const user = userEvent.setup();
    render(<App />);
    const dropzone = screen.getByText("Upload photos").closest("label");
    const input = screen.getByLabelText(/upload photos/i);
    const click = vi.spyOn(input, "click");

    dropzone?.focus();
    await user.keyboard("{Enter}");

    expect(dropzone).toHaveAttribute("tabindex", "0");
    expect(click).toHaveBeenCalledOnce();
  });

  it("submits selected preset and controls, then locks the submitted format", async () => {
    const user = userEvent.setup();
    mockJobStatus({ status: "processing" });
    render(<App />);

    await user.upload(screen.getByLabelText(/upload photos/i), pngFile);
    await user.click(screen.getByRole("button", { name: /upscale/i }));
    await user.selectOptions(screen.getByLabelText(/download format/i), "jpg");
    fireEvent.change(screen.getByRole("slider", { name: /enhancement strength/i }), {
      target: { value: "52" }
    });
    await user.click(screen.getByRole("button", { name: /enhance photos/i }));

    expect(api.createJob).toHaveBeenCalledWith(
      [pngFile],
      "upscale",
      expect.objectContaining({ strength: 52 }),
      "jpg",
      expect.any(AbortSignal)
    );
    expect(screen.getByLabelText(/download format/i)).toBeDisabled();
    expect(screen.getByLabelText(/download format/i)).toHaveValue("jpg");
  });

  it("aborts stale submission and resets submitting state when the session changes", async () => {
    const user = userEvent.setup();
    let resolveFirst: (value: { jobId: string; tasks: JobTask[] }) => void = () => undefined;
    vi.mocked(api.createJob).mockImplementationOnce(
      (...args) => new Promise((resolve) => {
        resolveFirst = resolve;
        expect(args[4]).toBeInstanceOf(AbortSignal);
      })
    );
    render(<App />);

    await user.upload(screen.getByLabelText(/upload photos/i), pngFile);
    await user.click(screen.getByRole("button", { name: /enhance photos/i }));
    expect(screen.getByRole("button", { name: /enhancing photos/i })).toBeDisabled();
    await user.upload(screen.getByLabelText(/upload photos/i), secondPngFile);

    expect(screen.getByRole("button", { name: /enhance photos/i })).toBeEnabled();
    resolveFirst({ jobId: "stale-job", tasks: [{ taskId: "stale-task", status: "queued" }] });
    await waitFor(() => expect(screen.queryByText(/stale-job/i)).not.toBeInTheDocument());
  });

  it("ignores a stale polling response after the selected session changes", async () => {
    const user = userEvent.setup();
    let resolveStatus: (value: Awaited<ReturnType<typeof api.getJob>>) => void = () => undefined;
    vi.mocked(api.getJob).mockImplementationOnce(() => new Promise((resolve) => {
      resolveStatus = resolve;
    }));
    render(<App />);

    await user.upload(screen.getByLabelText(/upload photos/i), pngFile);
    await user.click(screen.getByRole("button", { name: /enhance photos/i }));
    await waitFor(() => expect(api.getJob).toHaveBeenCalledWith("job-1", expect.any(AbortSignal)));
    await user.upload(screen.getByLabelText(/upload photos/i), secondPngFile);
    resolveStatus({
      jobId: "job-1", preset: "auto", controls: {
        strength: 50, sharpness: 50, noiseReduction: 50, brightness: 50, contrast: 50
      }, createdAt: 0, expiresAt: Date.now() + 60_000,
      tasks: [{ taskId: "stale-task", status: "complete", result: { format: "png", size: 1, previewUrl: "/stale" } }]
    });

    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(screen.queryByText("Complete")).not.toBeInTheDocument();
    expect(screen.getByText("landscape.png")).toBeVisible();
  });

  it("recovers from one transient polling failure with backoff", async () => {
    const user = userEvent.setup();
    vi.mocked(api.getJob)
      .mockRejectedValueOnce(new Error("temporary network error"))
      .mockResolvedValueOnce({
        jobId: "job-1", preset: "auto", controls: {
          strength: 50, sharpness: 50, noiseReduction: 50, brightness: 50, contrast: 50
        }, createdAt: 0, expiresAt: Date.now() + 60_000,
        tasks: [{ taskId: "task-1", status: "complete", result: { format: "png", size: 4, previewUrl: "/preview" } }]
      });
    render(<App />);

    await user.upload(screen.getByLabelText(/upload photos/i), pngFile);
    await user.click(screen.getByRole("button", { name: /enhance photos/i }));
    expect(await screen.findByText(/complete/i)).toBeVisible();
    expect(api.getJob).toHaveBeenCalledTimes(2);
  });

  it("shows failed task state, sanitized error, and keeps retry available", async () => {
    const user = userEvent.setup();
    mockJobStatus({ status: "failed", error: "Processing failed" });
    render(<App />);

    await user.upload(screen.getByLabelText(/upload photos/i), pngFile);
    await user.click(screen.getByRole("button", { name: /enhance photos/i }));

    expect(await screen.findByRole("alert")).toHaveTextContent("Processing failed");
    expect(screen.getByRole("button", { name: /retry/i })).toBeVisible();
    expect(screen.getByText("Failed")).toBeVisible();
  });

  it("uses the actual preview result and immutable submitted format", async () => {
    const user = userEvent.setup();
    mockJobStatus({ status: "complete", result: { format: "jpg", size: 42, previewUrl: "/api/jobs/job-1/tasks/task-1/preview" } });
    render(<App />);

    await user.upload(screen.getByLabelText(/upload photos/i), pngFile);
    await user.selectOptions(screen.getByLabelText(/download format/i), "jpg");
    await user.click(screen.getByRole("button", { name: /enhance photos/i }));

    expect(await screen.findByAltText(/enhanced/i)).toHaveAttribute("src", "/api/jobs/job-1/tasks/task-1/preview");
    expect(screen.getByRole("link", { name: /download/i })).toHaveAttribute(
      "href", "/api/jobs/job-1/tasks/task-1/download?format=jpg"
    );
    expect(screen.getByLabelText(/download format/i)).toBeDisabled();
  });

  it("creates and revokes original object URLs through the committed image lifecycle", async () => {
    const user = userEvent.setup();
    const createObjectURL = vi.fn(() => "blob:original");
    const revokeObjectURL = vi.fn();
    vi.stubGlobal("URL", { ...URL, createObjectURL, revokeObjectURL });
    mockJobStatus({ status: "processing" });
    const view = render(<StrictMode><App /></StrictMode>);

    await user.upload(screen.getByLabelText(/upload photos/i), pngFile);
    await user.click(screen.getByRole("button", { name: /enhance photos/i }));
    await waitFor(() => expect(createObjectURL).toHaveBeenCalledWith(pngFile));
    view.unmount();

    expect(revokeObjectURL).toHaveBeenCalledWith("blob:original");
    vi.unstubAllGlobals();
  });
});

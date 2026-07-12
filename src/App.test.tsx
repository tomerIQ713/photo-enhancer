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
      expect.any(AbortSignal),
      [expect.objectContaining({ strength: 50 })],
      expect.any(Function)
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

  it("shows an unavailable result state for a complete task without result metadata", async () => {
    const user = userEvent.setup();
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
      tasks: [{ taskId: "task-1", status: "complete" }]
    });
    render(<App />);

    await user.upload(screen.getByLabelText(/upload photos/i), pngFile);
    await user.click(screen.getByRole("button", { name: /enhance photos/i }));

    expect(await screen.findByRole("heading", { name: "Result unavailable or expired" })).toBeVisible();
    expect(screen.queryByRole("slider", { name: /before and after/i })).not.toBeInTheDocument();
    expect(screen.queryByAltText(/original/i)).not.toBeInTheDocument();
    expect(screen.queryByAltText(/enhanced/i)).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /download/i })).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /enhance another/i }));
    expect(screen.getByText("Drop images here or press Enter to browse")).toBeVisible();
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
    const retryButton = await screen.findByRole("button", { name: "Retry portrait.png" });
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
      expect.any(AbortSignal),
      [expect.objectContaining({ strength: 52 })],
      expect.any(Function)
    );
    expect(screen.getByLabelText(/download format/i)).toBeDisabled();
    expect(screen.getByLabelText(/download format/i)).toHaveValue("jpg");
  });

  it("aborts stale submission and resets submitting state when the session changes", async () => {
    const user = userEvent.setup();
    let resolveFirst: (value: { jobId: string; tasks: JobTask[] }) => void = () => undefined;
    let firstSignal: AbortSignal | undefined;
    vi.mocked(api.createJob).mockImplementationOnce(
      (...args) => new Promise((resolve) => {
        resolveFirst = resolve;
        firstSignal = args[4];
        expect(firstSignal).toBeInstanceOf(AbortSignal);
      })
    );
    render(<App />);

    await user.upload(screen.getByLabelText(/upload photos/i), pngFile);
    await user.click(screen.getByRole("button", { name: /enhance photos/i }));
    expect(screen.getByRole("button", { name: /enhancing photos/i })).toBeDisabled();
    await user.upload(screen.getByLabelText(/upload photos/i), secondPngFile);

    expect(firstSignal?.aborted).toBe(true);
    expect(screen.getByRole("button", { name: /enhance photos/i })).toBeEnabled();
    resolveFirst({ jobId: "stale-job", tasks: [{ taskId: "stale-task", status: "queued" }] });
    await waitFor(() => expect(screen.queryByText(/stale-job/i)).not.toBeInTheDocument());
  });

  it("aborts an in-flight submission when the component unmounts", async () => {
    let submitSignal: AbortSignal | undefined;
    vi.mocked(api.createJob).mockImplementationOnce((...args) => {
      submitSignal = args[4];
      return new Promise(() => undefined);
    });
    const view = render(<App />);
    const user = userEvent.setup();

    await user.upload(screen.getByLabelText(/upload photos/i), pngFile);
    await user.click(screen.getByRole("button", { name: /enhance photos/i }));
    view.unmount();

    expect(submitSignal?.aborted).toBe(true);
  });

  it("aborts an in-flight poll when the component unmounts", async () => {
    const user = userEvent.setup();
    let pollSignal: AbortSignal | undefined;
    vi.mocked(api.getJob).mockImplementationOnce((...args) => {
      pollSignal = args[1];
      return new Promise(() => undefined);
    });
    const view = render(<App />);

    await user.upload(screen.getByLabelText(/upload photos/i), pngFile);
    await user.click(screen.getByRole("button", { name: /enhance photos/i }));
    await waitFor(() => expect(api.getJob).toHaveBeenCalledWith("job-1", expect.any(AbortSignal)));
    view.unmount();

    expect(pollSignal?.aborted).toBe(true);
  });

  it("aborts an in-flight retry when the component unmounts", async () => {
    const user = userEvent.setup();
    let retrySignal: AbortSignal | undefined;
    mockJobStatus({ status: "failed", error: "Processing failed" });
    vi.mocked(api.retryTask).mockImplementationOnce((...args) => {
      retrySignal = args[2];
      return new Promise(() => undefined);
    });
    const view = render(<App />);

    await user.upload(screen.getByLabelText(/upload photos/i), pngFile);
    await user.click(screen.getByRole("button", { name: /enhance photos/i }));
    await user.click(await screen.findByRole("button", { name: "Retry portrait.png" }));
    view.unmount();

    expect(retrySignal?.aborted).toBe(true);
  });

  it("starts a new generation for a second submission and clears the old selection first", async () => {
    const user = userEvent.setup();
    let resolveSecond: (value: { jobId: string; tasks: JobTask[] }) => void = () => undefined;
    let firstPollSignal: AbortSignal | undefined;
    vi.mocked(api.createJob)
      .mockResolvedValueOnce({ jobId: "job-1", tasks: [{ taskId: "task-1", status: "queued" }] })
      .mockImplementationOnce((...args) => {
        expect(args[4]).toBeInstanceOf(AbortSignal);
        return new Promise((resolve) => { resolveSecond = resolve; });
      });
    vi.mocked(api.getJob).mockImplementationOnce((...args) => {
      firstPollSignal = args[1];
      return Promise.resolve({
        jobId: "job-1", preset: "auto", controls: {
          strength: 50, sharpness: 50, noiseReduction: 50, brightness: 50, contrast: 50
        }, createdAt: 0, expiresAt: Date.now() + 60_000,
        tasks: [{ taskId: "task-1", status: "complete", result: { format: "png", size: 1, previewUrl: "/old-preview" } }]
      });
    });
    render(<App />);

    await user.upload(screen.getByLabelText(/upload photos/i), pngFile);
    await user.click(screen.getByRole("button", { name: /enhance photos/i }));
    expect(await screen.findByAltText(/enhanced/i)).toHaveAttribute("src", "/old-preview");
    await user.click(screen.getByRole("button", { name: /enhance photos/i }));

    expect(firstPollSignal?.aborted).toBe(true);
    expect(screen.queryByAltText(/enhanced/i)).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /download/i })).not.toBeInTheDocument();
    resolveSecond({ jobId: "job-2", tasks: [{ taskId: "task-2", status: "queued" }] });
    await waitFor(() => expect(api.createJob).toHaveBeenCalledTimes(2));
  });

  it("ignores a stale polling response after the selected session changes", async () => {
    const user = userEvent.setup();
    let resolveStatus: (value: Awaited<ReturnType<typeof api.getJob>>) => void = () => undefined;
    let pollSignal: AbortSignal | undefined;
    vi.mocked(api.getJob).mockImplementationOnce((...args) => new Promise((resolve) => {
      pollSignal = args[1];
      resolveStatus = resolve;
    }));
    render(<App />);

    await user.upload(screen.getByLabelText(/upload photos/i), pngFile);
    await user.click(screen.getByRole("button", { name: /enhance photos/i }));
    await waitFor(() => expect(api.getJob).toHaveBeenCalledWith("job-1", expect.any(AbortSignal)));
    await user.upload(screen.getByLabelText(/upload photos/i), secondPngFile);
    expect(pollSignal?.aborted).toBe(true);
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

  it("shows Retry status after four polling failures and recovers after retrying status", async () => {
    const user = userEvent.setup();
    vi.mocked(api.getJob)
      .mockRejectedValueOnce(new Error("network 1"))
      .mockRejectedValueOnce(new Error("network 2"))
      .mockRejectedValueOnce(new Error("network 3"))
      .mockRejectedValueOnce(new Error("network 4"))
      .mockResolvedValueOnce({
        jobId: "job-1", preset: "auto", controls: {
          strength: 50, sharpness: 50, noiseReduction: 50, brightness: 50, contrast: 50
        }, createdAt: 0, expiresAt: Date.now() + 60_000,
        tasks: [{ taskId: "task-1", status: "complete", result: { format: "png", size: 1, previewUrl: "/preview" } }]
      });
    render(<App />);

    await user.upload(screen.getByLabelText(/upload photos/i), pngFile);
    await user.click(screen.getByRole("button", { name: /enhance photos/i }));
    const retryStatus = await screen.findByRole("button", { name: /retry status/i });
    await user.click(retryStatus);

    expect(await screen.findByText("Complete")).toBeVisible();
    expect(api.getJob).toHaveBeenCalledTimes(5);
  });

  it("shows failed task state, sanitized error, and keeps retry available", async () => {
    const user = userEvent.setup();
    mockJobStatus({ status: "failed", error: "Processing failed" });
    render(<App />);

    await user.upload(screen.getByLabelText(/upload photos/i), pngFile);
    await user.click(screen.getByRole("button", { name: /enhance photos/i }));

    expect(await screen.findByRole("alert")).toHaveTextContent("Processing failed");
    expect(screen.getByRole("button", { name: "Retry portrait.png" })).toBeVisible();
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

  it("revokes the selected object URL when the selected files change", async () => {
    const user = userEvent.setup();
    const createObjectURL = vi.fn(() => `blob:${createObjectURL.mock.calls.length}`);
    const revokeObjectURL = vi.fn();
    vi.stubGlobal("URL", { ...URL, createObjectURL, revokeObjectURL });
    mockJobStatus({ status: "processing" });
    render(<App />);

    await user.upload(screen.getByLabelText(/upload photos/i), pngFile);
    await user.click(screen.getByRole("button", { name: /enhance photos/i }));
    await waitFor(() => expect(createObjectURL).toHaveBeenCalledWith(pngFile));
    await user.upload(screen.getByLabelText(/upload photos/i), secondPngFile);

    expect(revokeObjectURL).toHaveBeenCalledWith("blob:1");
    vi.unstubAllGlobals();
  });

  it("prevents duplicate retry clicks while the first accepted retry is pending", async () => {
    const user = userEvent.setup();
    let resolveRetry: () => void = () => undefined;
    vi.mocked(api.getJob)
      .mockResolvedValueOnce({
        jobId: "job-1", preset: "auto", controls: {
          strength: 50, sharpness: 50, noiseReduction: 50, brightness: 50, contrast: 50
        }, createdAt: 0, expiresAt: Date.now() + 60_000,
        tasks: [{ taskId: "task-1", status: "failed", error: "Processing failed" }]
      })
      .mockResolvedValueOnce({
        jobId: "job-1", preset: "auto", controls: {
          strength: 50, sharpness: 50, noiseReduction: 50, brightness: 50, contrast: 50
        }, createdAt: 0, expiresAt: Date.now() + 60_000,
        tasks: [{ taskId: "task-1", status: "queued" }]
      });
    vi.mocked(api.retryTask).mockImplementationOnce(() => new Promise((resolve) => { resolveRetry = resolve; }));
    render(<App />);

    await user.upload(screen.getByLabelText(/upload photos/i), pngFile);
    await user.click(screen.getByRole("button", { name: /enhance photos/i }));
    const retryButton = await screen.findByRole("button", { name: "Retry portrait.png" });
    await user.click(retryButton);
    fireEvent.click(retryButton);

    expect(retryButton).toBeDisabled();
    expect(api.retryTask).toHaveBeenCalledTimes(1);
    resolveRetry();
    await waitFor(() => expect(screen.queryByRole("button", { name: "Retry portrait.png" })).not.toBeInTheDocument());
  });

  it("ignores a retry response that arrives after a new submission", async () => {
    const user = userEvent.setup();
    let resolveRetry: () => void = () => undefined;
    let retrySignal: AbortSignal | undefined;
    vi.mocked(api.getJob).mockResolvedValueOnce({
      jobId: "job-1", preset: "auto", controls: {
        strength: 50, sharpness: 50, noiseReduction: 50, brightness: 50, contrast: 50
      }, createdAt: 0, expiresAt: Date.now() + 60_000,
      tasks: [{ taskId: "task-1", status: "failed", error: "Processing failed" }]
    });
    vi.mocked(api.retryTask).mockImplementationOnce((...args) => new Promise((resolve) => {
      retrySignal = args[2];
      resolveRetry = resolve;
    }));
    vi.mocked(api.createJob)
      .mockResolvedValueOnce({ jobId: "job-1", tasks: [{ taskId: "task-1", status: "queued" }] })
      .mockResolvedValueOnce({ jobId: "job-2", tasks: [{ taskId: "task-2", status: "queued" }] });
    render(<App />);

    await user.upload(screen.getByLabelText(/upload photos/i), pngFile);
    await user.click(screen.getByRole("button", { name: /enhance photos/i }));
    await user.click(await screen.findByRole("button", { name: "Retry portrait.png" }));
    await user.click(screen.getByRole("button", { name: /enhance photos/i }));
    expect(retrySignal?.aborted).toBe(true);
    resolveRetry();

    await waitFor(() => expect(api.createJob).toHaveBeenCalledTimes(2));
    expect(screen.queryByRole("button", { name: "Retry portrait.png" })).not.toBeInTheDocument();
  });

  it("shows upload guidance and rejects an unsupported file before submission", async () => {
    const user = userEvent.setup();
    render(<App />);

    expect(screen.getByText(/JPEG, PNG, WebP, or AVIF/i)).toBeVisible();
    expect(screen.getByText(/25 million pixels/i)).toBeVisible();
    fireEvent.drop(screen.getByLabelText(/upload photos/i), {
      dataTransfer: { files: [new File(["gif"], "bad.gif", { type: "image/gif" })] }
    });

    expect(screen.getByRole("alert")).toHaveTextContent(/supported formats/i);
    expect(screen.queryByText("bad.gif")).not.toBeInTheDocument();
  });

  it("shows real upload progress while a job request is pending", async () => {
    const user = userEvent.setup();
    vi.mocked(api.createJob).mockImplementationOnce((...args) => {
      args[6]?.(42);
      return new Promise(() => undefined);
    });
    render(<App />);

    await user.upload(screen.getByLabelText(/upload photos/i), pngFile);
    await user.click(screen.getByRole("button", { name: /enhance photos/i }));
    expect(screen.getByText(/Uploading photos: 42%/i)).toBeVisible();
  });

  it("keeps per-image controls independent and sends them as a batch", async () => {
    const user = userEvent.setup();
    render(<App />);

    await user.upload(screen.getByLabelText(/upload photos/i), [pngFile, secondPngFile]);
    await user.click(screen.getByRole("button", { name: /landscape.png/i }));
    fireEvent.change(screen.getByRole("slider", { name: /enhancement strength/i }), {
      target: { value: "80" }
    });
    await user.click(screen.getByRole("button", { name: /enhance photos/i }));

    expect(api.createJob).toHaveBeenCalledWith(
      [pngFile, secondPngFile],
      "auto",
      expect.objectContaining({ strength: 50 }),
      "png",
      expect.any(AbortSignal),
      [
        expect.objectContaining({ strength: 50 }),
        expect.objectContaining({ strength: 80 })
      ],
      expect.any(Function)
    );
  });

  it("resets selected controls to the active preset defaults", async () => {
    const user = userEvent.setup();
    render(<App />);

    await user.upload(screen.getByLabelText(/upload photos/i), pngFile);
    fireEvent.change(screen.getByRole("slider", { name: /enhancement strength/i }), {
      target: { value: "93" }
    });
    await user.click(screen.getByRole("button", { name: /reset controls/i }));

    expect(screen.getByRole("slider", { name: /enhancement strength/i })).toHaveValue("50");
  });

  it("renders queue thumbnails, batch download, and zoom fit controls for completed results", async () => {
    const user = userEvent.setup();
    vi.mocked(api.getJob).mockResolvedValue({
      jobId: "job-1", preset: "auto", controls: {
        strength: 50, sharpness: 50, noiseReduction: 50, brightness: 50, contrast: 50
      }, createdAt: 0, expiresAt: Date.now() + 60_000,
      tasks: [
        { taskId: "task-1", status: "complete", result: { format: "png", size: 1, previewUrl: "/one" } },
        { taskId: "task-2", status: "complete", result: { format: "png", size: 1, previewUrl: "/two" } }
      ]
    });
    render(<App />);

    await user.upload(screen.getByLabelText(/upload photos/i), [pngFile, secondPngFile]);
    await user.click(screen.getByRole("button", { name: /enhance photos/i }));

    expect(await screen.findAllByAltText(/queue thumbnail/i)).toHaveLength(2);
    expect(screen.getByRole("button", { name: /download all 2 PNGs/i })).toBeVisible();
    expect(screen.getByRole("button", { name: /zoom in/i })).toBeVisible();
    expect(screen.getByRole("button", { name: /fit to view/i })).toBeVisible();
    await user.click(screen.getByRole("button", { name: /zoom in/i }));
    await user.click(screen.getByRole("button", { name: /fit to view/i }));
  });
});

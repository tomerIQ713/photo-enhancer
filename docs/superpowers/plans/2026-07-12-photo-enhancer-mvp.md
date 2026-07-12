# Photo Enhancer MVP Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a no-account web app that uses OpenRouter for image analysis and open-source image processing for faithful photo enhancement, upscaling, comparison, and download.

**Architecture:** Use a TypeScript monorepo-style application with a Vite React client and an Express processing API. The API keeps OpenRouter credentials server-side, stores temporary files locally, creates in-memory jobs for the MVP, and exposes a provider boundary between OpenRouter analysis and deterministic Sharp transformations. The client polls job status and renders a focused upload-to-comparison workbench.

**Tech Stack:** TypeScript, React, Vite, Express, Multer, Sharp, Zod, Vitest, React Testing Library, Supertest, Playwright, native `fetch`, and OpenRouter's OpenAI-compatible chat endpoint.

## Global Constraints

- Photos only; video is deferred.
- No accounts, saved projects, or editing history.
- Faithful enhancement only: preserve identity, composition, and original content.
- OpenRouter is the only paid service.
- Other processing uses free or open-source tools where practical.
- Batch processing is supported with a small cap to control cost.
- Enhancement quality is prioritized over speed, with transparent progress states.
- The OpenRouter API key must remain server-side.
- No raw image data, API keys, or full provider responses may be written to logs.
- Original files must remain untouched when processing fails.
- Temporary media and job metadata must be cleaned up after completion, failure, or expiration.
- Desktop uses a three-area workbench; tablet stacks preview above controls; mobile has no horizontal scrolling.

---

## File Map

### Project and configuration

- Create: `package.json` - workspace scripts and dependencies.
- Create: `tsconfig.json` - shared strict TypeScript settings.
- Create: `vite.config.ts` - client build and development proxy.
- Create: `vitest.config.ts` - unit and API test configuration.
- Create: `.env.example` - non-secret runtime configuration.
- Create: `.gitignore` - dependencies, builds, environment files, and temporary media.

### Server

- Create: `server/config.ts` - validated environment and limits.
- Create: `server/types.ts` - job, task, preset, parameter, and provider contracts.
- Create: `server/validation.ts` - file and request validation.
- Create: `server/processing/local-image-provider.ts` - Sharp-based transformations.
- Create: `server/processing/openrouter-provider.ts` - OpenRouter image analysis.
- Create: `server/processing/pipeline.ts` - provider coordination and output creation.
- Create: `server/jobs/job-store.ts` - in-memory job lifecycle and cleanup.
- Create: `server/jobs/process-job.ts` - task orchestration and status transitions.
- Create: `server/app.ts` - Express app, middleware, routes, and error mapping.
- Create: `server/index.ts` - HTTP server startup and cleanup timer.

### Client

- Create: `src/main.tsx` - React entry point.
- Create: `src/App.tsx` - workbench state orchestration.
- Create: `src/api.ts` - typed client API functions and polling.
- Create: `src/types.ts` - client-side API and UI types.
- Create: `src/components/UploadDropzone.tsx` - landing upload surface.
- Create: `src/components/FileQueue.tsx` - batch task list and retry actions.
- Create: `src/components/PresetControls.tsx` - presets and manual controls.
- Create: `src/components/ImagePreview.tsx` - selected image preview and comparison.
- Create: `src/components/DownloadActions.tsx` - JPG/PNG downloads and reset.
- Create: `src/styles.css` - responsive workbench styling.
- Create: `index.html` - Vite document shell.

### Tests and fixtures

- Create: `server/validation.test.ts` - upload and request validation tests.
- Create: `server/processing/pipeline.test.ts` - provider and output tests.
- Create: `server/jobs/job-store.test.ts` - job lifecycle and expiration tests.
- Create: `server/app.test.ts` - API route tests with mocked processing.
- Create: `src/App.test.tsx` - key client interaction tests.
- Create: `tests/e2e/photo-enhancer.spec.ts` - browser flow tests.
- Create: `tests/fixtures/sample.png` - small deterministic test image.

## Implementation Tasks

### Task 1: Scaffold the TypeScript application

**Files:**
- Create: `package.json`
- Create: `tsconfig.json`
- Create: `vite.config.ts`
- Create: `vitest.config.ts`
- Create: `.env.example`
- Create: `.gitignore`
- Create: `index.html`
- Create: `src/main.tsx`
- Create: `src/types.ts`

**Interfaces:**
- Produces the npm scripts `dev`, `build`, `test`, `test:e2e`, and `typecheck`.
- Produces strict TypeScript compilation for both `server/**/*.ts` and `src/**/*.ts`.

- [ ] **Step 1: Write the project files and scripts**

Use these scripts and dependencies:

```json
{
  "scripts": {
    "dev": "concurrently \"tsx watch server/index.ts\" \"vite\"",
    "build": "tsc --noEmit && vite build",
    "test": "vitest run",
    "test:e2e": "playwright test",
    "typecheck": "tsc --noEmit"
  }
}
```

Install runtime packages `express`, `multer`, `sharp`, `zod`, `react`, `react-dom`, and `dotenv`. Install development packages `typescript`, `tsx`, `vite`, `@vitejs/plugin-react`, `vitest`, `@testing-library/react`, `@testing-library/jest-dom`, `@testing-library/user-event`, `supertest`, `@types/express`, `@types/multer`, `@types/node`, `@types/react`, `@types/react-dom`, `concurrently`, `playwright`, and `jsdom`.

- [ ] **Step 2: Run the scaffold checks**

Run: `npm install`

Run: `npm run typecheck`

Expected: PASS after the empty entry files contain valid React and TypeScript exports.

- [ ] **Step 3: Commit the scaffold**

```bash
git add package.json package-lock.json tsconfig.json vite.config.ts vitest.config.ts .env.example .gitignore index.html src/main.tsx src/types.ts
git commit -m "chore: scaffold photo enhancer app"
```

### Task 2: Define limits, types, and validation

**Files:**
- Create: `server/config.ts`
- Create: `server/types.ts`
- Create: `server/validation.ts`
- Test: `server/validation.test.ts`

**Interfaces:**
- `Preset = "auto" | "upscale"`.
- `ManualControls = { strength: number; sharpness: number; noiseReduction: number; brightness: number; contrast: number }` with each value in `[0, 100]`.
- `EnhancementParameters` contains `scale`, `sharpen`, `denoise`, `brightness`, and `contrast` numeric values.
- `JobStore` and processing code consume `Job`, `ImageTask`, and `TaskStatus` types from `server/types.ts`.
- `validateUpload(file: { buffer: Buffer; mimetype: string; size: number }): Promise<ImageMetadata>` rejects unsupported or unsafe input.

- [ ] **Step 1: Write failing validation tests**

```ts
it("accepts a PNG within the configured limits", async () => {
  await expect(validateUpload(validPngFile)).resolves.toMatchObject({ format: "png" });
});

it("rejects a file whose content is not an image", async () => {
  await expect(validateUpload({ ...validPngFile, buffer: Buffer.from("not image") })).rejects.toThrow("Unsupported image");
});

it("rejects a batch larger than the configured cap", () => {
  expect(validateBatchSize(6)).toThrow("Maximum batch size is 5");
});
```

- [ ] **Step 2: Run the validation tests to verify failure**

Run: `npx vitest run server/validation.test.ts`

Expected: FAIL because validation functions do not yet exist.

- [ ] **Step 3: Implement configuration, types, and validation**

Use defaults of `MAX_FILE_BYTES=10485760`, `MAX_PIXELS=25000000`, `MAX_BATCH_SIZE=5`, `JOB_TTL_MS=3600000`, `OPENROUTER_TIMEOUT_MS=60000`, and `OPENROUTER_MODEL=google/gemini-2.5-flash` in `.env.example`. Use Sharp metadata to validate actual image content and accept JPEG, PNG, WebP, and AVIF.

- [ ] **Step 4: Run the validation tests to verify success**

Run: `npx vitest run server/validation.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit validation contracts**

```bash
git add server/config.ts server/types.ts server/validation.ts server/validation.test.ts .env.example
git commit -m "feat: add upload limits and validation"
```

### Task 3: Implement the image-processing providers

**Files:**
- Create: `server/processing/local-image-provider.ts`
- Create: `server/processing/openrouter-provider.ts`
- Create: `server/processing/pipeline.ts`
- Test: `server/processing/pipeline.test.ts`

**Interfaces:**
- `OpenRouterProvider.analyze(input: Buffer, preset: Preset, controls: ManualControls): Promise<EnhancementParameters>`.
- `LocalImageProvider.apply(input: Buffer, parameters: EnhancementParameters, outputFormat: OutputFormat): Promise<Buffer>`.
- `ProcessingPipeline.process(input: Buffer, preset: Preset, controls: ManualControls, outputFormat: OutputFormat): Promise<Buffer>`.

- [ ] **Step 1: Write failing provider tests**

```ts
it("uses safe local processing when OpenRouter returns valid parameters", async () => {
  const output = await pipeline.process(samplePng, "upscale", defaultControls, "png");
  const metadata = await sharp(output).metadata();
  expect(metadata.width).toBeGreaterThan(sampleWidth);
});

it("falls back to preset defaults when OpenRouter returns malformed JSON", async () => {
  mockOpenRouterResponse("not-json");
  await expect(pipeline.process(samplePng, "auto", defaultControls, "jpg")).resolves.toBeInstanceOf(Buffer);
});

it("never invokes generative editing for faithful mode", async () => {
  expect(openRouterRequestBody).toMatchObject({ response_format: { type: "json_object" } });
  expect(openRouterRequestBody.messages[1].content).toContain("preserve identity");
});
```

- [ ] **Step 2: Run tests to verify failure**

Run: `npx vitest run server/processing/pipeline.test.ts`

Expected: FAIL because the providers and pipeline do not yet exist.

- [ ] **Step 3: Implement `OpenRouterProvider`**

Use `fetch` against `https://openrouter.ai/api/v1/chat/completions` with `Authorization: Bearer ${OPENROUTER_API_KEY}`. Send a data URL image and a JSON-only instruction that asks for enhancement parameters, explicitly says to preserve identity and composition, and constrains every numeric field to a documented range. Parse the response with Zod; on timeout, non-2xx status, or malformed output, return preset defaults without logging the image or response body.

- [ ] **Step 4: Implement `LocalImageProvider` and `ProcessingPipeline`**

Use Sharp to normalize input orientation, apply brightness and contrast, apply bounded sharpen and median/noise reduction operations, resize with Lanczos for `upscale`, and encode JPG or PNG. Clamp all model-controlled values before passing them to Sharp. Preserve the original buffer and never overwrite it.

- [ ] **Step 5: Run tests to verify success**

Run: `npx vitest run server/processing/pipeline.test.ts`

Expected: PASS, including malformed OpenRouter responses and valid JPG/PNG output checks.

- [ ] **Step 6: Commit the processing layer**

```bash
git add server/processing server/processing/pipeline.test.ts
git commit -m "feat: add faithful image processing pipeline"
```

### Task 4: Add job storage, processing, cleanup, and API routes

**Files:**
- Create: `server/jobs/job-store.ts`
- Create: `server/jobs/process-job.ts`
- Create: `server/app.ts`
- Create: `server/index.ts`
- Test: `server/jobs/job-store.test.ts`
- Test: `server/app.test.ts`

**Interfaces:**
- `JobStore.create(files: StoredUpload[], preset: Preset, controls: ManualControls): Job`.
- `JobStore.get(id: string): Job | undefined`.
- `JobStore.markTask(id: string, taskId: string, update: TaskUpdate): void`.
- `JobStore.removeExpired(now: number): number`.
- `POST /api/jobs` consumes multipart field `files`, plus `preset`, `controls`, and `outputFormat`, and returns `{ jobId, tasks }`.
- `GET /api/jobs/:jobId` returns task statuses and temporary result metadata.
- `POST /api/jobs/:jobId/tasks/:taskId/retry` requeues one failed task.
- `GET /api/jobs/:jobId/tasks/:taskId/download?format=jpg|png` streams the generated output.

- [ ] **Step 1: Write failing store tests**

```ts
it("creates a queued task for every accepted file", () => {
  const job = store.create([uploadA, uploadB], "auto", defaultControls);
  expect(job.tasks.map(task => task.status)).toEqual(["queued", "queued"]);
});

it("removes expired jobs and their temporary files", () => {
  expect(store.removeExpired(expiredTimestamp)).toBe(1);
  expect(fs.existsSync(expiredPath)).toBe(false);
});
```

- [ ] **Step 2: Run store tests to verify failure**

Run: `npx vitest run server/jobs/job-store.test.ts`

Expected: FAIL because the job store does not exist.

- [ ] **Step 3: Implement `JobStore` and cleanup**

Store metadata in a `Map`, write temporary originals and outputs below `os.tmpdir()/photo-enhancer/<jobId>`, use `crypto.randomUUID()` for IDs, and make `removeExpired` idempotently delete directories and map entries. Do not store image buffers in the job metadata.

- [ ] **Step 4: Implement background task processing**

For each task, transition `queued -> analyzing -> processing -> complete` or `failed`. Invoke `ProcessingPipeline`, write the output, and retain the original path until the job expires. Start each task independently so one failure does not stop the rest of the batch. Retry resets only the selected failed task.

- [ ] **Step 5: Write failing API tests**

```ts
it("accepts a valid single-image upload and returns a job id", async () => {
  const response = await request(app).post("/api/jobs").attach("files", samplePath).field("preset", "auto");
  expect(response.status).toBe(202);
  expect(response.body.jobId).toEqual(expect.any(String));
});

it("rejects an oversized or unsupported upload", async () => {
  const response = await request(app).post("/api/jobs").attach("files", textFilePath);
  expect(response.status).toBe(400);
});
```

- [ ] **Step 6: Implement `server/app.ts` and `server/index.ts`**

Use Multer memory storage only for the request boundary, then immediately write accepted buffers to the job directory. Validate all request fields with Zod, return `202` for accepted jobs, `400` for validation errors, `404` for unknown jobs/tasks, and `410` for expired results. Add a cleanup interval using `JOB_TTL_MS`, and clear it during server shutdown.

- [ ] **Step 7: Run API tests to verify success**

Run: `npx vitest run server/jobs/job-store.test.ts server/app.test.ts`

Expected: PASS for upload, status, retry, download, validation errors, and expiration behavior.

- [ ] **Step 8: Commit the server API**

```bash
git add server/jobs server/app.ts server/index.ts server/jobs/job-store.test.ts server/app.test.ts
git commit -m "feat: add photo processing jobs API"
```

### Task 5: Build the responsive client workbench

**Files:**
- Create: `src/api.ts`
- Create: `src/App.tsx`
- Create: `src/components/UploadDropzone.tsx`
- Create: `src/components/FileQueue.tsx`
- Create: `src/components/PresetControls.tsx`
- Create: `src/components/ImagePreview.tsx`
- Create: `src/components/DownloadActions.tsx`
- Create: `src/styles.css`
- Test: `src/App.test.tsx`

**Interfaces:**
- `createJob(files: File[], preset: Preset, controls: ManualControls, outputFormat: OutputFormat): Promise<JobSummary>`.
- `getJob(jobId: string): Promise<JobStatus>`.
- `retryTask(jobId: string, taskId: string): Promise<void>`.
- `getDownloadUrl(jobId: string, taskId: string, format: OutputFormat): string`.
- Components receive typed props from `src/types.ts` and do not call `fetch` directly.

- [ ] **Step 1: Write failing client tests**

```tsx
it("shows both presets after a file is selected", async () => {
  render(<App />);
  await user.upload(screen.getByLabelText(/upload photos/i), pngFile);
  expect(screen.getByRole("button", { name: /auto enhance/i })).toBeVisible();
  expect(screen.getByRole("button", { name: /upscale/i })).toBeVisible();
});

it("shows a before and after comparison when a task completes", async () => {
  mockJobStatus({ status: "complete", originalUrl: "/original", outputUrl: "/output" });
  render(<App />);
  expect(await screen.findByRole("slider", { name: /before and after/i })).toBeVisible();
});
```

- [ ] **Step 2: Run client tests to verify failure**

Run: `npx vitest run src/App.test.tsx`

Expected: FAIL because the workbench components do not exist.

- [ ] **Step 3: Implement API client and upload state**

Keep job state in `App.tsx`. On submit, call `createJob`, then poll `getJob` every 1000ms until all tasks are complete or failed. Stop polling on unmount. Keep selected task and controls local to the current temporary session.

- [ ] **Step 4: Implement upload, queue, controls, preview, and downloads**

Use accessible labels and buttons. The dropzone must support keyboard activation and multiple files. The comparison slider must be a native range input with `aria-label="Before and after comparison"`; render the original as the base image and clip the enhanced image based on the range value. Show per-task retry buttons and download buttons only for completed tasks.

- [ ] **Step 5: Implement responsive styling**

Use neutral surfaces, a restrained accent color, strong preview contrast, and no gradients. Use CSS grid for desktop's queue/preview/controls layout, switch to preview-first tablet layout at `max-width: 960px`, and stack all areas at `max-width: 640px`. Ensure images use `max-width: 100%` and never cause horizontal overflow.

- [ ] **Step 6: Run client tests to verify success**

Run: `npx vitest run src/App.test.tsx`

Expected: PASS for upload, preset selection, polling, completed comparison, retry, and download rendering.

- [ ] **Step 7: Commit the client workbench**

```bash
git add src
git commit -m "feat: add photo enhancement workbench"
```

### Task 6: Add browser coverage and verify the complete MVP

**Files:**
- Create: `tests/e2e/photo-enhancer.spec.ts`
- Create: `tests/fixtures/sample.png`
- Modify: `package.json`
- Modify: `playwright.config.ts`

**Interfaces:**
- Browser tests use the running Vite client and a test API handler that returns deterministic completed jobs without making OpenRouter requests.

- [ ] **Step 1: Write the end-to-end flow**

```ts
test("uploads, enhances, compares, and downloads a photo", async ({ page }) => {
  await page.goto("/");
  await page.getByLabel(/upload photos/i).setInputFiles("tests/fixtures/sample.png");
  await page.getByRole("button", { name: /auto enhance/i }).click();
  await expect(page.getByRole("slider", { name: /before and after/i })).toBeVisible();
  await expect(page.getByRole("link", { name: /download png/i })).toBeVisible();
});
```

- [ ] **Step 2: Configure Playwright and deterministic test mode**

Start the API and Vite server through Playwright's `webServer` configuration. Use `E2E_FAKE_PROCESSING=true` to bypass OpenRouter and return a fixture output from the same pipeline boundary. Do not put a real API key in test files or CI configuration.

- [ ] **Step 3: Add failure recovery and responsive checks**

Cover an invalid file error, a failed task with retry, and viewport sizes `1440x900`, `900x1000`, and `390x844`. Assert that the page has no horizontal overflow at each viewport.

- [ ] **Step 4: Run the complete verification suite**

Run:

```bash
npm run typecheck
npm test
npm run build
npm run test:e2e
```

Expected: all commands pass, the production client builds, and browser coverage passes without a paid API call.

- [ ] **Step 5: Inspect the final repository state**

Run: `git status --short --branch`

Expected: only intentionally uncommitted changes, if any; no `.env`, temporary uploads, build output, or test artifacts.

- [ ] **Step 6: Commit the verification coverage**

```bash
git add tests package.json playwright.config.ts
git commit -m "test: verify photo enhancer user flows"
```

## Plan Self-Review

- Product scope is covered by Tasks 4 and 5: no-account upload, single and batch jobs, presets, manual controls, comparison, downloads, and temporary cleanup.
- OpenRouter-only-paid-service and server-side key protection are covered by Tasks 2, 3, and 4.
- Faithful enhancement and fallback behavior are covered by Task 3 provider tests and the local Sharp pipeline.
- Responsive desktop, tablet, and mobile behavior is covered by Task 5 styling and Task 6 browser checks.
- Error handling, retries, malformed provider output, expiration, and cleanup are covered by Tasks 3, 4, and 6.
- No unresolved placeholders or ambiguous function names remain in the plan.
- The plan deliberately defers video, accounts, subscriptions, GPU hosting, and creative restoration as specified.

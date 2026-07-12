# Task 6 Report

## Status

DONE_WITH_CONCERNS

Commit: `776581c` (`test: verify photo enhancer user flows`)

## Files

- `playwright.config.ts`: starts the API and Vite client through Playwright `webServer`; sets `E2E_FAKE_PROCESSING=true` for the API process.
- `tests/e2e/photo-enhancer.spec.ts`: covers upload, enhancement, comparison, download, invalid-file handling, failed-task retry, and overflow checks at all required viewports.
- `tests/fixtures/sample.png`: deterministic 32x24 PNG upload fixture.
- `package.json`: keeps Vitest from collecting Playwright specs and points `test:e2e` at the checked-in config.
- `server/processing/openrouter-provider.ts`: returns preset parameters immediately in E2E fake mode, so the normal local Sharp pipeline runs without an OpenRouter request.

## Commands And Results

- `npm run typecheck`: PASS.
- `npm test`: PASS, 6 Vitest suites and 64 tests.
- `npm run build`: PASS, TypeScript check and Vite production build completed.
- `npm run test:e2e`: PASS, 6 Playwright tests using one worker.
- `git diff --cached --check`: PASS before commit.
- `git status --short --branch`: clean after commit before this ignored report was written; no `.env`, temporary uploads, build output, or test artifacts were staged.

## Self-Review

- Browser tests use the running Vite client and API server rather than mocking the application client.
- The normal upload validation, job creation, polling, local image processing, preview response, and download response are exercised by the main flow and viewport tests.
- No OpenRouter API key or other secret was added. The API process receives `E2E_FAKE_PROCESSING=true` from Playwright and exits the provider before any upstream request.
- The invalid-file test sends invalid image bytes with an image MIME type and verifies the user-facing API error.
- The retry test controls only the browser-visible status/retry responses so the client sees a deterministic failure followed by completion; the real retry endpoint and server behavior remain covered by the existing API/unit suite.
- The Vitest command explicitly excludes `tests/e2e/**` because Vitest otherwise collects the Playwright spec as a unit suite.

## Concerns

- The browser retry test does not force a real processing failure inside the server. It uses Playwright routing to make the first status response failed and the retry response queued, which isolates and verifies the browser recovery path without adding a product-only failure switch. Existing server/API tests cover the actual retry endpoint.
- Fake processing returns deterministic preset parameters and lets the real local Sharp provider create the output from the fixture; it is not a pre-rendered static output file.

## Review Fixes

Fix commit: `d46630f` (`test: harden Task 6 E2E isolation`)

### Changes

- Set both Playwright `webServer` entries to `reuseExistingServer: false`; E2E always starts fresh API and Vite processes on the dedicated ports.
- Forced `E2E_FAKE_PROCESSING=true` and an empty `OPENROUTER_API_KEY` into the API web-server environment so local environment state cannot cause a paid provider request during E2E.
- Added a server-side first-attempt failure flag that is enabled only when both `E2E_FAKE_PROCESSING=true` and the explicit `x-e2e-retry: true` test header are present. The first queued task fails in `JobProcessor`; the browser then calls the real retry endpoint and the retry runs the actual local pipeline.
- Replaced browser status/retry route stubbing with the real API flow and asserted the real retry response is `202`.
- Strengthened download coverage with the exact download URL through Playwright's API request context, asserting status `200`, `image/png`, a non-empty response body, no browser download failure, and the suggested filename.
- Added server API coverage for fake-mode first failure followed by real retry completion; the first attempt makes zero pipeline calls and the retry makes one.

### Verification

- `npx playwright test`: PASS, 6 tests.
- The first strengthened download assertion run exposed a browser-specific limitation: Chromium's download request was not emitted through `page.waitForResponse`; the assertion was corrected to use the exact endpoint through Playwright's API request context while retaining the real browser download event.
- `npm run typecheck`: PASS.
- `npm test`: PASS, 6 suites and 65 tests.
- `npm run build`: PASS.
- `npm run test:e2e`: PASS, 6 tests.
- RED/GREEN evidence: the new fake-mode API test failed before the server mechanism (`complete` instead of `failed`) and passed after the guarded queue flag was implemented.

### Fix Self-Review

- The retry browser test sends a real upload request, observes a real failed status from the API, sends a real `POST /retry`, and observes completion from real subsequent polling.
- The test-only failure header is ignored unless `E2E_FAKE_PROCESSING` is exactly `true`, so normal production requests cannot activate it.
- Existing non-E2E processing behavior remains unchanged; the fake-mode provider guard still prevents OpenRouter access.
- No secrets, plan/design documents, or generated artifacts were added.

## Final Whole-Branch Fix Wave

### Status

DONE_WITH_CONCERNS

Completed the approved final review fixes without modifying the approved design or implementation plan.

### Changed Files

- `.env.example`: documents anonymous admission, queue, and temporary-storage limits.
- `server/admission.ts`: bounded in-memory client-IP rate limiter with bounded tracked keys.
- `server/config.ts`: configurable admission and rate-limit defaults.
- `server/app.ts`: rate-limit and capacity admission before Multer storage, per-image controls parsing, safe 503 mapping, atomic active-job lookup, and `Cache-Control: no-store, private` for API responses.
- `server/jobs/job-store.ts`: bounded job/task/storage admission, per-task controls, bounded expiration tombstones, retryable failed-initial-storage cleanup, and periodic UUID-only stale-directory sweeping.
- `server/jobs/process-job.ts`: passes per-image controls into processing.
- `server/processing/openrouter-provider.ts`: bounded retry/backoff for network/429/5xx failures under one deadline and deterministic manual-control merging with clamped parameters.
- `server/processing/local-image-provider.ts`: keeps bounded denoise operations valid for small images.
- `server/processing/pipeline.ts`: applies merged controls before the local provider.
- `server/types.ts`: carries optional controls on image tasks.
- `server/app.test.ts`: admission, per-image controls, cache headers, expiration tombstones, and safe error regression coverage.
- `server/jobs/job-store.test.ts`: storage capacity and current-process orphan cleanup coverage.
- `server/processing/pipeline.test.ts`: fallback control influence/clamping, retry/backoff, and malformed-success non-retry coverage.
- `src/api.ts`: XMLHttpRequest upload progress and per-image control payload support.
- `src/App.tsx`: upload progress, independent per-image controls, preset reset, batch download preparation, and selected-image state.
- `src/components/UploadDropzone.tsx`: pre-upload format/size/pixel guidance and client validation.
- `src/components/FileQueue.tsx`: queue thumbnails and selectable queued-image controls.
- `src/components/PresetControls.tsx`: reset-to-preset action.
- `src/components/ImagePreview.tsx`: zoom and fit-to-view controls.
- `src/components/DownloadActions.tsx`: sequential batch download action explicitly labeled as one-at-a-time.
- `src/styles.css`: thumbnail, progress, zoom, batch-action, and mobile styling without gradients or horizontal overflow.
- `src/types.ts`: per-task control typing.
- `src/App.test.tsx`: client coverage for validation guidance, progress, independent controls, reset, thumbnails, batch action, zoom, and fit controls.

### Requirement-to-Test Mapping

- Anonymous admission controls: `server/app.test.ts` covers socket-IP rate limiting without trusting `x-forwarded-for`, 503 tracked-job capacity, and `server/jobs/job-store.test.ts` covers temporary-storage rejection before job creation.
- Deterministic fallback controls: `server/processing/pipeline.test.ts` proves different validated controls produce different fallback bytes and verifies clamped merged parameters; `server/app.test.ts` proves per-image controls reach independent queued tasks.
- OpenRouter retry contract: `server/processing/pipeline.test.ts` covers retry and success after 503, no retry after malformed successful JSON, and the existing timeout/non-success coverage remains green.
- Temporary response privacy: `server/app.test.ts` asserts `Cache-Control: no-store, private` for status, preview, and download responses.
- Orphan cleanup: `server/jobs/job-store.test.ts` proves a failed initial cleanup is retried by the current process, while the existing startup UUID-only stale sweep test protects recent/unrelated directories.
- Workbench capabilities: `src/App.test.tsx` covers supported-format guidance and client rejection, upload progress, per-image controls, preset reset, queue thumbnails, sequential batch-download action, zoom, and fit-to-view controls.
- Expiration race: `server/app.test.ts` covers an active job removed before status lookup mapping consistently to 410; bounded tombstone lifecycle remains covered by `server/jobs/job-store.test.ts`.
- Existing protections: full server processing/API suites and the six browser tests continue to cover original preservation, bounded Sharp processing/concurrency, safe download paths, cleanup, fake E2E mode, and no provider-response exposure.

### Commands And Actual Results

- `npm test`: PASS, 6 Vitest suites and 80 tests.
- `npm run typecheck`: PASS, `tsc --noEmit` exited 0.
- `npm run build`: PASS, TypeScript check completed and Vite produced `dist/assets/index-Dmcei3d3.js` and `dist/assets/index-DwVbDrWO.css`.
- `npm run test:e2e`: PASS, 6 Playwright tests using one worker; upload/download, invalid upload, retry, and 1440x900, 900x1000, and 390x844 overflow flows passed.
- `git diff --check`: PASS, no whitespace errors; Git emitted only Windows LF-to-CRLF working-copy warnings.

### Self-Review

- The default client-IP key uses Express `request.ip` with `trust proxy` explicitly disabled, so arbitrary forwarded headers do not select a limiter bucket.
- Admission is checked before Multer's in-memory upload handler for rate and tracked-job/task capacity; the storage budget is checked atomically before a job directory is created and reserves the configured output bound conservatively.
- Failed storage cleanup preserves the original failure, records the UUID directory for current-process retries, and periodically sweeps only stale UUID directories; recent active-looking directories and unrelated names are not swept.
- Active status/preview/download lookup uses the store's synchronous tombstone-aware path rather than a separate get-then-expire check.
- OpenRouter retries are limited to two retries, only for network/429/5xx failures, and share the timeout controller; successful malformed JSON returns the safe fallback immediately.
- No new logging was added. The provider still does not log image data, API keys, or response bodies.
- Upload progress uses `XMLHttpRequest.upload.onprogress`; polling and session-generation cancellation remain guarded.
- Batch download deliberately uses sequential browser downloads and says so in the control label; no ZIP dependency or server archive was added.
- Client pixel validation uses `createImageBitmap` where supported, while server-side Sharp validation remains authoritative.
- Design and plan documents were not changed.

### Residual Concerns

- Admission state is intentionally process-local for this in-memory MVP; multiple server processes would need a shared limiter/store before deployment behind a load balancer.
- The temporary-storage reservation includes the maximum configured output bytes for every task, so capacity can be conservative until job expiration cleanup releases it.
- The full suite uses mocked OpenRouter responses and fake E2E mode; live provider credentials were not used or tested in this environment.

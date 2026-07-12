# Photo Enhancer Web App Design

## Product Scope

The MVP is a no-account web app for everyday users and social-media creators who want to improve photos without learning professional editing software.

The core flow is:

1. Upload one photo or a small batch.
2. Show thumbnails and upload progress.
3. Choose `Auto Enhance` or `Upscale`.
4. Adjust a small set of manual controls.
5. Process each image through the cloud pipeline.
6. Show an interactive before/after comparison.
7. Download each result as JPG or PNG.
8. Delete temporary source and output files after a short retention period.

### MVP Boundaries

- Photos only; video is deferred.
- No accounts, saved projects, or editing history.
- Faithful enhancement only: preserve identity, composition, and original content.
- OpenRouter is the only paid service.
- Other processing uses free or open-source tools where practical.
- Batch processing is supported with a small cap to control cost.
- Enhancement quality is prioritized over speed, with transparent progress states.
- The app must not assume every OpenRouter model can output transformed images.

## Architecture

The app uses a thin web client and a server-side processing layer so the OpenRouter key is never exposed in the browser.

### Frontend

- Upload area supporting drag-and-drop, file picker, and multi-select
- Queue showing each file's state: waiting, analyzing, processing, complete, or failed
- Preset selection for `Auto Enhance` and `Upscale`
- Manual controls revealed after a preset is chosen
- Before/after comparison slider
- Per-image download and batch download actions

### Server

- Receives uploads and validates type, dimensions, file size, and batch count
- Stores files temporarily using generated job and file IDs
- Sends image data and enhancement instructions to OpenRouter
- Tracks processing status for each image
- Applies deterministic operations such as resizing, sharpening, color correction, and format conversion using open-source tooling
- Deletes source files and generated outputs after the retention window
- Returns only job status and temporary download URLs to the browser

### Processing Abstraction

The enhancement engine has a provider boundary:

- `OpenRouterProvider` analyzes the image, selects parameters, and uses a capable image model when available.
- `LocalImageProvider` applies safe, faithful transformations through open-source tooling.
- `ProcessingPipeline` decides which provider operations are safe for the selected preset and combines their results.

This allows OpenRouter to be used immediately without hard-coding the app around one model's capabilities. If a selected OpenRouter model supports image-to-image output, it can be enabled through configuration. If it does not, the app still has a functional enhancement path through deterministic image operations.

The initial architecture is one web app, one processing API, temporary file storage, and one OpenRouter integration. A separate queue or worker can be added later if processing volume makes in-process jobs unreliable.

### Cost and Security Controls

- Keep the OpenRouter API key server-side.
- Set small batch and file-size limits.
- Set maximum pixel dimensions.
- Bound request timeouts and retries.
- Clean up temporary files on success, failure, and expiration.
- Do not put raw image data in application logs.

## User Experience and States

The interface is a focused workbench rather than a dashboard.

### Landing State

- Clear headline focused on improving photos in a few steps
- Large drag-and-drop upload surface
- Secondary file-picker button
- Short privacy note explaining that files are temporary and no account is required
- Supported formats and limits shown before upload

### Editing State

- Desktop layout with image queue on the left, selected preview in the center, and controls on the right
- Preset cards for `Auto Enhance` and `Upscale`
- Manual controls kept intentionally small:
  - Enhancement strength
  - Sharpness
  - Noise reduction
  - Brightness
  - Contrast
- Reset control returns to preset defaults
- Batch users can apply a preset to all queued images and adjust individual images

### Processing State

- Per-image progress indicators
- Overall batch progress
- Status text such as `Analyzing image` and `Applying enhancement`
- The interface remains usable while other images process
- Failed items can be retried individually without restarting the batch

### Comparison State

- Before/after slider with keyboard-accessible controls
- Zoom and fit-to-view controls
- Original and enhanced labels
- Download buttons for JPG and PNG
- `Enhance another` action clears the temporary session

### Error States

- Unsupported format: explain accepted formats.
- File too large: show the limit and suggest resizing.
- Processing failure: preserve the original preview and offer retry.
- OpenRouter failure: show a service-unavailable message without exposing provider details.
- Expired result: explain that temporary files were removed and offer a fresh upload.

### Responsive Behavior

- Desktop: three-area workbench
- Tablet: preview above controls
- Mobile: stacked upload queue, preview, controls, and comparison with no horizontal scrolling

The visual direction is practical and image-led: neutral surfaces, strong contrast around the preview, a restrained accent color, and no decorative gradients competing with the photos.

## Data Flow

1. The browser validates obvious file issues before upload.
2. The server creates a temporary job and returns an ID.
3. Each file receives a child task within the job.
4. The server stores the original temporarily and records only metadata needed for processing.
5. OpenRouter receives the image plus structured instructions based on the selected preset and controls.
6. The server validates the model response before using it.
7. Deterministic processing applies the approved enhancement parameters and creates the output.
8. The browser receives status updates and a temporary download URL.
9. Cleanup removes originals, outputs, and job metadata after completion or expiration.

## Reliability and Error Handling

- Validate MIME type from file content, not only the filename.
- Reject oversized files and excessive image dimensions before processing.
- Use unique, non-guessable job and file IDs.
- Treat malformed model output as a recoverable processing failure.
- Use bounded OpenRouter retries and request duration.
- Keep original files untouched so a failed enhancement never destroys the source.
- Make cleanup idempotent so it is safe to run repeatedly.
- Avoid logging image contents, API keys, or full provider responses.

## Testing Strategy

- Unit tests for upload validation, preset-to-parameter mapping, output validation, cleanup, and retry behavior
- Provider tests using mocked OpenRouter responses, including malformed and unavailable responses
- Image pipeline tests using small fixture images and checks for dimensions, format, and output creation
- API tests for upload, job status, retry, download, and expiration behavior
- Browser tests for single upload, batch upload, preset selection, comparison slider, downloads, and failure recovery
- Responsive smoke tests at desktop, tablet, and mobile viewport sizes
- Manual visual review against representative portrait, low-light, noisy, and already-high-quality photos

## Success Criteria

- A user can enhance one image without creating an account.
- A user can process a small batch without blocking on unrelated files.
- Every completed result can be compared with its original and downloaded.
- The system never exposes the OpenRouter key.
- The faithful-enhancement path works even when the selected OpenRouter model cannot return transformed image data.
- Temporary media is removed reliably.
- The interface remains understandable on mobile and desktop.

## Deferred Scope

- Video enhancement
- User accounts and persistent projects
- Editing history and cloud galleries
- Professional batch controls
- Paid subscriptions or billing
- Self-hosted GPU models
- Advanced generative restoration or creative filters

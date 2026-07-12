import type { ManualControls, OutputFormat, Preset, UpscaleMode } from "../types";
import { LocalImageProvider } from "./local-image-provider";
import { mergeManualControls, OpenRouterProvider } from "./openrouter-provider";

export class ProcessingPipeline {
  constructor(
    private readonly openRouterProvider = new OpenRouterProvider(),
    private readonly localImageProvider = new LocalImageProvider()
  ) {}

  async process(
    input: Buffer,
    preset: Preset,
    controls: ManualControls,
    outputFormat: OutputFormat,
    upscaleMode: UpscaleMode = "classic"
  ): Promise<Buffer> {
    if (preset === "upscale" && upscaleMode === "ai") {
      const aiResult = await this.openRouterProvider.enhanceImage(input, controls);
      if (aiResult) {
        return this.localImageProvider.normalize(aiResult, outputFormat);
      }
    }

    const parameters = await this.openRouterProvider.analyze(
      input,
      preset,
      controls
    );
    return this.localImageProvider.apply(
      input,
      mergeManualControls(parameters, controls, preset),
      outputFormat
    );
  }
}

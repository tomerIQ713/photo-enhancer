import type { ManualControls, OutputFormat, Preset } from "../types";
import { LocalImageProvider } from "./local-image-provider";
import { OpenRouterProvider } from "./openrouter-provider";

export class ProcessingPipeline {
  constructor(
    private readonly openRouterProvider = new OpenRouterProvider(),
    private readonly localImageProvider = new LocalImageProvider()
  ) {}

  async process(
    input: Buffer,
    preset: Preset,
    controls: ManualControls,
    outputFormat: OutputFormat
  ): Promise<Buffer> {
    const parameters = await this.openRouterProvider.analyze(
      input,
      preset,
      controls
    );
    return this.localImageProvider.apply(input, parameters, outputFormat);
  }
}

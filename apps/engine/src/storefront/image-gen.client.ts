import { randomInt, randomUUID } from 'node:crypto';
import { ProblemException } from '../common/problem';

export interface ImageGenConfig {
  url: string;
  checkpoint: string;
  timeoutMs: number;
}

/**
 * A plain txt2img graph keyed by node id, the shape ComfyUI's /prompt API
 * takes. 1152x512 is the banner band's aspect; 20 steps is plenty for a
 * background that sits under a scrim and copy.
 */
function buildWorkflow(prompt: string, checkpoint: string): Record<string, unknown> {
  return {
    '1': { class_type: 'CheckpointLoaderSimple', inputs: { ckpt_name: checkpoint } },
    '2': { class_type: 'CLIPTextEncode', inputs: { clip: ['1', 1], text: prompt } },
    '3': {
      class_type: 'CLIPTextEncode',
      inputs: { clip: ['1', 1], text: 'text, watermark, logo, low quality' },
    },
    '4': { class_type: 'EmptyLatentImage', inputs: { width: 1152, height: 512, batch_size: 1 } },
    '5': {
      class_type: 'KSampler',
      inputs: {
        model: ['1', 0],
        positive: ['2', 0],
        negative: ['3', 0],
        latent_image: ['4', 0],
        seed: randomInt(0, 2 ** 31),
        steps: 20,
        cfg: 7,
        sampler_name: 'euler',
        scheduler: 'normal',
        denoise: 1,
      },
    },
    '6': { class_type: 'VAEDecode', inputs: { samples: ['5', 0], vae: ['1', 2] } },
    '7': { class_type: 'SaveImage', inputs: { images: ['6', 0], filename_prefix: 'banner' } },
  };
}

const unavailable = (detail: string) =>
  new ProblemException('image-gen-unavailable', 503, 'Image generation is unavailable', detail);

interface HistoryImage {
  filename: string;
  subfolder: string;
  type: string;
}

export class ImageGenClient {
  constructor(private readonly config: ImageGenConfig) {}

  /** Submit, poll to completion, fetch the PNG bytes. Every failure is one 503. */
  async generate(prompt: string): Promise<Buffer> {
    const deadline = Date.now() + this.config.timeoutMs;

    const submitted = await this.request('POST', '/prompt', {
      prompt: buildWorkflow(prompt, this.config.checkpoint),
      client_id: randomUUID(),
    });
    const promptId = (submitted as { prompt_id?: string }).prompt_id;
    if (!promptId) throw unavailable('ComfyUI accepted the job but returned no prompt id');

    const image = await this.poll(promptId, deadline);

    const query = new URLSearchParams({
      filename: image.filename,
      subfolder: image.subfolder,
      type: image.type,
    });
    const res = await this.fetch(`/view?${query}`);
    return Buffer.from(await res.arrayBuffer());
  }

  private async poll(promptId: string, deadline: number): Promise<HistoryImage> {
    for (;;) {
      if (Date.now() > deadline) throw unavailable('render timed out');
      const history = (await this.request('GET', `/history/${promptId}`)) as Record<
        string,
        { outputs?: Record<string, { images?: HistoryImage[] }> }
      >;
      const outputs = history[promptId]?.outputs;
      if (outputs) {
        const image = Object.values(outputs).flatMap((node) => node.images ?? [])[0];
        if (!image) throw unavailable('render finished without an image output');
        return image;
      }
      await new Promise((resolve) => setTimeout(resolve, 2000));
    }
  }

  private async request(method: string, path: string, body?: unknown): Promise<unknown> {
    const res = await this.fetch(path, method, body);
    return res.json();
  }

  private async fetch(path: string, method = 'GET', body?: unknown): Promise<Response> {
    let res: Response;
    try {
      res = await fetch(`${this.config.url}${path}`, {
        method,
        ...(body === undefined
          ? {}
          : { headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }),
        signal: AbortSignal.timeout(this.config.timeoutMs),
      });
    } catch (err) {
      throw unavailable((err as Error).message);
    }
    if (!res.ok) throw unavailable(`${res.status} for ${path}`);
    return res;
  }
}

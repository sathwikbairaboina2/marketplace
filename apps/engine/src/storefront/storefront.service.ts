import { Injectable } from '@nestjs/common';
import {
  BannerArtResponse,
  BannerSlot,
  OnboardingFlag,
  StorefrontConfig,
  StorefrontConfigSchema,
  StorefrontDraftResponse,
} from '@marketplace/contracts';
import { DynamoRepository } from '../persistence/dynamo.repository';
import { settingsSk } from '../persistence/keys';
import { ProblemException } from '../common/problem';
import { assertAdmin } from '../common/roles';
import { foreignMediaUrl } from '../common/media-policy';
import { currentPrincipal } from '../common/tenant-context';
import { UploadsService } from '../uploads/uploads.service';
import { ImageGenClient } from './image-gen.client';

const PUBLISHED_SK = settingsSk('storefront');
const DRAFT_SK = settingsSk('storefront-draft');
const ONBOARDING_SK = settingsSk('storefront-onboarding');

/**
 * The repository hands back the raw item, table keys included. The config
 * schema is strict -- the right call on every write path -- so the keys must
 * come off before a read is parsed, or every read of a stored config 500s.
 */
function stripTableKeys(item: Record<string, unknown>): Record<string, unknown> {
  const { PK: _pk, SK: _sk, ...rest } = item;
  return rest;
}

@Injectable()
export class StorefrontService {
  constructor(
    private readonly repo: DynamoRepository,
    /**
     * Both null on a deployment without a renderer or without object storage;
     * the capability flag and the 503 below are how that absence surfaces.
     * Wired from env in the module; the service itself stays env-free.
     */
    private readonly imageGen: ImageGenClient | null = null,
    private readonly uploads: UploadsService | null = null,
  ) {}

  private get imageGenEnabled(): boolean {
    return this.imageGen !== null && this.uploads !== null;
  }

  private assertAdmin(action: string): void {
    assertAdmin(action);
  }

  /** Absence is a state: a store that never ran the wizard renders the default theme. */
  async getPublished(): Promise<StorefrontConfig | null> {
    const found = await this.repo.get<Record<string, unknown>>(PUBLISHED_SK);
    return found ? StorefrontConfigSchema.parse(stripTableKeys(found)) : null;
  }

  async getDraft(): Promise<StorefrontDraftResponse> {
    this.assertAdmin('read the storefront draft');
    const found = await this.repo.get<Record<string, unknown>>(DRAFT_SK);
    return {
      draft: found ? StorefrontConfigSchema.parse(stripTableKeys(found)) : null,
      capabilities: { imageGen: this.imageGenEnabled },
    };
  }

  async putDraft(config: StorefrontConfig): Promise<StorefrontConfig> {
    this.assertAdmin('edit the storefront draft');
    const parsed = StorefrontConfigSchema.parse(config);

    // Public media isolation (#05): banner art must be this shop's own media,
    // exactly as product images are.
    const artUrls = parsed.banners
      .map((b) => ('imageUrl' in b.art ? b.art.imageUrl : undefined))
      .filter((url): url is string => typeof url === 'string');
    const foreign = foreignMediaUrl(artUrls, currentPrincipal().tenantId);
    if (foreign !== null) {
      throw new ProblemException(
        'invalid-request',
        422,
        'Banner art is not this shop’s media',
        `upload banner art through this shop; ${foreign} points elsewhere`,
        { url: foreign },
      );
    }

    await this.repo.put(DRAFT_SK, parsed);
    return parsed;
  }

  async publish(): Promise<StorefrontConfig> {
    this.assertAdmin('publish the storefront');
    const draft = await this.repo.get<Record<string, unknown>>(DRAFT_SK);
    if (!draft) {
      throw new ProblemException(
        'storefront-draft-not-found',
        404,
        'There is no draft to publish',
      );
    }
    const parsed = StorefrontConfigSchema.parse(stripTableKeys(draft));
    await this.repo.put(PUBLISHED_SK, parsed);
    return parsed;
  }

  /**
   * Render art for one slot of the draft. The prompt is built here from the
   * draft's own profile and copy -- the caller names a slot, nothing more, so
   * there is no free-text prompt surface on this route.
   */
  async generateBannerArt(slot: BannerSlot): Promise<BannerArtResponse> {
    this.assertAdmin('generate banner art');
    if (!this.imageGen || !this.uploads) {
      throw new ProblemException(
        'image-gen-unavailable',
        503,
        'Image generation is unavailable',
        'no image renderer is configured for this deployment',
      );
    }

    const stored = await this.repo.get<Record<string, unknown>>(DRAFT_SK);
    if (!stored) {
      throw new ProblemException('storefront-draft-not-found', 404, 'There is no draft yet');
    }
    const draft = StorefrontConfigSchema.parse(stripTableKeys(stored));
    const banner = draft.banners.find((b) => b.slot === slot);
    if (!banner) {
      throw new ProblemException('not-found', 404, `The draft has no ${slot} banner`);
    }

    const profile = draft.businessProfile;
    const prompt =
      `wide storefront banner photograph for a ${profile.kind} named ${profile.name}, ` +
      `${profile.tone} mood, for ${profile.audience}, no text, evoking: ${banner.headline}`;

    const bytes = await this.imageGen.generate(prompt);
    const uploaded = await this.uploads.store({
      buffer: bytes,
      originalname: `banner-${slot}.png`,
      mimetype: 'image/png',
      size: bytes.length,
    });
    return { imageUrl: uploaded.objectUrl };
  }

  async getOnboardingFlag(): Promise<OnboardingFlag> {
    const found = await this.repo.get<OnboardingFlag>(ONBOARDING_SK);
    return found ? { dismissed: found.dismissed === true } : { dismissed: false };
  }

  async putOnboardingFlag(flag: OnboardingFlag): Promise<OnboardingFlag> {
    this.assertAdmin('dismiss onboarding');
    await this.repo.put(ONBOARDING_SK, { dismissed: flag.dismissed });
    return flag;
  }
}

import { Controller, Get, Post, Put } from '@nestjs/common';
import {
  BannerArtRequest,
  BannerArtRequestSchema,
  BannerArtResponse,
  OnboardingFlag,
  OnboardingFlagSchema,
  StorefrontConfig,
  StorefrontConfigSchema,
  StorefrontDraftResponse,
  StorefrontPublicResponse,
} from '@marketplace/contracts';
import { ZodBody } from '../common/zod-validation.pipe';
import { Roles } from '../auth/roles.decorator';
import { StorefrontService } from './storefront.service';

@Controller('storefront')
export class StorefrontController {
  constructor(private readonly storefront: StorefrontService) {}

  /**
   * Every signed-in user of the tenant may read it -- the storefront renders
   * it. Enveloped: a bare null return would serialize as an empty 200 body,
   * which no JSON client can parse.
   */
  @Get()
  async getPublished(): Promise<StorefrontPublicResponse> {
    return { config: await this.storefront.getPublished() };
  }

  // Declared here as well as checked in the service, like every admin write:
  // the decorator makes the restriction visible on the route and in the
  // OpenAPI document, the service check is what the unit tests pin.
  @Get('draft')
  @Roles('admin')
  getDraft(): Promise<StorefrontDraftResponse> {
    return this.storefront.getDraft();
  }

  @Put('draft')
  @Roles('admin')
  putDraft(@ZodBody(StorefrontConfigSchema) body: StorefrontConfig): Promise<StorefrontConfig> {
    return this.storefront.putDraft(body);
  }

  @Post('publish')
  @Roles('admin')
  publish(): Promise<StorefrontConfig> {
    return this.storefront.publish();
  }

  @Post('banner-art')
  @Roles('admin')
  generateBannerArt(
    @ZodBody(BannerArtRequestSchema) body: BannerArtRequest,
  ): Promise<BannerArtResponse> {
    return this.storefront.generateBannerArt(body.slot);
  }

  @Get('onboarding')
  getOnboardingFlag(): Promise<OnboardingFlag> {
    return this.storefront.getOnboardingFlag();
  }

  @Put('onboarding')
  @Roles('admin')
  putOnboardingFlag(@ZodBody(OnboardingFlagSchema) body: OnboardingFlag): Promise<OnboardingFlag> {
    return this.storefront.putOnboardingFlag(body);
  }
}

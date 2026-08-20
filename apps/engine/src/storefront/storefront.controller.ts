import { Controller, Get, Post, Put } from '@nestjs/common';
import {
  OnboardingFlag,
  OnboardingFlagSchema,
  StorefrontConfig,
  StorefrontConfigSchema,
  StorefrontDraftResponse,
} from '@marketplace/contracts';
import { ZodBody } from '../common/zod-validation.pipe';
import { Roles } from '../auth/roles.decorator';
import { StorefrontService } from './storefront.service';

@Controller('storefront')
export class StorefrontController {
  constructor(private readonly storefront: StorefrontService) {}

  /** Every signed-in user of the tenant may read it -- the storefront renders it. */
  @Get()
  getPublished(): Promise<StorefrontConfig | null> {
    return this.storefront.getPublished();
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

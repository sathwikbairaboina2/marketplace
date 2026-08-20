import { Injectable } from '@nestjs/common';
import {
  OnboardingFlag,
  StorefrontConfig,
  StorefrontConfigSchema,
  StorefrontDraftResponse,
} from '@marketplace/contracts';
import { DynamoRepository } from '../persistence/dynamo.repository';
import { settingsSk } from '../persistence/keys';
import { ProblemException } from '../common/problem';
import { currentPrincipal } from '../common/tenant-context';

const PUBLISHED_SK = settingsSk('storefront');
const DRAFT_SK = settingsSk('storefront-draft');
const ONBOARDING_SK = settingsSk('storefront-onboarding');

@Injectable()
export class StorefrontService {
  constructor(
    private readonly repo: DynamoRepository,
    /** Wired from env in the module; the service itself stays env-free. */
    private readonly imageGenEnabled: boolean,
  ) {}

  private assertAdmin(action: string): void {
    if (currentPrincipal().role !== 'admin') {
      throw new ProblemException('forbidden', 403, `Only an admin can ${action}`);
    }
  }

  /** Absence is a state: a store that never ran the wizard renders the default theme. */
  async getPublished(): Promise<StorefrontConfig | null> {
    const found = await this.repo.get<StorefrontConfig>(PUBLISHED_SK);
    return found ? StorefrontConfigSchema.parse(found) : null;
  }

  async getDraft(): Promise<StorefrontDraftResponse> {
    this.assertAdmin('read the storefront draft');
    const found = await this.repo.get<StorefrontConfig>(DRAFT_SK);
    return {
      draft: found ? StorefrontConfigSchema.parse(found) : null,
      capabilities: { imageGen: this.imageGenEnabled },
    };
  }

  async putDraft(config: StorefrontConfig): Promise<StorefrontConfig> {
    this.assertAdmin('edit the storefront draft');
    const parsed = StorefrontConfigSchema.parse(config);
    await this.repo.put(DRAFT_SK, parsed);
    return parsed;
  }

  async publish(): Promise<StorefrontConfig> {
    this.assertAdmin('publish the storefront');
    const draft = await this.repo.get<StorefrontConfig>(DRAFT_SK);
    if (!draft) {
      throw new ProblemException(
        'storefront-draft-not-found',
        404,
        'There is no draft to publish',
      );
    }
    const parsed = StorefrontConfigSchema.parse(draft);
    await this.repo.put(PUBLISHED_SK, parsed);
    return parsed;
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

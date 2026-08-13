import { Injectable } from '@nestjs/common';
import { Announcement, UpdateAnnouncement } from '@marketplace/contracts';
import { DynamoRepository } from '../persistence/dynamo.repository';
import { settingsSk } from '../persistence/keys';
import { ProblemException } from '../common/problem';
import { currentPrincipal } from '../common/tenant-context';

const ANNOUNCEMENT_SK = settingsSk('announcement');

@Injectable()
export class SettingsService {
  constructor(private readonly repo: DynamoRepository) {}

  /** Every signed-in user of the tenant may read it -- the storefront renders it. */
  async getAnnouncement(): Promise<Announcement> {
    const found = await this.repo.get<Announcement>(ANNOUNCEMENT_SK);
    // Absence is a state, not an error: a shop that has never set one is silent.
    return found ? { text: found.text, enabled: found.enabled } : { text: '', enabled: false };
  }

  async updateAnnouncement(input: UpdateAnnouncement): Promise<Announcement> {
    if (currentPrincipal().role !== 'admin') {
      throw new ProblemException('forbidden', 403, 'Only an admin can set the announcement');
    }
    await this.repo.put(ANNOUNCEMENT_SK, { text: input.text, enabled: input.enabled });
    return input;
  }
}

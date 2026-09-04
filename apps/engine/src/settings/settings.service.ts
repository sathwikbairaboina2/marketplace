import { Injectable } from '@nestjs/common';
import {
  Announcement,
  DEFAULT_DEPOSIT_POLICY,
  DepositPolicy,
  EMPTY_SHOP_CONTACT,
  ShopContact,
  UpdateAnnouncement,
  UpdateDepositPolicy,
  UpdateShopContact,
} from '@marketplace/contracts';
import { DynamoRepository } from '../persistence/dynamo.repository';
import { settingsSk } from '../persistence/keys';
import { assertAdmin } from '../common/roles';

const ANNOUNCEMENT_SK = settingsSk('announcement');
const CONTACT_SK = settingsSk('contact');
const DEPOSIT_SK = settingsSk('deposit');

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
    assertAdmin('set the announcement');
    await this.repo.put(ANNOUNCEMENT_SK, { text: input.text, enabled: input.enabled });
    return input;
  }

  /**
   * How to reach the shop, for the footer. Readable by anyone who can see the
   * shop -- it is printed on every page of it.
   */
  async getContact(): Promise<ShopContact> {
    const found = await this.repo.get<ShopContact>(CONTACT_SK);
    if (!found) return EMPTY_SHOP_CONTACT;
    // Field by field, and *only* the declared fields. A stored item carries the
    // single table's `PK` and `SK`, and spreading it puts the key scheme on the
    // wire -- which this codebase forbids, and which a `.strict()` contract on
    // the browser side rejects outright.
    return {
      email: found.email ?? EMPTY_SHOP_CONTACT.email,
      phone: found.phone ?? EMPTY_SHOP_CONTACT.phone,
      whatsapp: found.whatsapp ?? EMPTY_SHOP_CONTACT.whatsapp,
      address: found.address ?? EMPTY_SHOP_CONTACT.address,
      delivery: found.delivery ?? EMPTY_SHOP_CONTACT.delivery,
      returns: found.returns ?? EMPTY_SHOP_CONTACT.returns,
    };
  }

  async updateContact(input: UpdateShopContact): Promise<ShopContact> {
    assertAdmin('set the shop contact details');
    await this.repo.put(CONTACT_SK, { ...input });
    return input;
  }

  /**
   * Whether this shop takes a deposit, and how much. Readable by anyone who can
   * see the shop: the cart has to be able to offer it.
   */
  async getDepositPolicy(): Promise<DepositPolicy> {
    const found = await this.repo.get<DepositPolicy>(DEPOSIT_SK);
    if (!found) return DEFAULT_DEPOSIT_POLICY;
    // Named fields, not a spread: see `getContact`. Spreading the stored item
    // put `PK` and `SK` on the wire, and because this contract is `.strict()`
    // the browser refused the whole response -- so the cart quietly stopped
    // offering a deposit at all.
    return {
      enabled: found.enabled ?? DEFAULT_DEPOSIT_POLICY.enabled,
      percent: found.percent ?? DEFAULT_DEPOSIT_POLICY.percent,
      minOrderMinor: found.minOrderMinor ?? DEFAULT_DEPOSIT_POLICY.minOrderMinor,
    };
  }

  async updateDepositPolicy(input: UpdateDepositPolicy): Promise<DepositPolicy> {
    assertAdmin('set the deposit policy');
    await this.repo.put(DEPOSIT_SK, { ...input });
    return input;
  }
}

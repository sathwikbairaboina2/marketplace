import { z } from 'zod';

/**
 * One line the seller controls on their own storefront -- a promotion, a
 * holiday notice, anything current. Length-capped because it renders as a
 * single strip above the shop: a paragraph there is a banner ad, not an
 * announcement.
 */
export const AnnouncementSchema = z.object({
  text: z.string().max(140),
  enabled: z.boolean(),
});
export type Announcement = z.infer<typeof AnnouncementSchema>;

export const UpdateAnnouncementSchema = AnnouncementSchema;
export type UpdateAnnouncement = Announcement;

/**
 * How a customer reaches the shop, and what it promises about getting goods to
 * them. None of it is required: an empty field renders as nothing rather than
 * as a promise the merchant has not made.
 *
 * A settings record rather than more keys on the storefront config, because
 * the config is strict and every draft written before today would stop
 * parsing -- and because this is the kind of thing a merchant edits on its own,
 * without republishing a storefront.
 */
export const ShopContactSchema = z.object({
  email: z.string().trim().email().max(254).or(z.literal('')),
  phone: z.string().trim().max(32),
  whatsapp: z.string().trim().max(32),
  address: z.string().trim().max(300),
  delivery: z.string().trim().max(280),
  returns: z.string().trim().max(280),
});
export type ShopContact = z.infer<typeof ShopContactSchema>;

export const EMPTY_SHOP_CONTACT: ShopContact = {
  email: '',
  phone: '',
  whatsapp: '',
  address: '',
  delivery: '',
  returns: '',
};

export const UpdateShopContactSchema = ShopContactSchema;
export type UpdateShopContact = ShopContact;

/**
 * Whether the shop will take part of the money now and the rest in the room.
 *
 * A deposit is a *price*, not a second payment: the order is paid in full for
 * the deposit, the remainder is recorded on the order, and the merchant
 * collects it on the QR code she already has. Making it a payment state would
 * multiply the order state space and, as it turns out, silently drop half-paid
 * orders out of revenue.
 *
 * `percent` is what the buyer pays now; `minOrderMinor` keeps it off a mug.
 */
export const DepositPolicySchema = z
  .object({
    enabled: z.boolean(),
    percent: z.number().int().min(10).max(90),
    minOrderMinor: z.number().int().nonnegative(),
  })
  .strict();
export type DepositPolicy = z.infer<typeof DepositPolicySchema>;

export const DEFAULT_DEPOSIT_POLICY: DepositPolicy = {
  enabled: false,
  percent: 50,
  minOrderMinor: 500_000,
};

export const UpdateDepositPolicySchema = DepositPolicySchema;
export type UpdateDepositPolicy = DepositPolicy;

/**
 * What the buyer pays now, in minor units. The remainder is what they owe.
 *
 * The buyer pays the *larger* half of an odd total, so the amount collected in
 * the room is the rounder number and the merchant carries no fraction: the one
 * who is owed money should not also be owed a paisa.
 */
export function depositSplit(
  totalMinor: number,
  policy: DepositPolicy,
): { payNowMinor: number; balanceDueMinor: number } {
  if (!policy.enabled || totalMinor < policy.minOrderMinor) {
    return { payNowMinor: totalMinor, balanceDueMinor: 0 };
  }
  const payNowMinor = Math.ceil((totalMinor * policy.percent) / 100);
  return { payNowMinor, balanceDueMinor: totalMinor - payNowMinor };
}

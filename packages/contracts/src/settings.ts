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

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

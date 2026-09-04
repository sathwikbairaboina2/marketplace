import {
  AnnouncementSchema,
  ShopContactSchema,
  type Announcement,
  type ShopContact,
} from '@marketplace/contracts';
import { request } from './http';

export const getAnnouncement = () =>
  request('/settings/announcement', { schema: AnnouncementSchema });

export const putAnnouncement = (body: Announcement) =>
  request('/settings/announcement', { method: 'PUT', body, schema: AnnouncementSchema });

export const getShopContact = () => request('/settings/contact', { schema: ShopContactSchema });

export const putShopContact = (body: ShopContact) =>
  request('/settings/contact', { method: 'PUT', body, schema: ShopContactSchema });

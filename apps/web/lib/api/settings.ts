import {
  AnnouncementSchema,
  DepositPolicySchema,
  ShopContactSchema,
  type Announcement,
  type DepositPolicy,
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

export const getDepositPolicy = () => request('/settings/deposit', { schema: DepositPolicySchema });

export const putDepositPolicy = (body: DepositPolicy) =>
  request('/settings/deposit', { method: 'PUT', body, schema: DepositPolicySchema });

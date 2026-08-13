import { AnnouncementSchema, type Announcement } from '@marketplace/contracts';
import { request } from './http';

export const getAnnouncement = () =>
  request('/settings/announcement', { schema: AnnouncementSchema });

export const putAnnouncement = (body: Announcement) =>
  request('/settings/announcement', { method: 'PUT', body, schema: AnnouncementSchema });

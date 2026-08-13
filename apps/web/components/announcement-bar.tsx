'use client';

import { useEffect, useState } from 'react';
import type { Announcement } from '@marketplace/contracts';
import { getAnnouncement } from '../lib/api/settings';

/**
 * The seller's own line above their shop. Silent unless enabled and non-empty
 * -- and silent on error, because a shop must never wear a failure banner for
 * a feature this optional.
 */
export function AnnouncementBar() {
  const [announcement, setAnnouncement] = useState<Announcement | null>(null);

  useEffect(() => {
    getAnnouncement()
      .then(setAnnouncement)
      .catch(() => setAnnouncement(null));
  }, []);

  if (!announcement?.enabled || !announcement.text.trim()) return null;

  return (
    <div className="mp-announce" role="status">
      {announcement.text}
    </div>
  );
}

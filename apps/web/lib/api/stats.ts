import { SalesStatsSchema, type SalesStats } from '@marketplace/contracts';
import { request } from './http';

export const getSalesStats = (): Promise<SalesStats> =>
  request('/stats/sales', { schema: SalesStatsSchema });

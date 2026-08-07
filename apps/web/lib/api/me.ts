import { PrincipalSchema } from '@marketplace/contracts';
import { request } from './http';

export const getMe = () => request('/me', { schema: PrincipalSchema });

import {
  BannerArtResponseSchema,
  OnboardingFlagSchema,
  StorefrontConfigSchema,
  StorefrontDraftResponseSchema,
  type BannerSlot,
  type OnboardingFlag,
  type StorefrontConfig,
} from '@marketplace/contracts';
import { request } from './http';

export const getPublishedStorefront = () =>
  request('/storefront', { schema: StorefrontConfigSchema.nullable() });

export const getStorefrontDraft = () =>
  request('/storefront/draft', { schema: StorefrontDraftResponseSchema });

export const putStorefrontDraft = (body: StorefrontConfig) =>
  request('/storefront/draft', { method: 'PUT', body, schema: StorefrontConfigSchema });

export const publishStorefront = () =>
  request('/storefront/publish', { method: 'POST', schema: StorefrontConfigSchema });

export const generateBannerArt = (slot: BannerSlot) =>
  request('/storefront/banner-art', { method: 'POST', body: { slot }, schema: BannerArtResponseSchema });

export const getOnboardingFlag = () =>
  request('/storefront/onboarding', { schema: OnboardingFlagSchema });

export const putOnboardingFlag = (body: OnboardingFlag) =>
  request('/storefront/onboarding', { method: 'PUT', body, schema: OnboardingFlagSchema });

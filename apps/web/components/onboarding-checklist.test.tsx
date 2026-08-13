import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { OnboardingChecklist } from './onboarding-checklist';

describe('OnboardingChecklist', () => {
  it('greets the founder, marks the shop done, and points at the first listing', () => {
    render(<OnboardingChecklist shopId="acme" />);
    expect(screen.getByText('Your shop is ready')).toBeInTheDocument();
    expect(screen.getByText(/acme is live and yours/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'List a product' })).toHaveAttribute(
      'href',
      '/admin/products/new',
    );
    expect(screen.getByRole('button', { name: /Copy shop link/ })).toBeInTheDocument();
  });

  it('copies the storefront address', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.assign(navigator, { clipboard: { writeText } });
    render(<OnboardingChecklist shopId="acme" />);
    screen.getByRole('button', { name: /Copy shop link/ }).click();
    expect(writeText).toHaveBeenCalledWith(`${window.location.origin}/products`);
  });
});

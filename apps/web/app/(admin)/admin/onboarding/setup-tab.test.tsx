import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { SetupPlan } from '@marketplace/contracts';

const applySetupPlan = vi.fn();
vi.mock('../../../../lib/api/agents', () => ({
  applySetupPlan: (body: unknown) => applySetupPlan(body),
}));
const notifyProblem = vi.fn();
vi.mock('../../../../lib/problem-notify', () => ({ notifyProblem: (e: unknown) => notifyProblem(e) }));

import { SetupTab } from './setup-tab';

const plan: SetupPlan = {
  sellsWhat: 'bookable',
  categories: ['classes', 'retreats'],
  fields: [
    {
      entity: 'Event',
      field: { name: 'durationMinutes', type: 'number', required: false, default: null },
      rationale: 'classes vary in length',
    },
  ],
};

const ok = {
  applied: { sellsWhat: 'bookable' as const, categories: ['classes', 'retreats'] },
  queued: [],
  failed: [],
};

describe('SetupTab', () => {
  beforeEach(() => {
    applySetupPlan.mockReset();
    notifyProblem.mockReset();
  });

  it('shows each proposed field with its type and rationale', () => {
    render(<SetupTab plan={plan} />);

    expect(screen.getByText(/Event.durationMinutes/)).toBeInTheDocument();
    expect(screen.getByText('number')).toBeInTheDocument();
    expect(screen.getByText(/classes vary in length/)).toBeInTheDocument();
  });

  it('sends the whole plan when nothing is untouched', async () => {
    applySetupPlan.mockResolvedValue(ok);

    render(<SetupTab plan={plan} />);
    await userEvent.click(screen.getByTestId('apply-setup'));

    await waitFor(() => expect(applySetupPlan).toHaveBeenCalled());
    expect(applySetupPlan.mock.calls[0][0]).toEqual({
      sellsWhat: 'bookable',
      categories: ['classes', 'retreats'],
      fields: [{ entity: 'Event', field: plan.fields[0].field }],
    });
  });

  it('omits an unticked field from the request', async () => {
    applySetupPlan.mockResolvedValue(ok);

    render(<SetupTab plan={plan} />);
    await userEvent.click(screen.getByRole('checkbox', { name: /durationMinutes/ }));
    await userEvent.click(screen.getByTestId('apply-setup'));

    await waitFor(() => expect(applySetupPlan).toHaveBeenCalled());
    expect(applySetupPlan.mock.calls[0][0].fields).toEqual([]);
  });

  it('omits an unticked category from the request', async () => {
    applySetupPlan.mockResolvedValue(ok);

    render(<SetupTab plan={plan} />);
    await userEvent.click(screen.getByRole('checkbox', { name: 'retreats' }));
    await userEvent.click(screen.getByTestId('apply-setup'));

    await waitFor(() => expect(applySetupPlan).toHaveBeenCalled());
    expect(applySetupPlan.mock.calls[0][0].categories).toEqual(['classes']);
  });

  it('sends the owner-chosen sellsWhat over the proposed one', async () => {
    applySetupPlan.mockResolvedValue(ok);

    render(<SetupTab plan={plan} />);
    await userEvent.click(screen.getByRole('radio', { name: 'Both' }));
    await userEvent.click(screen.getByTestId('apply-setup'));

    await waitFor(() => expect(applySetupPlan).toHaveBeenCalled());
    expect(applySetupPlan.mock.calls[0][0].sellsWhat).toBe('both');
  });

  it('renders queued and failed results distinctly', async () => {
    applySetupPlan.mockResolvedValue({
      applied: { sellsWhat: 'bookable', categories: ['classes'] },
      queued: [{ entity: 'Event', fieldName: 'durationMinutes', messageId: 'm1' }],
      failed: [{ entity: 'Event', fieldName: 'level', reason: 'queue down' }],
    });

    render(<SetupTab plan={plan} />);
    await userEvent.click(screen.getByTestId('apply-setup'));

    expect(await screen.findByText(/sent to Flows/i)).toBeInTheDocument();
    expect(screen.getByRole('alert')).toHaveTextContent('Event.level');
    expect(screen.getByRole('link', { name: /Review in Flows/i })).toHaveAttribute(
      'href',
      '/admin/flows',
    );
  });

  it('keeps the form and reports the problem when the apply fails', async () => {
    applySetupPlan.mockRejectedValue(new Error('boom'));

    render(<SetupTab plan={plan} />);
    await userEvent.click(screen.getByTestId('apply-setup'));

    await waitFor(() => expect(notifyProblem).toHaveBeenCalled());
    expect(screen.getByTestId('setup-plan')).toBeInTheDocument();
  });
});

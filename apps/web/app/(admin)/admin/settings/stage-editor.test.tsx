import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, act, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { StageEditor } from './stage-editor';
import { ProblemError } from '../../../../lib/api/http';

const getPipeline = vi.fn();
const savePipeline = vi.fn();
vi.mock('../../../../lib/api/pipeline', () => ({
  getPipeline: () => getPipeline(),
  savePipeline: (body: unknown) => savePipeline(body),
}));
vi.mock('../../../../lib/problem-notify', () => ({ notifyProblem: vi.fn() }));

const PIPELINE = {
  version: 3,
  stages: [
    { id: 'st-1', name: 'Awaiting artwork', cancellable: true, messaging: true },
    { id: 'st-2', name: 'Mount cut', cancellable: false, messaging: true },
  ],
};

beforeEach(() => {
  getPipeline.mockReset();
  savePipeline.mockReset();
  getPipeline.mockResolvedValue(PIPELINE);
  savePipeline.mockResolvedValue({ version: 4, stages: PIPELINE.stages });
});

describe('StageEditor', () => {
  it('loads the shop own stages', async () => {
    render(<StageEditor />);
    await act(async () => {});

    expect(screen.getByDisplayValue('Awaiting artwork')).toBeInTheDocument();
    expect(screen.getByDisplayValue('Mount cut')).toBeInTheDocument();
  });

  it('previews the buyer tracker from the stages as edited', async () => {
    render(<StageEditor />);
    await act(async () => {});

    await userEvent.clear(screen.getByDisplayValue('Mount cut'));
    await userEvent.type(screen.getByLabelText('Stage 2 name'), 'Glazed');

    // The preview is the tracker component itself, so what the owner sees here
    // is literally what the buyer will see.
    await waitFor(() => expect(screen.getByText('Glazed')).toBeInTheDocument());
  });

  it('sends the version it loaded, so a stale save can be refused', async () => {
    render(<StageEditor />);
    await act(async () => {});

    await userEvent.click(screen.getByRole('button', { name: /publish stages/i }));

    await waitFor(() =>
      expect(savePipeline).toHaveBeenCalledWith(expect.objectContaining({ version: 3 })),
    );
  });

  it('tells the owner to reload when someone else saved first', async () => {
    savePipeline.mockRejectedValue(
      new ProblemError('pipeline-version-conflict', 409, 'Order stages changed', undefined, 't', []),
    );

    render(<StageEditor />);
    await act(async () => {});
    await userEvent.click(screen.getByRole('button', { name: /publish stages/i }));

    expect(await screen.findByText(/someone else saved/i)).toBeInTheDocument();
  });

  it('refuses to publish two stages sharing a name', async () => {
    render(<StageEditor />);
    await act(async () => {});

    await userEvent.clear(screen.getByLabelText('Stage 2 name'));
    await userEvent.type(screen.getByLabelText('Stage 2 name'), 'awaiting artwork');

    // Case-folded, matching what the contract rejects: a buyer would otherwise
    // see two identical steps with no way to tell them apart.
    await waitFor(() =>
      expect(screen.getByRole('button', { name: /publish stages/i })).toBeDisabled(),
    );
    expect(screen.getByText(/two stages share a name/i)).toBeInTheDocument();
  });

  it('refuses to publish a blank stage name', async () => {
    render(<StageEditor />);
    await act(async () => {});

    await userEvent.clear(screen.getByLabelText('Stage 1 name'));

    await waitFor(() =>
      expect(screen.getByRole('button', { name: /publish stages/i })).toBeDisabled(),
    );
  });

  it('will not remove the last stage', async () => {
    getPipeline.mockResolvedValue({
      version: 1,
      stages: [{ id: 'only', name: 'Confirmed', cancellable: true, messaging: false }],
    });

    render(<StageEditor />);
    await act(async () => {});

    // A shop with no stages has no lifecycle to place an order into.
    expect(screen.getByLabelText('Remove Confirmed')).toBeDisabled();
  });

  it('says that a save only affects orders taken from now on', async () => {
    render(<StageEditor />);
    await act(async () => {});

    expect(screen.getByText(/keep walking the stages they were placed under/i)).toBeInTheDocument();
  });
});

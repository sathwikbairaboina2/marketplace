import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { MessageResponse } from '@marketplace/contracts';
import { StageThread } from './stage-thread';

vi.mock('../lib/api/messages', () => ({ postMessage: vi.fn() }));
import { postMessage } from '../lib/api/messages';

const message = (over: Partial<MessageResponse> = {}): MessageResponse => ({
  entityType: 'Message',
  id: '01ARZ3NDEKTSV4RRFFQ69G5FAV',
  orderId: '01ARZ3NDEKTSV4RRFFQ69G5FAW',
  stageId: 'a',
  authorUserId: 'u1',
  authorRole: 'buyer',
  body: 'Any news?',
  createdAt: '2026-08-18T10:00:00.000Z',
  ...over,
});

describe('StageThread', () => {
  beforeEach(() => vi.clearAllMocks());

  it('shows a composer while the thread is open', () => {
    render(<StageThread orderId="o" messages={[message()]} open onPosted={() => {}} />);
    expect(screen.getByPlaceholderText(/write a message/i)).toBeInTheDocument();
  });

  // A stage the order has left is history: readable, never writable. The engine
  // enforces it too -- the client cannot name a stage at all -- but a composer
  // that posts into the wrong thread would be a lie either way.
  it('shows a closed thread as history with no composer', () => {
    render(<StageThread orderId="o" messages={[message()]} open={false} onPosted={() => {}} />);
    expect(screen.getByText('Any news?')).toBeInTheDocument();
    expect(screen.queryByPlaceholderText(/write a message/i)).not.toBeInTheDocument();
  });

  it('labels who wrote each message', () => {
    render(
      <StageThread
        orderId="o"
        messages={[
          message(),
          message({ id: '01ARZ3NDEKTSV4RRFFQ69G5FAX', authorRole: 'seller', body: 'Tomorrow' }),
        ]}
        open
        onPosted={() => {}}
      />,
    );
    expect(screen.getByText(/buyer/i)).toBeInTheDocument();
    expect(screen.getByText(/seller/i)).toBeInTheDocument();
  });

  it('will not send an empty message', () => {
    render(<StageThread orderId="o" messages={[]} open onPosted={() => {}} />);
    expect(screen.getByRole('button', { name: /send/i })).toBeDisabled();
  });

  it('sends what was typed and hands the result back', async () => {
    const posted = message({ body: 'Please gift wrap it' });
    vi.mocked(postMessage).mockResolvedValue(posted);
    const onPosted = vi.fn();

    render(<StageThread orderId="o" messages={[]} open onPosted={onPosted} />);
    await userEvent.type(screen.getByPlaceholderText(/write a message/i), 'Please gift wrap it');
    await userEvent.click(screen.getByRole('button', { name: /send/i }));

    await waitFor(() => expect(postMessage).toHaveBeenCalledWith('o', 'Please gift wrap it'));
    expect(onPosted).toHaveBeenCalledWith(posted);
  });

  // A failed send that emptied the box would lose what the buyer wrote.
  it('keeps the draft when sending fails', async () => {
    vi.mocked(postMessage).mockRejectedValue(new Error('nope'));

    render(<StageThread orderId="o" messages={[]} open onPosted={() => {}} />);
    const box = screen.getByPlaceholderText(/write a message/i);
    await userEvent.type(box, 'worth keeping');
    await userEvent.click(screen.getByRole('button', { name: /send/i }));

    await waitFor(() => expect(postMessage).toHaveBeenCalled());
    expect(box).toHaveValue('worth keeping');
  });
});

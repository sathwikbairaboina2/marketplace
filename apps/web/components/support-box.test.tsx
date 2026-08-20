import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, act, fireEvent } from '@testing-library/react';
import { SupportBox } from './support-box';

const askSupport = vi.fn();
vi.mock('../lib/api/agents', () => ({ askSupport: (q: string) => askSupport(q) }));
vi.mock('../lib/problem-notify', () => ({ notifyProblem: vi.fn() }));

beforeEach(() => askSupport.mockReset());

describe('SupportBox', () => {
  it('asks and renders the grounded answer', async () => {
    askSupport.mockResolvedValue({ answer: 'Order ZPCQHS is being packed.' });
    render(<SupportBox />);

    fireEvent.change(screen.getByTestId('support-question'), {
      target: { value: 'where is my mug?' },
    });
    await act(async () => {
      fireEvent.click(screen.getByTestId('support-ask'));
    });

    expect(askSupport).toHaveBeenCalledWith('where is my mug?');
    expect(screen.getByTestId('support-answer')).toHaveTextContent('ZPCQHS');
  });

  it('does not send an empty question', async () => {
    render(<SupportBox />);
    expect(screen.getByTestId('support-ask')).toBeDisabled();
  });
});

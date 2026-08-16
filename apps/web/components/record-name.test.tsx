import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, act } from '@testing-library/react';
import { EventName, ProductName, __clearNameCache } from './record-name';

const getProduct = vi.fn();
const getEvent = vi.fn();
vi.mock('../lib/api/products', () => ({ getProduct: (id: string) => getProduct(id) }));
vi.mock('../lib/api/events', () => ({ getEvent: (id: string) => getEvent(id) }));

const MUG = '01ARZ3NDEKTSV4RRFFQ69G5FAV';
const GIG = '01ARZ3NDEKTSV4RRFFQ69G5FB1';

beforeEach(() => {
  __clearNameCache();
  getProduct.mockReset();
  getEvent.mockReset();
  getProduct.mockResolvedValue({ id: MUG, name: 'Coupe Stoneware Mug' });
  getEvent.mockResolvedValue({ id: GIG, title: 'Glaze & Fire Workshop' });
});

describe('ProductName', () => {
  it('shows the product name once it resolves', async () => {
    render(<ProductName id={MUG} />);
    await act(async () => {});

    expect(screen.getByText('Coupe Stoneware Mug')).toBeInTheDocument();
  });

  it('shows a reference, not a blank, while it is still loading', () => {
    render(<ProductName id={MUG} />);

    expect(screen.getByTitle(MUG)).toBeInTheDocument();
  });

  it('falls back to a reference when the product cannot be fetched', async () => {
    getProduct.mockRejectedValue(new Error('gone'));

    render(<ProductName id={MUG} />);
    await act(async () => {});

    expect(screen.getByTitle(MUG)).toBeInTheDocument();
  });

  // A list of orders repeats the same product constantly; fetching it once per
  // row would turn one page into dozens of identical requests.
  it('fetches a given product only once across many rows', async () => {
    render(
      <>
        <ProductName id={MUG} />
        <ProductName id={MUG} />
        <ProductName id={MUG} />
      </>,
    );
    await act(async () => {});

    expect(getProduct).toHaveBeenCalledTimes(1);
    expect(screen.getAllByText('Coupe Stoneware Mug')).toHaveLength(3);
  });

  it('says how many other things share the row', async () => {
    render(<ProductName id={MUG} extra={2} />);
    await act(async () => {});

    expect(screen.getByText(/\+2 more/)).toBeInTheDocument();
  });

  it('says nothing extra when the row holds one thing', async () => {
    render(<ProductName id={MUG} extra={0} />);
    await act(async () => {});

    expect(screen.queryByText(/more/)).toBeNull();
  });
});

describe('EventName', () => {
  it('shows the event title once it resolves', async () => {
    render(<EventName id={GIG} />);
    await act(async () => {});

    expect(screen.getByText('Glaze & Fire Workshop')).toBeInTheDocument();
  });

  it('falls back to a reference when the event cannot be fetched', async () => {
    getEvent.mockRejectedValue(new Error('gone'));

    render(<EventName id={GIG} />);
    await act(async () => {});

    expect(screen.getByTitle(GIG)).toBeInTheDocument();
  });

  it('keeps products and events in separate caches', async () => {
    render(
      <>
        <ProductName id={MUG} />
        <EventName id={GIG} />
      </>,
    );
    await act(async () => {});

    expect(screen.getByText('Coupe Stoneware Mug')).toBeInTheDocument();
    expect(screen.getByText('Glaze & Fire Workshop')).toBeInTheDocument();
  });
});

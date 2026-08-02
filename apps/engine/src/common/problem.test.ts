import { ProblemException } from './problem';

describe('ProblemException', () => {
  it('carries type, status, title and extras', () => {
    const err = new ProblemException('insufficient-stock', 409, 'Insufficient stock', 'only 2 left', {
      productId: 'P1',
    });
    expect(err.getStatus()).toBe(409);
    expect(err.problem).toMatchObject({
      type: 'https://marketplace.local/problems/insufficient-stock',
      title: 'Insufficient stock',
      status: 409,
      detail: 'only 2 left',
      productId: 'P1',
    });
  });
});

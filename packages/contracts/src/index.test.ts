import { PACKAGE_NAME } from './index';

describe('contracts package', () => {
  it('is wired into the workspace', () => {
    expect(PACKAGE_NAME).toBe('@marketplace/contracts');
  });
});

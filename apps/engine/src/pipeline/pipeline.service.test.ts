import { DEFAULT_PIPELINE } from '@marketplace/contracts';
import { PipelineService } from './pipeline.service';

const repo = {
  get: jest.fn(),
  transactWrite: jest.fn(),
  key: jest.fn((sk: string) => ({ PK: 'TENANT#acme', SK: sk })),
  tableName: 'marketplace',
};

jest.mock('../common/tenant-context', () => ({
  currentPrincipal: jest.fn(() => ({ tenantId: 'acme', userId: 'u1', role: 'admin' })),
}));
import { currentPrincipal } from '../common/tenant-context';

describe('PipelineService', () => {
  const service = new PipelineService(repo as never);
  beforeEach(() => jest.clearAllMocks());

  it('returns the built-in default when the tenant has never configured one', async () => {
    repo.get.mockResolvedValue(null);
    await expect(service.get()).resolves.toEqual(DEFAULT_PIPELINE);
  });

  it('returns the stored pipeline when there is one', async () => {
    const stored = {
      version: 4,
      stages: [{ id: '01ARZ3NDEKTSV4RRFFQ69G5FAV', name: 'Cut', cancellable: true, messaging: false }],
    };
    repo.get.mockResolvedValue({ ...stored, PK: 'TENANT#acme', SK: 'SETTINGS#pipeline' });
    await expect(service.get()).resolves.toEqual(stored);
  });

  it('refuses a non-admin', async () => {
    (currentPrincipal as jest.Mock).mockReturnValueOnce({
      tenantId: 'acme',
      userId: 'u1',
      role: 'buyer',
    });
    await expect(
      service.update({ version: 0, stages: [{ name: 'One', cancellable: false, messaging: false }] }),
    ).rejects.toMatchObject({ status: 403 });
    expect(repo.transactWrite).not.toHaveBeenCalled();
  });

  it('mints an id for a new stage, keeps the id of an existing one, and bumps the version', async () => {
    const existing = '01ARZ3NDEKTSV4RRFFQ69G5FAV';
    repo.transactWrite.mockResolvedValue(undefined);

    const saved = await service.update({
      version: 0,
      stages: [
        { id: existing, name: 'Kept', cancellable: true, messaging: false },
        { name: 'Added', cancellable: false, messaging: true },
      ],
    });

    expect(saved.stages[0].id).toBe(existing);
    expect(saved.stages[1].id).toHaveLength(26);
    expect(saved.stages[1]).toMatchObject({ name: 'Added', messaging: true });
    expect(saved.version).toBe(1);
  });
});

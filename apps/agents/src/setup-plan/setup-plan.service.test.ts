import { TenantPrincipal } from '@marketplace/auth';
import { ApplySetupPlanRequest } from '@marketplace/contracts';
import { ProblemException } from '../common/problem';
import { DispatchService } from '../dispatch/dispatch.service';
import { EngineClient } from '../engine-client/engine.client';
import { SetupPlanService } from './setup-plan.service';

const draft = {
  presetId: 'artisan' as const,
  overrides: {},
  about: { title: 'About', sections: [{ heading: 'Us', body: 'Small-batch ceramics.' }] },
  banners: [],
  businessProfile: {
    kind: 'ceramics studio',
    name: 'Kiln & Loom',
    tone: 'warm',
    audience: 'gift buyers',
  },
};

const admin: TenantPrincipal = { tenantId: 'acme', userId: 'u1', role: 'admin' };

const request: ApplySetupPlanRequest = {
  sellsWhat: 'goods',
  categories: ['mugs'],
  fields: [
    {
      entity: 'Product',
      field: { name: 'material', type: 'string', required: false, default: null },
    },
  ],
};

describe('SetupPlanService', () => {
  let engine: { getStorefrontDraft: jest.Mock; putStorefrontDraft: jest.Mock };
  let dispatch: { dispatch: jest.Mock };
  let service: SetupPlanService;

  beforeEach(() => {
    engine = {
      getStorefrontDraft: jest.fn().mockResolvedValue(draft),
      putStorefrontDraft: jest.fn().mockResolvedValue(undefined),
    };
    dispatch = { dispatch: jest.fn().mockResolvedValue('msg-1') };
    service = new SetupPlanService(
      engine as unknown as EngineClient,
      dispatch as unknown as DispatchService,
    );
  });

  it('refuses a caller who is not an admin, in the service and not only on the route', async () => {
    await expect(
      service.apply(request, { ...admin, role: 'buyer' }, 'tok'),
    ).rejects.toBeInstanceOf(ProblemException);
    expect(engine.putStorefrontDraft).not.toHaveBeenCalled();
    expect(dispatch.dispatch).not.toHaveBeenCalled();
  });

  it('answers 404 rather than 403 when the caller is not an admin', async () => {
    await expect(service.apply(request, { ...admin, role: null }, 'tok')).rejects.toMatchObject({
      problem: { status: 404 },
    });
  });

  it('answers 404 when there is no draft to apply to', async () => {
    engine.getStorefrontDraft.mockResolvedValue(null);

    await expect(service.apply(request, admin, 'tok')).rejects.toMatchObject({
      problem: { status: 404 },
    });
    expect(dispatch.dispatch).not.toHaveBeenCalled();
  });

  it('merges the storefront half into the existing draft without disturbing the rest', async () => {
    await service.apply(request, admin, 'tok');

    const [config, token] = engine.putStorefrontDraft.mock.calls[0];
    expect(config.sellsWhat).toBe('goods');
    expect(config.categories).toEqual(['mugs']);
    expect(config.about).toEqual(draft.about);
    expect(config.businessProfile).toEqual(draft.businessProfile);
    expect(token).toBe('tok');
  });

  it('writes the storefront before dispatching any field', async () => {
    const order: string[] = [];
    engine.putStorefrontDraft.mockImplementation(async () => {
      order.push('put');
    });
    dispatch.dispatch.mockImplementation(async () => {
      order.push('dispatch');
      return 'msg-1';
    });

    await service.apply(request, admin, 'tok');

    expect(order).toEqual(['put', 'dispatch']);
  });

  it('queues nothing when the storefront write fails', async () => {
    engine.putStorefrontDraft.mockRejectedValue(
      new ProblemException('engine-unavailable', 503, 'Engine is unreachable'),
    );

    await expect(service.apply(request, admin, 'tok')).rejects.toBeInstanceOf(ProblemException);
    expect(dispatch.dispatch).not.toHaveBeenCalled();
  });

  it('reports each queued field with its message id', async () => {
    const result = await service.apply(request, admin, 'tok');

    expect(result.queued).toEqual([
      { entity: 'Product', fieldName: 'material', messageId: 'msg-1' },
    ]);
    expect(result.failed).toEqual([]);
    expect(result.applied).toEqual({ sellsWhat: 'goods', categories: ['mugs'] });
  });

  it('reports a failed dispatch per item and keeps the storefront half applied', async () => {
    dispatch.dispatch.mockRejectedValue(
      new ProblemException('dispatch-failed', 502, 'Could not queue the proposal', 'queue down'),
    );

    const result = await service.apply(request, admin, 'tok');

    expect(result.applied.categories).toEqual(['mugs']);
    expect(result.queued).toEqual([]);
    expect(result.failed).toEqual([
      { entity: 'Product', fieldName: 'material', reason: 'queue down' },
    ]);
  });

  it('keeps going after one field fails so a later field still reaches the queue', async () => {
    const twoFields: ApplySetupPlanRequest = {
      ...request,
      fields: [
        request.fields[0],
        {
          entity: 'Product',
          field: { name: 'glaze', type: 'string', required: false, default: null },
        },
      ],
    };
    dispatch.dispatch
      .mockRejectedValueOnce(new ProblemException('dispatch-failed', 502, 'Could not queue'))
      .mockResolvedValueOnce('msg-2');

    const result = await service.apply(twoFields, admin, 'tok');

    expect(result.failed.map((f) => f.fieldName)).toEqual(['material']);
    expect(result.queued.map((q) => q.fieldName)).toEqual(['glaze']);
  });

  it('dispatches each field under a tenant-stable thread id so a repeat Apply dedupes', async () => {
    await service.apply(request, admin, 'tok');

    expect(dispatch.dispatch).toHaveBeenCalledWith({
      threadId: 'setup-plan:acme',
      tenantId: 'acme',
      targetEntity: 'Product',
      payload: { addedFields: [request.fields[0].field] },
    });
  });
});

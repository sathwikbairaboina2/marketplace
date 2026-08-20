import { CopywriterService } from './copywriter.service';
import { ScriptedLlmProvider } from '../llm/scripted.provider';

jest.mock('@marketplace/auth', () => ({
  ...jest.requireActual('@marketplace/auth'),
  currentPrincipal: jest.fn(() => ({ tenantId: 'acme', userId: 'u1', role: 'admin' })),
}));
import { currentPrincipal } from '@marketplace/auth';

describe('CopywriterService', () => {
  const llm = new ScriptedLlmProvider();
  const service = new CopywriterService(llm);
  beforeEach(() => llm.reset());

  it('refuses a non-admin in the service, not only on the route', async () => {
    (currentPrincipal as jest.Mock).mockReturnValueOnce({
      tenantId: 'acme',
      userId: 'u1',
      role: 'buyer',
    });
    await expect(service.draft({ name: 'Mug', category: 'ceramics' })).rejects.toMatchObject({
      status: 403,
    });
    expect(llm.calls).toHaveLength(0);
  });

  it('hands the model the facts and returns its prose trimmed', async () => {
    llm.pushText('  A sturdy stoneware mug for slow mornings.  ');
    const result = await service.draft({
      name: 'Coupe Mug',
      category: 'ceramics',
      tone: 'warm',
      audience: 'gift shoppers',
    });
    expect(result.description).toBe('A sturdy stoneware mug for slow mornings.');
    const sent = llm.calls[0].messages[0] as { content: string };
    expect(sent.content).toContain('Coupe Mug');
    expect(sent.content).toContain('warm');
    expect(sent.content).toContain('gift shoppers');
  });

  it('caps a runaway generation at the product contract limit', async () => {
    llm.pushText('x'.repeat(9000));
    const result = await service.draft({ name: 'Mug', category: 'ceramics' });
    expect(result.description).toHaveLength(5000);
  });

  it('reports an empty generation instead of returning an empty description', async () => {
    llm.pushText('   ');
    await expect(service.draft({ name: 'Mug', category: 'ceramics' })).rejects.toMatchObject({
      status: 502,
    });
  });
});

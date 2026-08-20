import { Injectable } from '@nestjs/common';
import { TenantPrincipal } from '@marketplace/auth';
import { ApplySetupPlanRequest, ApplySetupPlanResponse } from '@marketplace/contracts';
import { ProblemException } from '../common/problem';
import { DispatchService } from '../dispatch/dispatch.service';
import { EngineClient } from '../engine-client/engine.client';

@Injectable()
export class SetupPlanService {
  constructor(
    private readonly engine: EngineClient,
    private readonly dispatch: DispatchService,
  ) {}

  /**
   * Applies the subset of a setup plan the owner ticked.
   *
   * Two halves with two different paths: `sellsWhat` and `categories` are the
   * storefront's, written straight into the draft, while a field addition can
   * only ever become a *proposed* flow that an administrator executes. The
   * response says which was which rather than collapsing both into one answer.
   */
  async apply(
    request: ApplySetupPlanRequest,
    principal: TenantPrincipal,
    token: string,
  ): Promise<ApplySetupPlanResponse> {
    // Checked here as well as declared on the route: the decorator documents
    // the restriction in the OpenAPI document, this is what protects a
    // non-HTTP caller. 404 rather than 403 -- a 403 would confirm the draft
    // exists to somebody not allowed to see it.
    if (principal.role !== 'admin') {
      throw new ProblemException('not-found', 404, 'Not Found', 'no such resource');
    }

    const draft = await this.engine.getStorefrontDraft(token);
    if (!draft) {
      throw new ProblemException(
        'not-found',
        404,
        'Not Found',
        'there is no storefront draft to apply a setup plan to',
      );
    }

    // Storefront first. If this throws, nothing is queued: no field additions
    // for a shop whose type never took.
    await this.engine.putStorefrontDraft(
      { ...draft, sellsWhat: request.sellsWhat, categories: request.categories },
      token,
    );

    const queued: ApplySetupPlanResponse['queued'] = [];
    const failed: ApplySetupPlanResponse['failed'] = [];

    for (const { entity, field } of request.fields) {
      try {
        const messageId = await this.dispatch.dispatch({
          // Keyed to the tenant rather than a chat thread: the deduplication
          // id is derived from this and the payload, so a double-clicked
          // Apply -- in one tab or two -- collapses inside the queue's
          // five-minute window instead of proposing the same field twice.
          threadId: `setup-plan:${principal.tenantId}`,
          tenantId: principal.tenantId,
          targetEntity: entity,
          payload: { addedFields: [field] },
        });
        queued.push({ entity, fieldName: field.name, messageId });
      } catch (err) {
        // A partial success is not an error: the owner is told exactly which
        // fields did not make it rather than handed one aggregate failure
        // that hides the storefront half having already applied.
        failed.push({
          entity,
          fieldName: field.name,
          reason:
            err instanceof ProblemException
              ? (err.problem.detail ?? err.problem.title)
              : 'could not queue the proposal',
        });
      }
    }

    return {
      applied: { sellsWhat: request.sellsWhat, categories: request.categories },
      queued,
      failed,
    };
  }
}

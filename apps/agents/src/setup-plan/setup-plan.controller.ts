import { Body, Controller, Headers, HttpCode, Post, Req } from '@nestjs/common';
import { ApplySetupPlanRequestSchema, ApplySetupPlanResponse } from '@marketplace/contracts';
import { ProblemException } from '../common/problem';
import { Roles } from '../auth/roles.decorator';
import { getTenantPrincipal } from '../auth/request-principal';
import { SetupPlanService } from './setup-plan.service';

@Controller('setup-plan')
export class SetupPlanController {
  constructor(private readonly setupPlan: SetupPlanService) {}

  // 200, not 201: the storefront draft is updated in place and the field
  // additions become proposals, so nothing is created at this URL. Declared
  // here as well as checked in the service, per the admin-route house rule.
  @Post('apply')
  @Roles('admin')
  @HttpCode(200)
  apply(
    @Body() body: unknown,
    @Req() req: object,
    // The guard has already verified this token; it is re-used verbatim so
    // the engine applies the caller's own scoping to the draft write.
    @Headers('authorization') authorization: string | undefined,
  ): Promise<ApplySetupPlanResponse> {
    const parsed = ApplySetupPlanRequestSchema.safeParse(body ?? {});
    if (!parsed.success) {
      throw new ProblemException(
        'invalid-request',
        400,
        'Invalid setup plan',
        parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; '),
      );
    }

    const principal = getTenantPrincipal(req);
    if (!principal) {
      throw new ProblemException('unauthorized', 401, 'Unauthorized');
    }

    const token = authorization?.replace(/^Bearer\s+/i, '') ?? '';
    return this.setupPlan.apply(parsed.data, principal, token);
  }
}

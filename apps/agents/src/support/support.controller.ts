import { Body, Controller, Headers, HttpCode, Post } from '@nestjs/common';
import { SupportAskRequestSchema, SupportAskResponse } from '@marketplace/contracts';
import { ProblemException } from '../common/problem';
import { SupportService } from './support.service';

@Controller('support')
export class SupportController {
  constructor(private readonly support: SupportService) {}

  @Post('ask')
  @HttpCode(200)
  ask(
    @Body() body: unknown,
    // The guard has already verified this token; it is re-used verbatim so
    // the engine applies the caller's own scoping to the order lookup.
    @Headers('authorization') authorization: string | undefined,
  ): Promise<SupportAskResponse> {
    const parsed = SupportAskRequestSchema.safeParse(body ?? {});
    if (!parsed.success) {
      throw new ProblemException(
        'invalid-request',
        400,
        'Invalid question',
        parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; '),
      );
    }
    const token = authorization?.replace(/^Bearer\s+/i, '') ?? '';
    return this.support.ask(parsed.data.question, token);
  }
}

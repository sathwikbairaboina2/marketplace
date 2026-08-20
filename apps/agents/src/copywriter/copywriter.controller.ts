import { Body, Controller, HttpCode, Post } from '@nestjs/common';
import {
  CopywriterDraftRequestSchema,
  CopywriterDraftResponse,
} from '@marketplace/contracts';
import { ProblemException } from '../common/problem';
import { Roles } from '../auth/roles.decorator';
import { CopywriterService } from './copywriter.service';

@Controller('copywriter')
export class CopywriterController {
  constructor(private readonly copywriter: CopywriterService) {}

  // 200, not 201: nothing is stored -- the seller gets text to edit and save
  // through the product form like any other description. Declared here as
  // well as checked in the service, per the admin-route house rule.
  @Post('draft')
  @Roles('admin')
  @HttpCode(200)
  draft(@Body() body: unknown): Promise<CopywriterDraftResponse> {
    const parsed = CopywriterDraftRequestSchema.safeParse(body ?? {});
    if (!parsed.success) {
      throw new ProblemException(
        'invalid-request',
        400,
        'Invalid draft request',
        parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; '),
      );
    }
    return this.copywriter.draft(parsed.data);
  }
}

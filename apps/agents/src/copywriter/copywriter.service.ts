import { Inject, Injectable } from '@nestjs/common';
import { currentPrincipal } from '@marketplace/auth';
import { CopywriterDraftRequest, CopywriterDraftResponse } from '@marketplace/contracts';
import { LLM, LlmProvider } from '../llm/llm.provider';
import { ProblemException } from '../common/problem';

const SYSTEM = [
  'You write product descriptions for a small independent shop.',
  'Write 2-4 sentences of plain, concrete prose about the product you are given.',
  'No headings, no bullet points, no quotes around the text, no emoji.',
  'Never invent specifications, materials, dimensions or prices that were not provided.',
].join(' ');

@Injectable()
export class CopywriterService {
  constructor(@Inject(LLM) private readonly llm: LlmProvider) {}

  async draft(input: CopywriterDraftRequest): Promise<CopywriterDraftResponse> {
    // Service-checked as well as route-guarded: drafting copy is the
    // seller's tool, and a non-HTTP caller must hit the same wall.
    if (currentPrincipal().role !== 'admin') {
      throw new ProblemException('forbidden', 403, 'Only an admin can draft product copy');
    }

    const facts = [
      `Product name: ${input.name}`,
      `Category: ${input.category}`,
      ...(input.tone ? [`Tone of voice: ${input.tone}`] : []),
      ...(input.audience ? [`Audience: ${input.audience}`] : []),
    ].join('\n');

    const text = await this.llm.text({
      system: SYSTEM,
      messages: [{ role: 'user', content: facts }],
    });

    // The product contract caps descriptions at 5000; a runaway generation is
    // trimmed rather than bounced back at the seller as their error.
    const description = text.trim().slice(0, 5000);
    if (description.length === 0) {
      throw new ProblemException(
        'internal-error',
        502,
        'The model returned nothing',
        'try again; the description field is still editable by hand',
      );
    }
    return { description };
  }
}

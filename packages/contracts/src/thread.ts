import { z } from 'zod';
import { IsoDateTimeSchema, UlidSchema } from './common';

export const MAX_MESSAGE_LENGTH = 2000;

/**
 * A message carries its text and nothing else.
 *
 * `.strict()` is what keeps the stage and the author server-chosen. The engine
 * stamps the stage from the order it just read, so there is no way to address a
 * stage the order has already left -- which is what makes "the thread closes
 * when the order advances" a property of the system rather than a rule somebody
 * has to remember to enforce.
 */
export const CreateMessageSchema = z
  .object({ body: z.string().trim().min(1).max(MAX_MESSAGE_LENGTH) })
  .strict();
export type CreateMessage = z.infer<typeof CreateMessageSchema>;

export const MessageAuthorRoleSchema = z.enum(['buyer', 'seller']);
export type MessageAuthorRole = z.infer<typeof MessageAuthorRoleSchema>;

export const MessageResponseSchema = z
  .object({
    entityType: z.literal('Message'),
    id: UlidSchema,
    orderId: UlidSchema,
    stageId: z.string(),
    authorUserId: z.string(),
    // Copied at write time rather than resolved when the thread is read: a role
    // can change later, and a conversation should show who somebody was when
    // they wrote it. The same argument `unitPriceMinor` makes for price.
    authorRole: MessageAuthorRoleSchema,
    body: z.string(),
    createdAt: IsoDateTimeSchema,
  })
  .strict();
export type MessageResponse = z.infer<typeof MessageResponseSchema>;

export interface MessageRecord extends MessageResponse {
  PK: string;
  SK: string;
}

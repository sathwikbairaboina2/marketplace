// The implementation lives in @marketplace/auth so the Engine and the Agents
// service validate and derive tenant identity the exact same way.
//
// TENANT_ID_PATTERN is re-exported (not just principalFromClaims) because
// messaging/sqs-consumer.service.ts imports it directly: that consumer is a
// second, unauthenticated entry point for a tenant id, and it must re-check
// the value against this exact same pattern before it ever reaches a
// partition key. See the comment on TENANT_ID_PATTERN in
// packages/auth/src/claims.ts.
export { principalFromClaims, TENANT_ID_PATTERN } from '@marketplace/auth';

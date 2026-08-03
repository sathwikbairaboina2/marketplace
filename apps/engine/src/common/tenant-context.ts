// The implementation lives in @marketplace/auth so the Engine and the Agents
// service share one tenant-context store and one JWT verifier.
export {
  runWithTenant,
  enterTenant,
  currentPrincipal,
  currentTenantId,
  type TenantPrincipal,
} from '@marketplace/auth';

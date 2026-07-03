import type { IExecuteFunctions, ITriggerFunctions } from 'n8n-workflow';
import { NodeOperationError } from 'n8n-workflow';
import type { BackendCapabilities, BackendId } from './Types';
import { buildUnsupportedFeatureError, findBackendSupporting } from './CapabilityRegistry';

/**
 * Throws a descriptive NodeOperationError (never silently no-ops) if the
 * given backend doesn't declare support for `feature`.
 */
export function assertCapability(
  ctx: IExecuteFunctions | ITriggerFunctions,
  backendId: BackendId,
  capabilities: BackendCapabilities,
  feature: keyof BackendCapabilities,
  itemIndex?: number,
): void {
  if (capabilities[feature]) return;
  const suggestBackend = findBackendSupporting(feature, backendId);
  const info = buildUnsupportedFeatureError(backendId, feature, suggestBackend);
  throw new NodeOperationError(ctx.getNode(), info.message, {
    itemIndex,
    description: info.description,
  });
}

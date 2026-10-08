import { applyBranch } from './branches.js';
import { resolveFit } from './resolve.js';
import type { FitDocument, JsonObject, Library, ResolveOptions } from './types.js';

// Wire envelope shared with the engine (`exfa/compute@1` requests, `exfa/compute-result@1` responses).
// `fit` holds a FitSpec (the engine FitRequest shape plus optional entry `id`s); `batch` holds a BatchSpec
// (the engine BatchRequest: batch_version, exactly one of fits/variants/product/sweep, fields, deltas, ...).
export interface ComputeCalcRequest { format: 'exfa/compute@1'; operation: 'calc'; fit: JsonObject }
export interface ComputeBatchRequest { format: 'exfa/compute@1'; operation: 'batch'; batch: JsonObject }
export type ComputeRequest = ComputeCalcRequest | ComputeBatchRequest;

export interface ComputeError { code: string; message: string; path?: string }
export interface ComputeCalcResult { format: 'exfa/compute-result@1'; operation: 'calc'; result?: JsonObject; error?: ComputeError }
export interface ComputeBatchResult { format: 'exfa/compute-result@1'; operation: 'batch'; result?: JsonObject; error?: ComputeError }
export type ComputeResult = ComputeCalcResult | ComputeBatchResult;

/** Resolves a host document into a `calc` compute request envelope (FitSpec inside). */
export function computeRequest(library: Library, doc: FitDocument, options: ResolveOptions = {}): ComputeCalcRequest {
  const effective = options.branch ? applyBranch(doc, options.branch) : doc;
  const fit = resolveFit(effective.fit, { library, depth: 0, document_id: effective.id, refs: effective.refs, links: effective.links });
  return { format: 'exfa/compute@1', operation: 'calc', fit };
}

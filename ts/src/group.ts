import { applyBranch } from './branches.js';
import type { ComputeBatchRequest } from './compute.js';
import { resolveFit } from './resolve.js';
import type { FitDocument, FitRequest, FitRequestProjected, Group, Library, ProjectedFitSelect, ResolveOptions } from './types.js';

const clone = <T>(value: T): T => structuredClone(value);
const uid = () => globalThis.crypto?.randomUUID?.() ?? `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;

/** A fresh empty group document (`exfa/group@1`). */
export function newGroup(name?: string, id?: string): Group {
  return { format: 'exfa/group@1', id: id ?? uid(), name: name ?? 'New group', actors: [], relations: [] };
}

export interface CompiledGroup {
  request: ComputeBatchRequest;
  issues: string[];
}

/**
 * Lowers a group into one `exfa/compute@1` batch request: every actor resolves to a `batch.fits[]` entry,
 * `project` relations push `{kind:'fit'}` entries (with a strict-whitelist `select` when the relation names
 * `source_item_ids`) onto the target's `projected[]`, and `command` relations push the source request onto the
 * target's `fleet.booster_fits[]`. Problems are reported as issues, not thrown.
 */
export function compileGroup(library: Library, group: Group, options: ResolveOptions = {}): CompiledGroup {
  const issues: string[] = [];
  const actorsById = new Map(group.actors.map((actor) => [actor.id, actor]));
  const resolved = new Map<string, { doc: FitDocument; request: FitRequest }>();
  for (const actor of group.actors) {
    const original = library.fits[actor.fit_id];
    if (!original) {
      issues.push(`actor '${actor.id}': fit not found: '${actor.fit_id}'`);
      continue;
    }
    const doc = options.branch ? applyBranch(original, options.branch) : original;
    const request = resolveFit(doc.fit, { library, depth: 0, document_id: doc.id, refs: doc.refs, links: doc.links });
    resolved.set(actor.id, { doc, request });
  }

  for (const relation of group.relations ?? []) {
    if (relation.enabled === false) continue;
    if (relation.kind !== 'project' && relation.kind !== 'command') {
      issues.push(`relation '${relation.id}': unknown kind '${relation.kind}'`);
      continue;
    }
    const sourceActor = actorsById.get(relation.source);
    const source = sourceActor && resolved.get(relation.source);
    if (!sourceActor || !source) {
      issues.push(`relation '${relation.id}': source actor '${relation.source}' is missing or unresolved`);
      continue;
    }
    let select: ProjectedFitSelect | undefined;
    if (relation.source_item_ids?.length) {
      const sourceDoc = library.fits[sourceActor.fit_id] as FitDocument;
      const selectIds = { module_ids: [] as string[], drone_ids: [] as string[], fighter_ids: [] as string[] };
      for (const itemId of relation.source_item_ids) {
        if (sourceDoc.fit.modules.some((item) => item.id === itemId)) selectIds.module_ids.push(itemId);
        else if (sourceDoc.fit.drones.some((item) => item.id === itemId)) selectIds.drone_ids.push(itemId);
        else if (sourceDoc.fit.fighters.some((item) => item.id === itemId)) selectIds.fighter_ids.push(itemId);
        else issues.push(`relation '${relation.id}': unknown source item '${itemId}' in fit '${sourceDoc.id}'`);
      }
      select = selectIds;
    }
    for (const targetId of relation.targets ?? []) {
      const target = actorsById.has(targetId) ? resolved.get(targetId) : undefined;
      if (!target) {
        issues.push(`relation '${relation.id}': target actor '${targetId}' is missing or unresolved`);
        continue;
      }
      if (relation.kind === 'project') {
        const entry: Extract<FitRequestProjected, { kind: 'fit' }> = {
          kind: 'fit',
          fit: clone(source.request),
          amount: relation.amount ?? 1,
          distance_m: relation.distance_m ?? null,
        };
        if (select) entry.select = clone(select);
        target.request.projected.push(entry);
      } else {
        target.request.fleet.booster_fits.push(clone(source.request));
      }
    }
  }

  const fits = group.actors.flatMap((actor) => {
    const entry = resolved.get(actor.id);
    return entry ? [{ id: actor.id, label: actor.label ?? entry.doc.name, fit: entry.request }] : [];
  });
  return {
    request: { format: 'exfa/compute@1', operation: 'batch', batch: { batch_version: 1, fits } },
    issues,
  };
}

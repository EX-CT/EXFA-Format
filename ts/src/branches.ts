import { FormatError, type Alternative, type AlternativeOption, type Branch, type FitDocument } from './types.js';

export type AlternativeTarget = { list: 'modules' | 'drones' | 'cargo'; index: number };

const clone = <T>(value: T): T => structuredClone(value);
const newId = () => globalThis.crypto?.randomUUID?.() ?? `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;

function currentOption(item: Record<string, unknown>, list: AlternativeTarget['list']): AlternativeOption {
  const option: AlternativeOption = { type_id: item.type_id as number };
  if (list === 'modules' && Object.hasOwn(item, 'charge_type_id')) option.charge_type_id = item.charge_type_id as number | null;
  if (list !== 'modules' && typeof item.quantity === 'number') option.quantity = item.quantity;
  return option;
}

function withOption<T extends Record<string, unknown>>(item: T, option: AlternativeOption, list: AlternativeTarget['list']): T {
  const result: Record<string, unknown> = { ...item, type_id: option.type_id };
  if (list === 'modules' && Object.hasOwn(option, 'charge_type_id')) result.charge_type_id = option.charge_type_id;
  if (list !== 'modules' && Object.hasOwn(option, 'quantity')) result.quantity = option.quantity as number;
  return result as T;
}

export function applyBranch(doc: FitDocument, branchId: string): FitDocument {
  const branch = doc.branches.find((candidate) => candidate.id === branchId);
  if (!branch) throw new FormatError('BRANCH_NOT_FOUND', `Branch not found: ${branchId}`);
  const alternatives = new Map(doc.alternatives.map((alternative) => [alternative.id, alternative]));
  const result = clone(doc);
  for (const list of ['modules', 'drones', 'cargo'] as const) {
    const updated = result.fit[list].map((item) => {
      const altId = item.alt_id;
      if (!altId) return item;
      const pick = branch.picks[altId];
      if (pick === undefined) return item;
      const alternative = alternatives.get(altId);
      const option = alternative?.options[pick];
      return option ? withOption(item, option, list) : item;
    });
    Object.assign(result.fit, { [list]: updated });
  }
  result.active_branch = branchId;
  return result;
}

function optionMatches(item: Record<string, unknown>, option: AlternativeOption, list: AlternativeTarget['list']): boolean {
  if (option.type_id !== item.type_id) return false;
  if (list === 'modules' && Object.hasOwn(option, 'charge_type_id') && option.charge_type_id !== item.charge_type_id) return false;
  if (list !== 'modules' && Object.hasOwn(option, 'quantity') && option.quantity !== item.quantity) return false;
  return true;
}

function currentIndex(doc: FitDocument, alternative: Alternative): number {
  const lists = [
    { name: 'modules', items: doc.fit.modules },
    { name: 'drones', items: doc.fit.drones },
    { name: 'cargo', items: doc.fit.cargo },
  ] as const;
  for (const list of lists) {
    const item = list.items.find((candidate) => candidate.alt_id === alternative.id);
    if (item) return alternative.options.findIndex((option) => optionMatches(item as unknown as Record<string, unknown>, option, list.name));
  }
  return -1;
}

export function captureBranch(doc: FitDocument, name: string): FitDocument {
  const branch: Branch = {
    id: newId(),
    name,
    picks: Object.fromEntries(doc.alternatives.flatMap((alternative) => {
      const index = currentIndex(doc, alternative);
      return index < 0 ? [] : [[alternative.id, index]];
    })),
  };
  const result = clone(doc);
  result.branches.push(branch);
  return result;
}

export function addAlternative(doc: FitDocument, target: AlternativeTarget, typeIds: number[]): FitDocument {
  const result = clone(doc);
  const list = result.fit[target.list] as Record<string, unknown>[];
  const item = list[target.index];
  if (!item) throw new FormatError('ITEM_NOT_FOUND', `No ${target.list} item at index ${target.index}`);

  let alternative = result.alternatives.find((candidate) => candidate.id === item.alt_id);
  if (!alternative) {
    alternative = { id: newId(), options: [currentOption(item, target.list)] };
    result.alternatives.push(alternative);
  }

  const included = new Set(alternative.options.map((option) => option.type_id));
  for (const typeId of typeIds) {
    if (!included.has(typeId)) {
      alternative.options.push({ type_id: typeId });
      included.add(typeId);
    }
  }

  const altId = alternative.id;
  item.alt_id = altId;
  if (target.list === 'modules' && item.group != null) {
    for (const sibling of result.fit.modules) if (sibling.group === item.group) sibling.alt_id = altId;
  }
  return result;
}

export function removeAlternative(doc: FitDocument, alternativeId: string): FitDocument {
  const result = clone(doc);
  result.alternatives = result.alternatives.filter((alternative) => alternative.id !== alternativeId);
  for (const item of [...result.fit.modules, ...result.fit.drones, ...result.fit.cargo]) {
    if (item.alt_id === alternativeId) delete item.alt_id;
  }
  for (const branch of result.branches) delete branch.picks[alternativeId];
  return result;
}

export function branchDiverged(doc: FitDocument): boolean {
  const branch = doc.branches.find((candidate) => candidate.id === doc.active_branch);
  if (!branch) return false;
  return doc.alternatives.some((alternative) => {
    const pick = branch.picks[alternative.id];
    if (pick === undefined) return false;
    const selected = alternative.options[pick];
    const lists = [
      { name: 'modules', items: doc.fit.modules },
      { name: 'drones', items: doc.fit.drones },
      { name: 'cargo', items: doc.fit.cargo },
    ] as const;
    const items = lists.flatMap((list) => list.items.filter((item) => item.alt_id === alternative.id)
      .map((item) => ({ item: item as unknown as Record<string, unknown>, list: list.name })));
    return currentIndex(doc, alternative) !== pick
      || items.some(({ item, list }) => selected == null || !optionMatches(item, selected, list));
  });
}

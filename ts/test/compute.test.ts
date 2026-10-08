import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { computeRequest, resolve, type Library } from '../src';
import { fixturePath, loadFormatSchemas } from '../scripts/engine-schema.mjs';

const library = JSON.parse(readFileSync(fixturePath('fixtures/library.json'), 'utf8')) as Library;

describe('compute request envelope', () => {
  it('wraps the resolved FitSpec in an exfa/compute@1 calc envelope', () => {
    const request = computeRequest(library, library.fits['app-basic']);
    expect(request).toMatchObject({ format: 'exfa/compute@1', operation: 'calc' });
    expect(request.fit).toEqual(resolve(library, 'app-basic'));
  });

  it('applies the selected branch before wrapping', () => {
    const request = computeRequest(library, library.fits.complex, { branch: 'budget' });
    const modules = (request.fit as { modules: { type_id: number; charge_type_id: number | null }[] }).modules;
    expect(modules.map((module) => module.type_id)).toEqual([2874, 2874]);
    expect(modules.map((module) => module.charge_type_id)).toEqual([21899, 21899]);
  });

  it('passes item ids through into the FitSpec', () => {
    const document = structuredClone(library.fits['app-basic']);
    document.fit.modules[0].id = 'mod-1';
    const request = computeRequest(library, document);
    expect((request.fit.modules as { id?: string }[])[0].id).toBe('mod-1');
  });

  it('validates the calc and batch envelopes against compute.schema.json', async () => {
    const validators = await loadFormatSchemas();
    const request = computeRequest(library, library.fits['app-basic']);
    expect(validators.validateCompute?.(request), JSON.stringify(validators.validateCompute?.errors)).toBe(true);
    const batch = { format: 'exfa/compute@1', operation: 'batch', batch: { batch_version: 1, fits: [] } };
    expect(validators.validateCompute?.(batch), JSON.stringify(validators.validateCompute?.errors)).toBe(true);
    const wrong = { format: 'exfa/compute@1', operation: 'calc' };
    expect(validators.validateCompute?.(wrong)).toBe(false);
  });
});

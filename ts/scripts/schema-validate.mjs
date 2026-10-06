import { readFile } from 'node:fs/promises';
import { loadEngineValidators, loadFormatSchemas } from './engine-schema.mjs';
import { toFiles, migrate } from '../dist/index.js';

const root = new URL('../../', import.meta.url);
const readJson = async (path) => JSON.parse(await readFile(new URL(path, root), 'utf8'));
const fail = (label, validator, value) => {
  if (!validator(value)) throw new Error(`${label} failed:\n${JSON.stringify(validator.errors, null, 2)}`);
};

const library = await readJson('fixtures/library.json');
const requests = await readJson('fixtures/requests.json');
const legacy = await readJson('fixtures/legacy-v0.json');
const formatValidators = await loadFormatSchemas();
const engineValidators = await loadEngineValidators();
fail('library.schema.json', formatValidators.validateLibrary, library);
for (const document of Object.values(library.fits)) {
  fail(`fit-document.schema.json (${document.id})`, formatValidators.validateFitDocument, document);
}
const migrated = migrate(legacy);
fail('library.schema.json (migrated backup)', formatValidators.validateLibrary, migrated);
const index = JSON.parse(toFiles(library)[0].text);
fail('library-index.schema.json', formatValidators.validateLibraryIndex, index);
for (const [fitId, expected] of Object.entries(requests)) {
  fail(`Engine v0.2.0 compatibility schema (${fitId})`, engineValidators.validateAppCompatible, expected);
  fail(`Engine v0.2.0 exact schema projection (${fitId})`, engineValidators.validateExact, engineValidators.engineSchemaView(expected));
}
console.log('AJV fixture validation passed: Format schemas, Engine v0.2.0 schema projection, and App compatibility schema.');

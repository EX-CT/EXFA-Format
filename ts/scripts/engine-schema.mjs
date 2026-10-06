import Ajv2020 from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const root = new URL('../../', import.meta.url);
const readJson = async (path) => JSON.parse(await readFile(new URL(path, root), 'utf8'));
const clone = (value) => structuredClone(value);
const nullable = (schema) => ({ anyOf: [schema, { type: 'null' }] });

export function appCompatibleEngineSchema(source) {
  const schema = clone(source);
  schema.$id = 'https://github.com/EX-CT/EXFA-Format/fixtures/engine/fit-request.app-compatible.schema.json';
  const properties = schema.properties;
  properties.ship.properties.mode_type_id = nullable(properties.ship.properties.mode_type_id);
  properties.character.properties.security_status = nullable(properties.character.properties.security_status);
  for (const key of ['charge_type_id', 'mutation', 'spool']) {
    schema.$defs.module.properties[key] = nullable(schema.$defs.module.properties[key]);
  }
  schema.properties.drones.items.properties.mutation = nullable(schema.properties.drones.items.properties.mutation);
  properties.fighters.items.properties.abilities = nullable(properties.fighters.items.properties.abilities);
  properties.damage_pattern = nullable(properties.damage_pattern);
  properties.target_profile = nullable(properties.target_profile);
  const security = properties.environment.properties.system_security;
  security.enum = [...new Set([...security.enum, 'hisec', 'wspace', null])];
  properties.options.properties.cap_sim.properties.max_time_s = nullable(properties.options.properties.cap_sim.properties.max_time_s);
  const targetProfile = schema.$defs.scenarioTarget.properties.profile.properties;
  targetProfile.max_velocity = nullable(targetProfile.max_velocity);
  targetProfile.hp = nullable(targetProfile.hp);
  return schema;
}

function removeNull(object, key) {
  if (object?.[key] === null) delete object[key];
}

function engineSchemaView(request) {
  const copy = clone(request);
  const visit = (fit) => {
    if (!fit || typeof fit !== 'object') return;
    removeNull(fit.ship, 'mode_type_id');
    removeNull(fit.character, 'security_status');
    for (const module of fit.modules ?? []) {
      removeNull(module, 'charge_type_id');
      removeNull(module, 'mutation');
      removeNull(module, 'spool');
    }
    for (const drone of fit.drones ?? []) removeNull(drone, 'mutation');
    for (const fighter of fit.fighters ?? []) removeNull(fighter, 'abilities');
    removeNull(fit.environment, 'system_security');
    if (fit.environment?.system_security === 'hisec') fit.environment.system_security = 'highsec';
    if (fit.environment?.system_security === 'wspace') fit.environment.system_security = 'wormhole';
    removeNull(fit, 'damage_pattern');
    removeNull(fit, 'target_profile');
    removeNull(fit.options?.cap_sim, 'max_time_s');
    for (const booster of fit.fleet?.booster_fits ?? []) visit(booster);
    for (const item of fit.projected ?? []) {
      if (item.kind === 'fit') visit(item.fit);
      if (item.kind === 'module') {
        removeNull(item.module, 'charge_type_id');
        removeNull(item.module, 'mutation');
        removeNull(item.module, 'spool');
      }
    }
    for (const scenario of fit.scenarios ?? []) {
      const target = scenario.target;
      if (target?.fit) visit(target.fit);
      if (target?.profile) {
        removeNull(target.profile, 'max_velocity');
        removeNull(target.profile, 'hp');
      }
    }
  };
  visit(copy);
  return copy;
}

export async function loadEngineValidators() {
  const engineSchema = await readJson('fixtures/engine/fit-request.schema.json');
  const compatibleSchema = appCompatibleEngineSchema(engineSchema);
  const exactAjv = new Ajv2020({ allErrors: true, strict: false });
  addFormats(exactAjv);
  const compatibleAjv = new Ajv2020({ allErrors: true, strict: false });
  addFormats(compatibleAjv);
  return {
    engineSchema,
    validateExact: exactAjv.compile(engineSchema),
    validateAppCompatible: compatibleAjv.compile(compatibleSchema),
    engineSchemaView,
  };
}

export async function loadFormatSchemas() {
  const schemas = await Promise.all([
    readJson('schema/common.schema.json'),
    readJson('schema/scenario.schema.json'),
    readJson('schema/fit-document.schema.json'),
    readJson('schema/library.schema.json'),
    readJson('schema/library-index.schema.json'),
  ]);
  const ajv = new Ajv2020({ allErrors: true, strict: false });
  addFormats(ajv);
  for (const schema of schemas) ajv.addSchema(schema);
  return {
    validateFitDocument: ajv.getSchema('https://github.com/EX-CT/EXFA-Format/schema/fit-document.schema.json'),
    validateLibrary: ajv.getSchema('https://github.com/EX-CT/EXFA-Format/schema/library.schema.json'),
    validateLibraryIndex: ajv.getSchema('https://github.com/EX-CT/EXFA-Format/schema/library-index.schema.json'),
  };
}

export function fixturePath(path) {
  return fileURLToPath(new URL(path, root));
}

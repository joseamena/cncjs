import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import config from '../configstore';

const MANIFEST_NAME = 'guitar-library.json';
const MAX_GCODE_SIZE = 50 * 1024 * 1024;
const GCODE_EXTENSIONS = ['.gcode', '.nc', '.tap'];

class GuitarLibraryError extends Error {
  constructor(message, status = 400) {
    super(message);
    this.name = 'GuitarLibraryError';
    this.status = status;
  }
}

const requireString = (value, label) => {
  if (typeof value !== 'string' || !value.trim()) {
    throw new GuitarLibraryError(`${label} must be a non-empty string`);
  }
};

const requireUniqueIds = (items, label) => {
  const ids = new Set();
  items.forEach((item, index) => {
    requireString(item.id, `${label}[${index}].id`);
    if (ids.has(item.id)) {
      throw new GuitarLibraryError(`Duplicate ${label} id: ${item.id}`);
    }
    ids.add(item.id);
  });
};

const assertArray = (value, label) => {
  if (!Array.isArray(value)) {
    throw new GuitarLibraryError(`${label} must be an array`);
  }
};

const resolveContainedFile = (root, relativeFile) => {
  requireString(relativeFile, 'operation.gcode');
  const extension = path.extname(relativeFile).toLowerCase();
  if (!GCODE_EXTENSIONS.includes(extension)) {
    throw new GuitarLibraryError(`Unsupported G-code extension: ${extension || '(none)'}`);
  }

  const resolvedRoot = fs.realpathSync(root);
  const candidate = path.resolve(resolvedRoot, relativeFile);
  const relative = path.relative(resolvedRoot, candidate);
  if (relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new GuitarLibraryError(`G-code path leaves the library: ${relativeFile}`);
  }
  if (!fs.existsSync(candidate) || !fs.statSync(candidate).isFile()) {
    throw new GuitarLibraryError(`G-code file not found: ${relativeFile}`, 404);
  }

  const realFile = fs.realpathSync(candidate);
  const realRelative = path.relative(resolvedRoot, realFile);
  if (realRelative.startsWith('..') || path.isAbsolute(realRelative)) {
    throw new GuitarLibraryError(`G-code symlink leaves the library: ${relativeFile}`);
  }

  const stat = fs.statSync(realFile);
  if (stat.size > MAX_GCODE_SIZE) {
    throw new GuitarLibraryError(`G-code file exceeds 50 MB: ${relativeFile}`);
  }

  return { path: realFile, size: stat.size };
};

const digest = (content) => crypto.createHash('sha256').update(content).digest('hex');

const validateOperation = (root, operation, label) => {
  requireString(operation.id, `${label}.id`);
  requireString(operation.name, `${label}.name`);
  requireString(operation.tool, `${label}.tool`);
  assertArray(operation.checklist, `${label}.checklist`);
  operation.checklist.forEach((item, index) => requireString(item, `${label}.checklist[${index}]`));
  const file = resolveContainedFile(root, operation.gcode);
  const content = fs.readFileSync(file.path);

  return {
    ...operation,
    executable: operation.executable === true,
    size: file.size,
    checksum: digest(content)
  };
};

export const getLibraryRoot = () => {
  const configured = config.get('guitarLibrary.directory');
  if (configured) {
    return path.resolve(configured);
  }

  const candidates = [
    path.resolve(process.cwd(), 'guitar-library'),
    path.resolve(__dirname, '../../../guitar-library'),
    path.resolve(__dirname, '../../../../guitar-library')
  ];
  return candidates.find(candidate => fs.existsSync(candidate)) || candidates[0];
};

export const loadLibrary = (root = getLibraryRoot()) => {
  if (!fs.existsSync(root) || !fs.statSync(root).isDirectory()) {
    throw new GuitarLibraryError(`Guitar library directory not found: ${root}`, 404);
  }

  const manifestPath = path.join(root, config.get('guitarLibrary.manifest', MANIFEST_NAME));
  if (!fs.existsSync(manifestPath)) {
    throw new GuitarLibraryError(`Guitar library manifest not found: ${manifestPath}`, 404);
  }

  let manifest;
  try {
    manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  } catch (err) {
    throw new GuitarLibraryError(`Invalid guitar library JSON: ${err.message}`);
  }

  if (manifest.version !== 1) {
    throw new GuitarLibraryError('guitar-library.json must use version 1');
  }
  assertArray(manifest.models, 'models');
  requireUniqueIds(manifest.models, 'models');

  const models = manifest.models.map((model, modelIndex) => {
    requireString(model.name, `models[${modelIndex}].name`);
    assertArray(model.parts, `models[${modelIndex}].parts`);
    requireUniqueIds(model.parts, `${model.id}.parts`);

    const parts = model.parts.map((part, partIndex) => {
      requireString(part.name, `${model.id}.parts[${partIndex}].name`);
      assertArray(part.configurations, `${model.id}.${part.id}.configurations`);
      requireUniqueIds(part.configurations, `${model.id}.${part.id}.configurations`);

      const configurations = part.configurations.map((configuration, configurationIndex) => {
        requireString(configuration.name, `${model.id}.${part.id}.configurations[${configurationIndex}].name`);
        assertArray(configuration.operations, `${model.id}.${part.id}.${configuration.id}.operations`);
        requireUniqueIds(configuration.operations, `${model.id}.${part.id}.${configuration.id}.operations`);

        const operations = configuration.operations.map((operation, operationIndex) => validateOperation(
          root,
          operation,
          `${model.id}.${part.id}.${configuration.id}.operations[${operationIndex}]`
        ));

        return { ...configuration, operations };
      });

      return { ...part, configurations };
    });

    return { ...model, parts };
  });

  return { version: 1, models };
};

export const findOperation = (selection, root = getLibraryRoot()) => {
  const library = loadLibrary(root);
  const model = library.models.find(item => item.id === selection.modelId);
  const part = model && model.parts.find(item => item.id === selection.partId);
  const configuration = part && part.configurations.find(item => item.id === selection.configurationId);
  const operation = configuration && configuration.operations.find(item => item.id === selection.operationId);

  if (!model || !part || !configuration || !operation) {
    throw new GuitarLibraryError('The selected guitar operation does not exist', 404);
  }

  const file = resolveContainedFile(root, operation.gcode);
  const gcode = fs.readFileSync(file.path, 'utf8');
  const checksum = digest(gcode);
  if (checksum !== operation.checksum) {
    throw new GuitarLibraryError('The G-code changed while the library was being read', 409);
  }

  return {
    selection: {
      modelId: model.id,
      modelName: model.name,
      partId: part.id,
      partName: part.name,
      configurationId: configuration.id,
      configurationName: configuration.name,
      operationId: operation.id,
      operationName: operation.name
    },
    operation,
    gcode
  };
};

export { GuitarLibraryError };

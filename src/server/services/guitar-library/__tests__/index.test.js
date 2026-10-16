/* global describe, beforeEach, afterEach, test, expect */

import fs from 'fs';
import os from 'os';
import path from 'path';
import {
  findOperation,
  loadLibrary
} from '..';

const createLibrary = () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cncjs-guitar-'));
  fs.mkdirSync(path.join(root, 'Doug'));
  fs.writeFileSync(path.join(root, 'Doug', 'body.gcode'), 'G21\nG0 X0 Y0\n', 'utf8');
  fs.writeFileSync(path.join(root, 'guitar-library.json'), JSON.stringify({
    version: 1,
    models: [{
      id: 'doug',
      name: 'Doug',
      parts: [{
        id: 'body',
        name: 'Body',
        configurations: [{
          id: 'hh',
          name: 'HH',
          operations: [{
            id: 'rough',
            name: 'Roughing',
            tool: '1/4 in end mill',
            gcode: 'Doug/body.gcode',
            checklist: ['Clamp stock'],
            executable: true
          }]
        }]
      }]
    }]
  }), 'utf8');
  return root;
};

describe('guitar library', () => {
  let root;

  beforeEach(() => {
    root = createLibrary();
  });

  afterEach(() => {
    fs.rmSync(root, { recursive: true, force: true });
  });

  test('indexes operations with file metadata and a checksum', () => {
    const library = loadLibrary(root);
    const operation = library.models[0].parts[0].configurations[0].operations[0];
    expect(operation.size).toBeGreaterThan(0);
    expect(operation.checksum).toMatch(/^[a-f0-9]{64}$/);
  });

  test('returns the selected G-code and canonical labels', () => {
    const result = findOperation({
      modelId: 'doug',
      partId: 'body',
      configurationId: 'hh',
      operationId: 'rough'
    }, root);
    expect(result.selection.modelName).toBe('Doug');
    expect(result.gcode).toContain('G21');
  });

  test('rejects a G-code path outside the library', () => {
    const manifest = JSON.parse(fs.readFileSync(path.join(root, 'guitar-library.json')));
    manifest.models[0].parts[0].configurations[0].operations[0].gcode = '../outside.gcode';
    fs.writeFileSync(path.join(root, 'guitar-library.json'), JSON.stringify(manifest));
    expect(() => loadLibrary(root)).toThrow('leaves the library');
  });

  test('rejects duplicate identifiers', () => {
    const manifest = JSON.parse(fs.readFileSync(path.join(root, 'guitar-library.json')));
    manifest.models.push(manifest.models[0]);
    fs.writeFileSync(path.join(root, 'guitar-library.json'), JSON.stringify(manifest));
    expect(() => loadLibrary(root)).toThrow('Duplicate models id');
  });
});

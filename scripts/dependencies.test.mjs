import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { test } from 'node:test';

const require = createRequire(import.meta.url);
const xcode = require('xcode');
const xcodeRequire = createRequire(require.resolve('xcode'));

test('the patched UUID dependency remains compatible with the Xcode project writer', () => {
  // xcode consumes CommonJS uuid.v4(); keep this contract when changing the override.
  assert.equal(xcodeRequire('uuid/package.json').version, '11.1.1');
  const project = xcode.project('unused.pbxproj');
  project.hash = { project: { objects: { PBXGroup: {} } } };
  const ids = new Set();
  for (let index = 0; index < 100; index++) {
    const id = project.generateUuid();
    assert.match(id, /^[A-F0-9]{24}$/);
    assert.equal(ids.has(id), false);
    ids.add(id);
    project.hash.project.objects.PBXGroup[id] = {};
  }
  assert.equal(project.allUuids().length, 100);
});

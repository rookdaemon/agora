import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import {
  getIgnoredPeersPath,
  loadIgnoredPeers,
  saveIgnoredPeers,
  IGNORED_FILE_NAME,
} from '../../src/relay/ignored-peers';

describe('ignored peers persistence', () => {
  let testDir: string;
  let testFile: string;

  beforeEach(() => {
    testDir = fs.mkdtempSync(path.join(os.tmpdir(), 'agora-ignored-test-'));
    testFile = path.join(testDir, IGNORED_FILE_NAME);
  });

  afterEach(() => {
    fs.rmSync(testDir, { recursive: true, force: true });
  });

  it('builds ignored peers path from storage dir', () => {
    assert.strictEqual(getIgnoredPeersPath(testDir), testFile);
  });

  it('returns empty list when file does not exist', () => {
    assert.deepStrictEqual(loadIgnoredPeers(testFile), []);
  });

  it('saves and loads unique sorted peers', () => {
    saveIgnoredPeers(['peer-b', 'peer-a', 'peer-b'], testFile);
    assert.ok(fs.existsSync(testFile));
    const loaded = loadIgnoredPeers(testFile);
    assert.deepStrictEqual(loaded, ['peer-a', 'peer-b']);
  });

  it('ignores comments and blank lines when loading', () => {
    fs.writeFileSync(testFile, '# header\n\npeer-a\npeer-b\n', 'utf-8');
    const loaded = loadIgnoredPeers(testFile);
    assert.deepStrictEqual(loaded, ['peer-a', 'peer-b']);
  });
});

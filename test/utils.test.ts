import { describe, it } from 'node:test';
import assert from 'node:assert';
import {
  shorten,
  expand,
  compactInlineReferences,
  expandInlineReferences,
  sanitizeText,
  resolveDisplayName,
  type PeerReferenceDirectory,
} from '../src/utils';

const ALICE = '302a300506032b6570032100aaaabbbbccccddddeeeeffff1111222233334444555566667777888899990000';
const BOB = '302a300506032b6570032100111122223333444455556666777788889999aaaabbbbccccddddeeeeffff1234';
const BOB_2 = '302a300506032b65700321009999888877776666555544443333222211110000aaaabbbbccccddddeeeeffff1234';

function directory(includeDuplicateBob = false): PeerReferenceDirectory {
  const entries = [
    { publicKey: ALICE, name: 'alice' },
    { publicKey: BOB, name: 'bob' },
  ];
  if (includeDuplicateBob) {
    entries.push({ publicKey: BOB_2, name: 'bob' });
  }
  return entries;
}

describe('peer reference helpers', () => {
  it('shorten uses canonical name...suffix when name exists', () => {
    assert.strictEqual(shorten(ALICE, directory()), 'alice...99990000');
  });

  it('shorten falls back to ...suffix when name is unavailable', () => {
    assert.strictEqual(shorten(ALICE), '...99990000');
  });

  it('expand resolves full id, suffix-only, and name...suffix', () => {
    const peers = directory();
    assert.strictEqual(expand(ALICE, peers), ALICE);
    assert.strictEqual(expand('...99990000', peers), ALICE);
    assert.strictEqual(expand('alice...99990000', peers), ALICE);
  });

  it('expand only resolves bare names when unique', () => {
    assert.strictEqual(expand('alice', directory()), ALICE);
    assert.strictEqual(expand('bob', directory(true)), undefined);
  });

  it('inline helpers expand and compact @references', () => {
    const peers = directory();
    const expanded = expandInlineReferences('ping @alice...99990000 and @unknown', peers);
    assert.strictEqual(expanded, `ping @${ALICE} and @unknown`);

    const compacted = compactInlineReferences(`hello @${ALICE}`, peers);
    assert.strictEqual(compacted, 'hello @alice...99990000');
  });
});

describe('display/sanitization helpers', () => {
  it('sanitizeText strips control chars and fixes lone surrogates', () => {
    assert.strictEqual(sanitizeText('a\x00b'), 'ab');
    assert.strictEqual(sanitizeText('x\uD800y'), 'x\uFFFDy');
  });

  it('resolveDisplayName prefers configured peer name by public key', () => {
    const peers = directory();
    assert.strictEqual(resolveDisplayName(ALICE, 'relay-alice', peers), 'alice');
  });

  it('resolveDisplayName falls back to sanitized relay name', () => {
    assert.strictEqual(resolveDisplayName('unknown', 'relay\x00name', directory()), 'relayname');
  });

  it('resolveDisplayName ignores short-id relay names', () => {
    assert.strictEqual(resolveDisplayName('unknown', '...1234abcd', directory()), undefined);
  });
});

import { describe, it } from 'node:test';
import assert from 'node:assert';
import {
  shorten,
  expand,
  compactInlineReferences,
  compactKnownInlineReferences,
  expandInlineReferences,
  sanitizeText,
  resolveDisplayName,
  formatDisplayName,
  extractTextFromPayload,
  formatConversationLine,
  parseConversationLine,
  type PeerReferenceDirectory,
  type ConversationEntry,
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
  it('shorten uses canonical name@suffix when name exists', () => {
    assert.strictEqual(shorten(ALICE, directory()), 'alice@99990000');
  });

  it('shorten falls back to @suffix when name is unavailable', () => {
    assert.strictEqual(shorten(ALICE), '@99990000');
  });

  it('expand resolves full id, @suffix-only, and name@suffix', () => {
    const peers = directory();
    assert.strictEqual(expand(ALICE, peers), ALICE);
    assert.strictEqual(expand('@99990000', peers), ALICE);
    assert.strictEqual(expand('alice@99990000', peers), ALICE);
  });

  it('expand resolves legacy ...suffix and name...suffix forms', () => {
    const peers = directory();
    assert.strictEqual(expand('...99990000', peers), ALICE);
    assert.strictEqual(expand('alice...99990000', peers), ALICE);
  });

  it('expand only resolves bare names when unique', () => {
    assert.strictEqual(expand('alice', directory()), ALICE);
    assert.strictEqual(expand('bob', directory(true)), undefined);
  });

  it('inline helpers expand and compact @references', () => {
    const peers = directory();
    const expanded = expandInlineReferences('ping @alice@99990000 and @unknown', peers);
    assert.strictEqual(expanded, `ping @${ALICE} and @unknown`);

    const compacted = compactInlineReferences(`hello @${ALICE}`, peers);
    assert.strictEqual(compacted, 'hello @alice@99990000');
  });

  it('known-only compaction leaves unknown full IDs unchanged', () => {
    const peers = directory();
    const unknown = '302a300506032b6570032100ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff';

    const compacted = compactKnownInlineReferences(`hello @${ALICE} @${unknown}`, peers);
    assert.strictEqual(compacted, `hello @alice@99990000 @${unknown}`);
  });
});

describe('display/sanitization helpers', () => {
  it('sanitizeText strips control chars and fixes lone surrogates', () => {
    assert.strictEqual(sanitizeText('a\x00b'), 'ab');
    assert.strictEqual(sanitizeText('x\uD800y'), 'x\uFFFDy');
  });

  it('resolveDisplayName prefers configured peer name by public key', () => {
    const peers = directory();
    assert.strictEqual(resolveDisplayName(ALICE, peers), 'alice');
  });

  it('resolveDisplayName returns undefined for unknown peers', () => {
    assert.strictEqual(resolveDisplayName('unknown', directory()), undefined);
  });
});

describe('formatDisplayName', () => {
  it('uses canonical name@suffix when name exists', () => {
    assert.strictEqual(formatDisplayName('rook', ALICE), 'rook@99990000');
  });

  it('returns @suffix when name is undefined', () => {
    assert.strictEqual(formatDisplayName(undefined, ALICE), '@99990000');
  });

  it('returns @suffix when name is empty string', () => {
    assert.strictEqual(formatDisplayName('', ALICE), '@99990000');
  });

  it('returns @suffix when name is already a short ID', () => {
    assert.strictEqual(formatDisplayName('@99990000', ALICE), '@99990000');
  });

  it('returns @suffix for legacy ...suffix name', () => {
    assert.strictEqual(formatDisplayName('...99990000', ALICE), '@99990000');
  });
});

describe('extractTextFromPayload', () => {
  it('extracts text from { text } payload', () => {
    assert.strictEqual(extractTextFromPayload({ text: 'hello' }), 'hello');
  });

  it('returns plain string payload as-is', () => {
    assert.strictEqual(extractTextFromPayload('plain message'), 'plain message');
  });

  it('JSON-stringifies non-text objects', () => {
    assert.strictEqual(extractTextFromPayload({ foo: 42 }), '{"foo":42}');
  });

  it('sanitizes extracted text', () => {
    assert.strictEqual(extractTextFromPayload({ text: 'a\x00b' }), 'ab');
  });

  it('handles null/undefined', () => {
    assert.strictEqual(extractTextFromPayload(null), '""');
    assert.strictEqual(extractTextFromPayload(undefined), '""');
  });
});

describe('formatConversationLine', () => {
  it('formats a line with FROM/TO metadata', () => {
    const entry: ConversationEntry = { timestamp: 1700000000000, from: 'alice@99990000', to: ['bob@ffff1234'], text: 'hello' };
    assert.strictEqual(
      formatConversationLine(entry),
      '[2023-11-14T22:13:20.000Z] **FROM:** alice@99990000 **TO:** bob@ffff1234 hello'
    );
  });

  it('formats multiple recipients separated by commas', () => {
    const entry: ConversationEntry = { timestamp: 1700000000000, from: 'alice@99990000', to: ['bob@ffff1234', 'carol@11112222'], text: 'hi all' };
    const line = formatConversationLine(entry);
    assert.ok(line.includes('**TO:** bob@ffff1234, carol@11112222'));
  });

  it('formats (none) when to is empty', () => {
    const entry: ConversationEntry = { timestamp: 1700000000000, from: 'alice@99990000', to: [], text: 'broadcast' };
    assert.ok(formatConversationLine(entry).includes('**TO:** (none)'));
  });

  it('replaces newlines in text', () => {
    const entry: ConversationEntry = { timestamp: 1700000000000, from: 'alice@99990000', to: ['bob@ffff1234'], text: 'line1\nline2' };
    const line = formatConversationLine(entry);
    assert.ok(!line.includes('\n'));
    assert.ok(line.includes('line1 line2'));
  });
});

describe('parseConversationLine', () => {
  it('parses a valid FROM/TO line', () => {
    const line = '[2023-11-14T22:13:20.000Z] **FROM:** alice@99990000 **TO:** bob@ffff1234 hello';
    const entry = parseConversationLine(line);
    assert.ok(entry);
    assert.strictEqual(entry.from, 'alice@99990000');
    assert.deepStrictEqual(entry.to, ['bob@ffff1234']);
    assert.strictEqual(entry.text, 'hello');
    assert.strictEqual(entry.timestamp, 1700000000000);
  });

  it('parses multiple recipients', () => {
    const line = '[2023-11-14T22:13:20.000Z] **FROM:** alice@99990000 **TO:** bob@ffff1234, carol@11112222 hi all';
    const entry = parseConversationLine(line);
    assert.ok(entry);
    assert.deepStrictEqual(entry.to, ['bob@ffff1234', 'carol@11112222']);
    assert.strictEqual(entry.text, 'hi all');
  });

  it('parses (none) recipients as empty array', () => {
    const line = '[2023-11-14T22:13:20.000Z] **FROM:** alice@99990000 **TO:** (none) broadcast';
    const entry = parseConversationLine(line);
    assert.ok(entry);
    assert.deepStrictEqual(entry.to, []);
    assert.strictEqual(entry.text, 'broadcast');
  });

  it('handles empty text', () => {
    const line = '[2023-11-14T22:13:20.000Z] **FROM:** alice@99990000 **TO:** bob@ffff1234';
    const entry = parseConversationLine(line);
    assert.ok(entry);
    assert.strictEqual(entry.text, '');
  });

  it('returns null for invalid lines', () => {
    assert.strictEqual(parseConversationLine(''), null);
    assert.strictEqual(parseConversationLine('not a valid line'), null);
    assert.strictEqual(parseConversationLine('[bad-date] **FROM:** a **TO:** b text'), null);
  });

  it('returns null for old DM-format lines', () => {
    assert.strictEqual(parseConversationLine('[2023-11-14T22:13:20.000Z] [Alice] [DM] hello'), null);
  });

  it('roundtrips through format and parse', () => {
    const original: ConversationEntry = { timestamp: 1700000000000, from: 'dave@abc12345', to: ['eve@def67890'], text: 'test message' };
    const line = formatConversationLine(original);
    const parsed = parseConversationLine(line);
    assert.ok(parsed);
    assert.strictEqual(parsed.from, original.from);
    assert.deepStrictEqual(parsed.to, original.to);
    assert.strictEqual(parsed.text, original.text);
    assert.strictEqual(parsed.timestamp, original.timestamp);
  });

  it('roundtrips with multiple recipients', () => {
    const original: ConversationEntry = { timestamp: 1700000000000, from: 'me@12345678', to: ['alice@99990000', 'bob@ffff1234'], text: 'group msg' };
    const line = formatConversationLine(original);
    const parsed = parseConversationLine(line);
    assert.ok(parsed);
    assert.deepStrictEqual(parsed.to, original.to);
  });
});

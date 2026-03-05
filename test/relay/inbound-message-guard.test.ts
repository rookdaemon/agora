import { describe, it } from 'node:test';
import assert from 'node:assert';
import type { Envelope } from '../../src/message/envelope';
import { InboundMessageGuard } from '../../src/relay/inbound-message-guard';

function envelope(overrides: Partial<Envelope> = {}): Envelope {
  return {
    id: 'env-1',
    type: 'publish',
    sender: 'sender-key',
    timestamp: Date.now(),
    payload: { text: 'hello' },
    signature: 'sig',
    ...overrides,
  } as Envelope;
}

describe('InboundMessageGuard', () => {
  it('drops ignored peers', () => {
    const guard = new InboundMessageGuard({ ignoredPeers: ['sender-key'] });
    const result = guard.shouldDrop(envelope(), 'sender-key');
    assert.strictEqual(result.drop, true);
    assert.strictEqual(result.reason, 'ignored_peer');
  });

  it('drops duplicate envelope IDs', () => {
    const guard = new InboundMessageGuard();
    const first = guard.shouldDrop(envelope({ id: 'same-id' }), 'sender-key');
    const second = guard.shouldDrop(envelope({ id: 'same-id' }), 'sender-key');
    assert.strictEqual(first.drop, false);
    assert.strictEqual(second.drop, true);
    assert.strictEqual(second.reason, 'duplicate_envelope_id');
  });

  it('drops duplicate content from same sender within window', () => {
    const guard = new InboundMessageGuard();
    const first = guard.shouldDrop(envelope({ id: 'a', payload: { text: 'same' } }), 'sender-key');
    const second = guard.shouldDrop(envelope({ id: 'b', payload: { text: 'same' } }), 'sender-key');
    assert.strictEqual(first.drop, false);
    assert.strictEqual(second.drop, true);
    assert.strictEqual(second.reason, 'duplicate_content');
  });

  it('enforces per-sender rate limit', () => {
    const guard = new InboundMessageGuard({
      rateLimitMaxMessages: 2,
      rateLimitWindowMs: 60_000,
      contentDedupEnabled: false,
    });

    const first = guard.shouldDrop(envelope({ id: '1', payload: { text: 'a' } }), 'sender-key');
    const second = guard.shouldDrop(envelope({ id: '2', payload: { text: 'b' } }), 'sender-key');
    const third = guard.shouldDrop(envelope({ id: '3', payload: { text: 'c' } }), 'sender-key');

    assert.strictEqual(first.drop, false);
    assert.strictEqual(second.drop, false);
    assert.strictEqual(third.drop, true);
    assert.strictEqual(third.reason, 'rate_limited');
  });

  it('supports ignore/unignore/list operations', () => {
    const guard = new InboundMessageGuard();
    assert.deepStrictEqual(guard.listIgnoredPeers(), []);
    assert.strictEqual(guard.ignorePeer('peer-z'), true);
    assert.strictEqual(guard.ignorePeer('peer-a'), true);
    assert.strictEqual(guard.ignorePeer('peer-z'), false);
    assert.deepStrictEqual(guard.listIgnoredPeers(), ['peer-a', 'peer-z']);
    assert.strictEqual(guard.unignorePeer('peer-z'), true);
    assert.deepStrictEqual(guard.listIgnoredPeers(), ['peer-a']);
  });
});

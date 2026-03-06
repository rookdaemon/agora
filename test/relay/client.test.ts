/**
 * client.test.ts — Regression tests for RelayClient.sendToRecipients().
 *
 * The original bug: sendToRecipients() passed the individual `recipient` string
 * to createEnvelope() instead of the full `unique` array, so multi-party
 * envelopes only listed a single peer in the `to` field.  Agents reading
 * CONVERSATION.md never saw the other participants and couldn't reply-all.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert';
import { RelayClient } from '../../src/relay/client';
import { generateKeyPair } from '../../src/identity/keypair';
import type { Envelope, MessageType } from '../../src/message/envelope';

/** Create a RelayClient whose `send()` is spied so we can inspect envelopes. */
function createSpyClient() {
  const alice = generateKeyPair();
  const client = new RelayClient({
    relayUrl: 'ws://localhost:0', // not actually opened
    publicKey: alice.publicKey,
    privateKey: alice.privateKey,
  });

  // Force "connected" state without a real WebSocket
  (client as any).isConnected = true;
  (client as any).isRegistered = true;

  const sent: Array<{ to: string; envelope: Envelope }> = [];
  client.send = async (to: string, envelope: Envelope) => {
    sent.push({ to, envelope });
    return { ok: true };
  };

  return { client, sent, alice };
}

describe('RelayClient.sendToRecipients', () => {
  it('should include ALL recipients in every envelope `to` field', async () => {
    const { client, sent } = createSpyClient();
    const bob = generateKeyPair();
    const carol = generateKeyPair();

    const result = await client.sendToRecipients(
      [bob.publicKey, carol.publicKey],
      'request' as MessageType,
      { text: 'hello' },
    );

    assert.strictEqual(result.ok, true);
    assert.strictEqual(sent.length, 2);

    for (const { envelope } of sent) {
      const to = Array.isArray(envelope.to) ? envelope.to : [envelope.to];
      assert.ok(to.includes(bob.publicKey), 'envelope.to must include bob');
      assert.ok(to.includes(carol.publicKey), 'envelope.to must include carol');
    }
  });

  it('should deliver each envelope to the correct individual peer', async () => {
    const { client, sent } = createSpyClient();
    const bob = generateKeyPair();
    const carol = generateKeyPair();

    await client.sendToRecipients(
      [bob.publicKey, carol.publicKey],
      'request' as MessageType,
      { text: 'hello' },
    );

    const deliveryTargets = sent.map((s) => s.to).sort();
    const expected = [bob.publicKey, carol.publicKey].sort();
    assert.deepStrictEqual(deliveryTargets, expected);
  });

  it('should deduplicate recipients', async () => {
    const { client, sent } = createSpyClient();
    const bob = generateKeyPair();

    await client.sendToRecipients(
      [bob.publicKey, bob.publicKey, bob.publicKey],
      'request' as MessageType,
      { text: 'hi' },
    );

    assert.strictEqual(sent.length, 1);
  });

  it('should return error when not connected', async () => {
    const alice = generateKeyPair();
    const client = new RelayClient({
      relayUrl: 'ws://localhost:0',
      publicKey: alice.publicKey,
      privateKey: alice.privateKey,
    });

    const result = await client.sendToRecipients(
      ['some-key'],
      'request' as MessageType,
      { text: 'hello' },
    );

    assert.strictEqual(result.ok, false);
    assert.strictEqual(result.errors.length, 1);
    assert.strictEqual(result.errors[0].recipient, '*');
  });

  it('should collect per-recipient send errors', async () => {
    const { client } = createSpyClient();
    const bob = generateKeyPair();
    const carol = generateKeyPair();

    let callCount = 0;
    client.send = async (_to: string, _envelope: Envelope) => {
      callCount++;
      if (callCount === 2) return { ok: false, error: 'network failure' };
      return { ok: true };
    };

    const result = await client.sendToRecipients(
      [bob.publicKey, carol.publicKey],
      'request' as MessageType,
      { text: 'hello' },
    );

    assert.strictEqual(result.ok, false);
    assert.strictEqual(result.errors.length, 1);
    assert.match(result.errors[0].error, /network failure/);
  });
});

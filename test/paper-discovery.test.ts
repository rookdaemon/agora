import { describe, it } from 'node:test';
import assert from 'node:assert';
import { generateKeyPair } from '../src/identity/keypair.js';
import { createEnvelope, verifyEnvelope } from '../src/message/envelope.js';
import type { PaperDiscoveryPayload } from '../src/message/types/paper-discovery.js';

describe('PaperDiscoveryPayload', () => {
  const samplePayload: PaperDiscoveryPayload = {
    arxiv_id: '2501.12345',
    title: 'Attention Is All You Need (Again)',
    authors: ['Alice Researcher', 'Bob Scientist'],
    claim: 'Introduces a novel sparse attention mechanism that reduces transformer inference cost by 10x while maintaining accuracy.',
    confidence: 0.92,
    relevance_tags: ['transformers', 'efficiency', 'attention'],
    discoverer: 'hephaestus',
    timestamp: '2025-07-11T12:00:00Z',
    abstract_url: 'https://arxiv.org/abs/2501.12345',
    pdf_url: 'https://arxiv.org/pdf/2501.12345',
  };

  it('should create a valid paper_discovery envelope', () => {
    const kp = generateKeyPair();
    const envelope = createEnvelope('paper_discovery', kp.publicKey, kp.privateKey, samplePayload);

    assert.strictEqual(envelope.type, 'paper_discovery');
    assert.strictEqual(envelope.sender, kp.publicKey);
    assert.ok(envelope.id);
    assert.ok(envelope.signature);
    assert.ok(envelope.timestamp > 0);
    assert.deepStrictEqual(envelope.payload, samplePayload);
  });

  it('should verify a valid paper_discovery envelope', () => {
    const kp = generateKeyPair();
    const envelope = createEnvelope('paper_discovery', kp.publicKey, kp.privateKey, samplePayload);

    const result = verifyEnvelope(envelope);
    assert.strictEqual(result.valid, true);
    assert.strictEqual(result.reason, undefined);
  });

  it('should reject a tampered paper_discovery payload', () => {
    const kp = generateKeyPair();
    const envelope = createEnvelope('paper_discovery', kp.publicKey, kp.privateKey, samplePayload);

    const tampered = { ...envelope, payload: { ...samplePayload, confidence: 0.1 } };
    const result = verifyEnvelope(tampered);
    assert.strictEqual(result.valid, false);
    assert.strictEqual(result.reason, 'id_mismatch');
  });

  it('should work without optional pdf_url', () => {
    const { pdf_url: _, ...payloadWithoutPdf } = samplePayload;
    const kp = generateKeyPair();
    const envelope = createEnvelope('paper_discovery', kp.publicKey, kp.privateKey, payloadWithoutPdf);

    assert.strictEqual(envelope.type, 'paper_discovery');
    assert.strictEqual(envelope.payload.pdf_url, undefined);

    const result = verifyEnvelope(envelope);
    assert.strictEqual(result.valid, true);
  });

  it('should preserve all payload fields through envelope creation', () => {
    const kp = generateKeyPair();
    const envelope = createEnvelope('paper_discovery', kp.publicKey, kp.privateKey, samplePayload);

    const p = envelope.payload as PaperDiscoveryPayload;
    assert.strictEqual(p.arxiv_id, '2501.12345');
    assert.strictEqual(p.title, 'Attention Is All You Need (Again)');
    assert.deepStrictEqual(p.authors, ['Alice Researcher', 'Bob Scientist']);
    assert.strictEqual(p.confidence, 0.92);
    assert.deepStrictEqual(p.relevance_tags, ['transformers', 'efficiency', 'attention']);
    assert.strictEqual(p.discoverer, 'hephaestus');
    assert.strictEqual(p.timestamp, '2025-07-11T12:00:00Z');
    assert.strictEqual(p.abstract_url, 'https://arxiv.org/abs/2501.12345');
    assert.strictEqual(p.pdf_url, 'https://arxiv.org/pdf/2501.12345');
  });

  it('should support inReplyTo for threaded discussion', () => {
    const kp = generateKeyPair();
    const original = createEnvelope('paper_discovery', kp.publicKey, kp.privateKey, samplePayload);
    const reply = createEnvelope('response', kp.publicKey, kp.privateKey, { comment: 'Interesting paper!' }, original.id);

    assert.strictEqual(reply.inReplyTo, original.id);
    const result = verifyEnvelope(reply);
    assert.strictEqual(result.valid, true);
  });

  it('should reject impersonation of paper discoverer', () => {
    const real = generateKeyPair();
    const impersonator = generateKeyPair();

    const envelope = createEnvelope('paper_discovery', real.publicKey, impersonator.privateKey, samplePayload);
    const result = verifyEnvelope(envelope);
    assert.strictEqual(result.valid, false);
    assert.strictEqual(result.reason, 'signature_invalid');
  });
});

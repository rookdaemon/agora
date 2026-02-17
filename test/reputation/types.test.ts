/**
 * Tests for reputation types and validation
 */

import { describe, it } from 'node:test';
import assert from 'node:assert';
import {
  validateVerificationRecord,
  validateCommitRecord,
  validateRevealRecord,
} from '../../src/reputation/types.js';

describe('Reputation Types', () => {
  describe('validateVerificationRecord', () => {
    it('should validate a valid verification record', () => {
      const record = {
        id: 'abc123',
        verifier: '302a300506032b657003210012345678901234567890123456789012',
        target: 'target123',
        domain: 'ocr',
        verdict: 'correct' as const,
        confidence: 0.95,
        timestamp: Date.now(),
        signature: 'sig123',
      };
      
      const result = validateVerificationRecord(record);
      assert.strictEqual(result.valid, true);
      assert.strictEqual(result.errors.length, 0);
    });

    it('should reject non-object values', () => {
      const result = validateVerificationRecord('not an object');
      assert.strictEqual(result.valid, false);
      assert.ok(result.errors.length > 0);
    });

    it('should reject missing id', () => {
      const record = {
        verifier: 'verifier123',
        target: 'target123',
        domain: 'ocr',
        verdict: 'correct' as const,
        confidence: 0.95,
        timestamp: Date.now(),
        signature: 'sig123',
      };
      
      const result = validateVerificationRecord(record);
      assert.strictEqual(result.valid, false);
      assert.ok(result.errors.some(e => e.includes('id')));
    });

    it('should reject invalid verdict', () => {
      const record = {
        id: 'abc123',
        verifier: 'verifier123',
        target: 'target123',
        domain: 'ocr',
        verdict: 'invalid',
        confidence: 0.95,
        timestamp: Date.now(),
        signature: 'sig123',
      };
      
      const result = validateVerificationRecord(record);
      assert.strictEqual(result.valid, false);
      assert.ok(result.errors.some(e => e.includes('verdict')));
    });

    it('should reject confidence out of range', () => {
      const record = {
        id: 'abc123',
        verifier: 'verifier123',
        target: 'target123',
        domain: 'ocr',
        verdict: 'correct' as const,
        confidence: 1.5,
        timestamp: Date.now(),
        signature: 'sig123',
      };
      
      const result = validateVerificationRecord(record);
      assert.strictEqual(result.valid, false);
      assert.ok(result.errors.some(e => e.includes('confidence')));
    });

    it('should accept optional evidence', () => {
      const record = {
        id: 'abc123',
        verifier: 'verifier123',
        target: 'target123',
        domain: 'ocr',
        verdict: 'correct' as const,
        confidence: 0.95,
        evidence: 'https://example.com/evidence',
        timestamp: Date.now(),
        signature: 'sig123',
      };
      
      const result = validateVerificationRecord(record);
      assert.strictEqual(result.valid, true);
    });
  });

  describe('validateCommitRecord', () => {
    it('should validate a valid commit record', () => {
      const record = {
        id: 'commit123',
        agent: 'agent123',
        domain: 'weather_forecast',
        commitment: 'a'.repeat(64),
        timestamp: Date.now(),
        expiry: Date.now() + 86400000,
        signature: 'sig123',
      };
      
      const result = validateCommitRecord(record);
      assert.strictEqual(result.valid, true);
      assert.strictEqual(result.errors.length, 0);
    });

    it('should reject commitment with wrong length', () => {
      const record = {
        id: 'commit123',
        agent: 'agent123',
        domain: 'weather_forecast',
        commitment: 'tooshort',
        timestamp: Date.now(),
        expiry: Date.now() + 86400000,
        signature: 'sig123',
      };
      
      const result = validateCommitRecord(record);
      assert.strictEqual(result.valid, false);
      assert.ok(result.errors.some(e => e.includes('commitment')));
    });

    it('should reject expiry before timestamp', () => {
      const now = Date.now();
      const record = {
        id: 'commit123',
        agent: 'agent123',
        domain: 'weather_forecast',
        commitment: 'a'.repeat(64),
        timestamp: now,
        expiry: now - 1000,
        signature: 'sig123',
      };
      
      const result = validateCommitRecord(record);
      assert.strictEqual(result.valid, false);
      assert.ok(result.errors.some(e => e.includes('expiry')));
    });
  });

  describe('validateRevealRecord', () => {
    it('should validate a valid reveal record', () => {
      const record = {
        id: 'reveal123',
        agent: 'agent123',
        commitmentId: 'commit123',
        prediction: 'It will rain tomorrow',
        outcome: 'rain observed',
        timestamp: Date.now(),
        signature: 'sig123',
      };
      
      const result = validateRevealRecord(record);
      assert.strictEqual(result.valid, true);
      assert.strictEqual(result.errors.length, 0);
    });

    it('should reject missing prediction', () => {
      const record = {
        id: 'reveal123',
        agent: 'agent123',
        commitmentId: 'commit123',
        outcome: 'rain observed',
        timestamp: Date.now(),
        signature: 'sig123',
      };
      
      const result = validateRevealRecord(record);
      assert.strictEqual(result.valid, false);
      assert.ok(result.errors.some(e => e.includes('prediction')));
    });

    it('should accept optional evidence', () => {
      const record = {
        id: 'reveal123',
        agent: 'agent123',
        commitmentId: 'commit123',
        prediction: 'It will rain tomorrow',
        outcome: 'rain observed',
        evidence: 'https://weather.com/api',
        timestamp: Date.now(),
        signature: 'sig123',
      };
      
      const result = validateRevealRecord(record);
      assert.strictEqual(result.valid, true);
    });
  });
});

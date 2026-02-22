import { describe, it } from 'node:test';
import assert from 'node:assert';
import { createCapability, validateCapability, type Capability } from '../src/registry/capability';

describe('Capability', () => {
  describe('createCapability', () => {
    it('should create a capability with required fields', () => {
      const cap = createCapability('code-review', '1.0.0', 'Reviews code for issues');
      
      assert.ok(cap.id);
      assert.strictEqual(cap.name, 'code-review');
      assert.strictEqual(cap.version, '1.0.0');
      assert.strictEqual(cap.description, 'Reviews code for issues');
      assert.deepStrictEqual(cap.tags, []);
    });

    it('should create a capability with tags', () => {
      const cap = createCapability('code-review', '1.0.0', 'Reviews code', {
        tags: ['code', 'typescript', 'review'],
      });
      
      assert.deepStrictEqual(cap.tags, ['code', 'typescript', 'review']);
    });

    it('should create a capability with input schema', () => {
      const inputSchema = {
        type: 'object',
        properties: {
          code: { type: 'string' },
        },
      };
      
      const cap = createCapability('code-review', '1.0.0', 'Reviews code', {
        inputSchema,
      });
      
      assert.deepStrictEqual(cap.inputSchema, inputSchema);
    });

    it('should create a capability with output schema', () => {
      const outputSchema = {
        type: 'object',
        properties: {
          issues: { type: 'array' },
        },
      };
      
      const cap = createCapability('code-review', '1.0.0', 'Reviews code', {
        outputSchema,
      });
      
      assert.deepStrictEqual(cap.outputSchema, outputSchema);
    });

    it('should create a capability with both input and output schemas', () => {
      const inputSchema = { type: 'string' };
      const outputSchema = { type: 'string' };
      
      const cap = createCapability('translation', '1.0.0', 'Translates text', {
        inputSchema,
        outputSchema,
      });
      
      assert.deepStrictEqual(cap.inputSchema, inputSchema);
      assert.deepStrictEqual(cap.outputSchema, outputSchema);
    });

    it('should generate content-addressed ID', () => {
      const cap = createCapability('summarization', '2.0.0', 'Summarizes text');
      
      // ID should be a hex string (SHA-256)
      assert.match(cap.id, /^[0-9a-f]{64}$/);
    });

    it('should generate deterministic IDs for same inputs', () => {
      const cap1 = createCapability('test', '1.0.0', 'Description');
      const cap2 = createCapability('test', '1.0.0', 'Description');
      
      // Same name and version should produce same ID
      assert.strictEqual(cap1.id, cap2.id);
    });

    it('should generate different IDs for different names', () => {
      const cap1 = createCapability('test1', '1.0.0', 'Description');
      const cap2 = createCapability('test2', '1.0.0', 'Description');
      
      assert.notStrictEqual(cap1.id, cap2.id);
    });

    it('should generate different IDs for different versions', () => {
      const cap1 = createCapability('test', '1.0.0', 'Description');
      const cap2 = createCapability('test', '2.0.0', 'Description');
      
      assert.notStrictEqual(cap1.id, cap2.id);
    });

    it('should generate different IDs when schemas differ', () => {
      const cap1 = createCapability('test', '1.0.0', 'Description', {
        inputSchema: { type: 'string' },
      });
      const cap2 = createCapability('test', '1.0.0', 'Description', {
        inputSchema: { type: 'number' },
      });
      
      assert.notStrictEqual(cap1.id, cap2.id);
    });

    it('should not include inputSchema field when not provided', () => {
      const cap = createCapability('test', '1.0.0', 'Description');
      
      assert.strictEqual(cap.inputSchema, undefined);
      assert.ok(!('inputSchema' in cap));
    });

    it('should not include outputSchema field when not provided', () => {
      const cap = createCapability('test', '1.0.0', 'Description');
      
      assert.strictEqual(cap.outputSchema, undefined);
      assert.ok(!('outputSchema' in cap));
    });
  });

  describe('validateCapability', () => {
    it('should validate a valid capability', () => {
      const cap = createCapability('test', '1.0.0', 'Description', {
        tags: ['tag1'],
      });
      
      const result = validateCapability(cap);
      
      assert.strictEqual(result.valid, true);
      assert.strictEqual(result.errors, undefined);
    });

    it('should reject non-object values', () => {
      const result = validateCapability('not an object');
      
      assert.strictEqual(result.valid, false);
      assert.ok(result.errors);
      assert.ok(result.errors.includes('Capability must be an object'));
    });

    it('should reject null', () => {
      const result = validateCapability(null);
      
      assert.strictEqual(result.valid, false);
      assert.ok(result.errors);
    });

    it('should reject capability without id', () => {
      const invalid = {
        name: 'test',
        version: '1.0.0',
        description: 'Description',
        tags: [],
      };
      
      const result = validateCapability(invalid);
      
      assert.strictEqual(result.valid, false);
      assert.ok(result.errors);
      assert.ok(result.errors.some(e => e.includes('id')));
    });

    it('should reject capability without name', () => {
      const invalid = {
        id: 'abc123',
        version: '1.0.0',
        description: 'Description',
        tags: [],
      };
      
      const result = validateCapability(invalid);
      
      assert.strictEqual(result.valid, false);
      assert.ok(result.errors);
      assert.ok(result.errors.some(e => e.includes('name')));
    });

    it('should reject capability without version', () => {
      const invalid = {
        id: 'abc123',
        name: 'test',
        description: 'Description',
        tags: [],
      };
      
      const result = validateCapability(invalid);
      
      assert.strictEqual(result.valid, false);
      assert.ok(result.errors);
      assert.ok(result.errors.some(e => e.includes('version')));
    });

    it('should reject capability without description', () => {
      const invalid = {
        id: 'abc123',
        name: 'test',
        version: '1.0.0',
        tags: [],
      };
      
      const result = validateCapability(invalid);
      
      assert.strictEqual(result.valid, false);
      assert.ok(result.errors);
      assert.ok(result.errors.some(e => e.includes('description')));
    });

    it('should reject capability without tags', () => {
      const invalid = {
        id: 'abc123',
        name: 'test',
        version: '1.0.0',
        description: 'Description',
      };
      
      const result = validateCapability(invalid);
      
      assert.strictEqual(result.valid, false);
      assert.ok(result.errors);
      assert.ok(result.errors.some(e => e.includes('tags')));
    });

    it('should reject capability with non-array tags', () => {
      const invalid = {
        id: 'abc123',
        name: 'test',
        version: '1.0.0',
        description: 'Description',
        tags: 'not-an-array',
      };
      
      const result = validateCapability(invalid);
      
      assert.strictEqual(result.valid, false);
      assert.ok(result.errors);
      assert.ok(result.errors.some(e => e.includes('tags')));
    });

    it('should reject capability with non-string tag elements', () => {
      const invalid = {
        id: 'abc123',
        name: 'test',
        version: '1.0.0',
        description: 'Description',
        tags: ['valid', 123, 'another'],
      };
      
      const result = validateCapability(invalid);
      
      assert.strictEqual(result.valid, false);
      assert.ok(result.errors);
      assert.ok(result.errors.some(e => e.includes('tags')));
    });

    it('should reject capability with invalid inputSchema', () => {
      const invalid = {
        id: 'abc123',
        name: 'test',
        version: '1.0.0',
        description: 'Description',
        tags: [],
        inputSchema: 'not-an-object',
      };
      
      const result = validateCapability(invalid);
      
      assert.strictEqual(result.valid, false);
      assert.ok(result.errors);
      assert.ok(result.errors.some(e => e.includes('inputSchema')));
    });

    it('should reject capability with null inputSchema', () => {
      const invalid = {
        id: 'abc123',
        name: 'test',
        version: '1.0.0',
        description: 'Description',
        tags: [],
        inputSchema: null,
      };
      
      const result = validateCapability(invalid);
      
      assert.strictEqual(result.valid, false);
      assert.ok(result.errors);
      assert.ok(result.errors.some(e => e.includes('inputSchema')));
    });

    it('should reject capability with invalid outputSchema', () => {
      const invalid = {
        id: 'abc123',
        name: 'test',
        version: '1.0.0',
        description: 'Description',
        tags: [],
        outputSchema: 'not-an-object',
      };
      
      const result = validateCapability(invalid);
      
      assert.strictEqual(result.valid, false);
      assert.ok(result.errors);
      assert.ok(result.errors.some(e => e.includes('outputSchema')));
    });

    it('should accept capability with valid inputSchema', () => {
      const valid: Capability = {
        id: 'abc123',
        name: 'test',
        version: '1.0.0',
        description: 'Description',
        tags: [],
        inputSchema: { type: 'string' },
      };
      
      const result = validateCapability(valid);
      
      assert.strictEqual(result.valid, true);
    });

    it('should accept capability with valid outputSchema', () => {
      const valid: Capability = {
        id: 'abc123',
        name: 'test',
        version: '1.0.0',
        description: 'Description',
        tags: [],
        outputSchema: { type: 'string' },
      };
      
      const result = validateCapability(valid);
      
      assert.strictEqual(result.valid, true);
    });

    it('should return multiple errors for multiple invalid fields', () => {
      const invalid = {
        tags: 'not-an-array',
        inputSchema: null,
      };
      
      const result = validateCapability(invalid);
      
      assert.strictEqual(result.valid, false);
      assert.ok(result.errors);
      assert.ok(result.errors.length > 1);
    });
  });
});

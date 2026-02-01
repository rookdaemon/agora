import { createHash } from 'node:crypto';

/**
 * A capability describes something an agent can do
 */
export interface Capability {
  /** Unique ID (content-addressed hash of name + version + schema) */
  id: string;
  /** Human-readable name: 'code-review', 'summarization', 'translation' */
  name: string;
  /** Semantic version */
  version: string;
  /** What the capability does */
  description: string;
  /** JSON Schema for expected input */
  inputSchema?: object;
  /** JSON Schema for expected output */
  outputSchema?: object;
  /** Discovery tags: ['code', 'typescript', 'review'] */
  tags: string[];
}

/**
 * Deterministic JSON serialization for capability hashing.
 * Recursively sorts object keys.
 */
function stableStringify(value: unknown): string {
  if (value === null || value === undefined) return JSON.stringify(value);
  if (typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) {
    return '[' + value.map(stableStringify).join(',') + ']';
  }
  const keys = Object.keys(value as Record<string, unknown>).sort();
  const pairs = keys.map(k => JSON.stringify(k) + ':' + stableStringify((value as Record<string, unknown>)[k]));
  return '{' + pairs.join(',') + '}';
}

/**
 * Compute content-addressed ID for a capability based on name, version, and schemas.
 */
function computeCapabilityId(name: string, version: string, inputSchema?: object, outputSchema?: object): string {
  const data = {
    name,
    version,
    ...(inputSchema !== undefined ? { inputSchema } : {}),
    ...(outputSchema !== undefined ? { outputSchema } : {}),
  };
  const canonical = stableStringify(data);
  return createHash('sha256').update(canonical).digest('hex');
}

/**
 * Creates a capability with a content-addressed ID.
 * 
 * @param name - Human-readable capability name
 * @param version - Semantic version string
 * @param description - Description of what the capability does
 * @param options - Optional input/output schemas and tags
 * @returns A Capability object with computed ID
 */
export function createCapability(
  name: string,
  version: string,
  description: string,
  options: {
    inputSchema?: object;
    outputSchema?: object;
    tags?: string[];
  } = {}
): Capability {
  const { inputSchema, outputSchema, tags = [] } = options;
  
  const id = computeCapabilityId(name, version, inputSchema, outputSchema);
  
  return {
    id,
    name,
    version,
    description,
    ...(inputSchema !== undefined ? { inputSchema } : {}),
    ...(outputSchema !== undefined ? { outputSchema } : {}),
    tags,
  };
}

/**
 * Validates that a capability has all required fields.
 * 
 * @param capability - The capability to validate
 * @returns Object with `valid` boolean and optional `errors` array
 */
export function validateCapability(capability: unknown): { valid: boolean; errors?: string[] } {
  const errors: string[] = [];
  
  if (!capability || typeof capability !== 'object') {
    return { valid: false, errors: ['Capability must be an object'] };
  }
  
  const cap = capability as Record<string, unknown>;
  
  if (!cap.id || typeof cap.id !== 'string') {
    errors.push('Missing or invalid field: id (must be a string)');
  }
  
  if (!cap.name || typeof cap.name !== 'string') {
    errors.push('Missing or invalid field: name (must be a string)');
  }
  
  if (!cap.version || typeof cap.version !== 'string') {
    errors.push('Missing or invalid field: version (must be a string)');
  }
  
  if (!cap.description || typeof cap.description !== 'string') {
    errors.push('Missing or invalid field: description (must be a string)');
  }
  
  if (!Array.isArray(cap.tags)) {
    errors.push('Missing or invalid field: tags (must be an array)');
  } else if (!cap.tags.every(tag => typeof tag === 'string')) {
    errors.push('Invalid field: tags (all elements must be strings)');
  }
  
  if (cap.inputSchema !== undefined && (typeof cap.inputSchema !== 'object' || cap.inputSchema === null)) {
    errors.push('Invalid field: inputSchema (must be an object)');
  }
  
  if (cap.outputSchema !== undefined && (typeof cap.outputSchema !== 'object' || cap.outputSchema === null)) {
    errors.push('Invalid field: outputSchema (must be an object)');
  }
  
  if (errors.length > 0) {
    return { valid: false, errors };
  }
  
  return { valid: true };
}

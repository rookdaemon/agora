/**
 * Local reputation store using JSONL append-only log.
 * Stores verification records, commits, and reveals.
 */

import { promises as fs } from 'node:fs';
import { dirname } from 'node:path';
import type { VerificationRecord, CommitRecord, RevealRecord } from './types.js';
import { validateVerificationRecord, validateCommitRecord, validateRevealRecord } from './types.js';

/**
 * Record type discriminator for JSONL storage
 */
type StoredRecord = 
  | ({ type: 'verification' } & VerificationRecord)
  | ({ type: 'commit' } & CommitRecord)
  | ({ type: 'reveal' } & RevealRecord);

/**
 * Reputation store with JSONL persistence
 */
export class ReputationStore {
  private filePath: string;
  private verifications: Map<string, VerificationRecord> = new Map();
  private commits: Map<string, CommitRecord> = new Map();
  private reveals: Map<string, RevealRecord> = new Map();
  private loaded = false;

  constructor(filePath: string) {
    this.filePath = filePath;
  }

  /**
   * Load records from JSONL file
   */
  async load(): Promise<void> {
    try {
      const content = await fs.readFile(this.filePath, 'utf-8');
      const lines = content.trim().split('\n').filter(line => line.length > 0);
      
      for (const line of lines) {
        try {
          const record = JSON.parse(line) as StoredRecord;
          
          switch (record.type) {
            case 'verification': {
              const { type, ...verification } = record;
              const validation = validateVerificationRecord(verification);
              if (validation.valid) {
                this.verifications.set(verification.id, verification as VerificationRecord);
              }
              break;
            }
            case 'commit': {
              const { type, ...commit } = record;
              const validation = validateCommitRecord(commit);
              if (validation.valid) {
                this.commits.set(commit.id, commit as CommitRecord);
              }
              break;
            }
            case 'reveal': {
              const { type, ...reveal } = record;
              const validation = validateRevealRecord(reveal);
              if (validation.valid) {
                this.reveals.set(reveal.id, reveal as RevealRecord);
              }
              break;
            }
          }
        } catch (parseError) {
          // Skip invalid lines
          continue;
        }
      }
      
      this.loaded = true;
    } catch (error) {
      // File doesn't exist yet - that's okay for first run
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        this.loaded = true;
        return;
      }
      throw error;
    }
  }

  /**
   * Ensure the store is loaded
   */
  private async ensureLoaded(): Promise<void> {
    if (!this.loaded) {
      await this.load();
    }
  }

  /**
   * Append a record to the JSONL file
   */
  private async appendToFile(record: StoredRecord): Promise<void> {
    // Ensure directory exists
    await fs.mkdir(dirname(this.filePath), { recursive: true });
    
    // Append JSONL line
    const line = JSON.stringify(record) + '\n';
    await fs.appendFile(this.filePath, line, 'utf-8');
  }

  /**
   * Add a verification record
   */
  async addVerification(verification: VerificationRecord): Promise<void> {
    await this.ensureLoaded();
    
    const validation = validateVerificationRecord(verification);
    if (!validation.valid) {
      throw new Error(`Invalid verification: ${validation.errors.join(', ')}`);
    }
    
    this.verifications.set(verification.id, verification);
    await this.appendToFile({ type: 'verification', ...verification });
  }

  /**
   * Add a commit record
   */
  async addCommit(commit: CommitRecord): Promise<void> {
    await this.ensureLoaded();
    
    const validation = validateCommitRecord(commit);
    if (!validation.valid) {
      throw new Error(`Invalid commit: ${validation.errors.join(', ')}`);
    }
    
    this.commits.set(commit.id, commit);
    await this.appendToFile({ type: 'commit', ...commit });
  }

  /**
   * Add a reveal record
   */
  async addReveal(reveal: RevealRecord): Promise<void> {
    await this.ensureLoaded();
    
    const validation = validateRevealRecord(reveal);
    if (!validation.valid) {
      throw new Error(`Invalid reveal: ${validation.errors.join(', ')}`);
    }
    
    this.reveals.set(reveal.id, reveal);
    await this.appendToFile({ type: 'reveal', ...reveal });
  }

  /**
   * Get all verifications
   */
  async getVerifications(): Promise<VerificationRecord[]> {
    await this.ensureLoaded();
    return Array.from(this.verifications.values());
  }

  /**
   * Get verifications for a specific target
   */
  async getVerificationsByTarget(target: string): Promise<VerificationRecord[]> {
    await this.ensureLoaded();
    return Array.from(this.verifications.values()).filter(v => v.target === target);
  }

  /**
   * Get verifications by domain
   */
  async getVerificationsByDomain(domain: string): Promise<VerificationRecord[]> {
    await this.ensureLoaded();
    return Array.from(this.verifications.values()).filter(v => v.domain === domain);
  }

  /**
   * Get verifications for an agent (where they are the target of verification)
   * This requires looking up the target message to find the agent
   * For now, we'll return all verifications and let the caller filter
   */
  async getVerificationsByDomainForAgent(domain: string): Promise<VerificationRecord[]> {
    return this.getVerificationsByDomain(domain);
  }

  /**
   * Get all commits
   */
  async getCommits(): Promise<CommitRecord[]> {
    await this.ensureLoaded();
    return Array.from(this.commits.values());
  }

  /**
   * Get commit by ID
   */
  async getCommit(id: string): Promise<CommitRecord | null> {
    await this.ensureLoaded();
    return this.commits.get(id) || null;
  }

  /**
   * Get commits by agent
   */
  async getCommitsByAgent(agent: string): Promise<CommitRecord[]> {
    await this.ensureLoaded();
    return Array.from(this.commits.values()).filter(c => c.agent === agent);
  }

  /**
   * Get all reveals
   */
  async getReveals(): Promise<RevealRecord[]> {
    await this.ensureLoaded();
    return Array.from(this.reveals.values());
  }

  /**
   * Get reveal by commitment ID
   */
  async getRevealByCommitment(commitmentId: string): Promise<RevealRecord | null> {
    await this.ensureLoaded();
    return Array.from(this.reveals.values()).find(r => r.commitmentId === commitmentId) || null;
  }

  /**
   * Get reveals by agent
   */
  async getRevealsByAgent(agent: string): Promise<RevealRecord[]> {
    await this.ensureLoaded();
    return Array.from(this.reveals.values()).filter(r => r.agent === agent);
  }
}

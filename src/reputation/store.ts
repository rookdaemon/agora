/**
 * Local reputation store using JSONL (JSON Lines) format.
 * 
 * Provides append-only, crash-safe storage for reputation records.
 */

import { createWriteStream, existsSync } from 'node:fs';
import { mkdir, readFile, appendFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { homedir } from 'node:os';
import type { VerificationRecord, CommitRecord, RevealRecord, RevocationRecord } from './types.js';

/**
 * Union type for all storable reputation records.
 */
export type ReputationRecord = 
  | ({ type: 'verification' } & VerificationRecord)
  | ({ type: 'commit' } & CommitRecord)
  | ({ type: 'reveal' } & RevealRecord)
  | ({ type: 'revocation' } & RevocationRecord);

/**
 * Default storage location for reputation data.
 */
const DEFAULT_STORE_PATH = `${homedir()}/.local/share/agora/reputation.jsonl`;

/**
 * Local reputation store with JSONL persistence.
 */
export class ReputationStore {
  private path: string;
  
  constructor(path?: string) {
    this.path = path ?? DEFAULT_STORE_PATH;
  }
  
  /**
   * Initializes the store, creating directory if needed.
   */
  async initialize(): Promise<void> {
    const dir = dirname(this.path);
    await mkdir(dir, { recursive: true });
  }
  
  /**
   * Appends a record to the store.
   * 
   * @param record - Record to append
   */
  async append(record: ReputationRecord): Promise<void> {
    await this.initialize();
    const line = JSON.stringify(record) + '\n';
    await appendFile(this.path, line, 'utf-8');
  }
  
  /**
   * Reads all records from the store.
   * 
   * @returns Array of all records
   */
  async readAll(): Promise<ReputationRecord[]> {
    if (!existsSync(this.path)) {
      return [];
    }
    
    const content = await readFile(this.path, 'utf-8');
    const lines = content.split('\n').filter(line => line.trim() !== '');
    
    const records: ReputationRecord[] = [];
    for (const line of lines) {
      try {
        const record = JSON.parse(line) as ReputationRecord;
        records.push(record);
      } catch (error) {
        // Skip malformed lines
        console.warn('Failed to parse reputation record:', error);
      }
    }
    
    return records;
  }
  
  /**
   * Queries verification records for a specific agent and domain.
   * 
   * @param agent - Public key of agent
   * @param domain - Optional domain filter
   * @returns Array of verification records
   */
  async queryVerifications(agent: string, domain?: string): Promise<VerificationRecord[]> {
    const records = await this.readAll();
    
    return records
      .filter((r): r is { type: 'verification' } & VerificationRecord => r.type === 'verification')
      .map(r => {
        const { type, ...verification } = r;
        return verification;
      })
      .filter(v => v.target === agent || v.verifier === agent)
      .filter(v => !domain || v.domain === domain);
  }
  
  /**
   * Queries commit records for a specific agent.
   * 
   * @param agent - Public key of agent
   * @param domain - Optional domain filter
   * @returns Array of commit records
   */
  async queryCommits(agent: string, domain?: string): Promise<CommitRecord[]> {
    const records = await this.readAll();
    
    return records
      .filter((r): r is { type: 'commit' } & CommitRecord => r.type === 'commit')
      .map(r => {
        const { type, ...commit } = r;
        return commit;
      })
      .filter(c => c.agent === agent)
      .filter(c => !domain || c.domain === domain);
  }
  
  /**
   * Queries reveal records for a specific agent.
   * 
   * @param agent - Public key of agent
   * @returns Array of reveal records
   */
  async queryReveals(agent: string): Promise<RevealRecord[]> {
    const records = await this.readAll();
    
    return records
      .filter((r): r is { type: 'reveal' } & RevealRecord => r.type === 'reveal')
      .map(r => {
        const { type, ...reveal } = r;
        return reveal;
      })
      .filter(r => r.agent === agent);
  }
  
  /**
   * Queries revocation records for a specific verifier.
   * 
   * @param verifier - Public key of verifier
   * @returns Array of revocation records
   */
  async queryRevocations(verifier: string): Promise<RevocationRecord[]> {
    const records = await this.readAll();
    
    return records
      .filter((r): r is { type: 'revocation' } & RevocationRecord => r.type === 'revocation')
      .map(r => {
        const { type, ...revocation } = r;
        return revocation;
      })
      .filter(r => r.verifier === verifier);
  }
  
  /**
   * Gets a specific commit by ID.
   * 
   * @param commitId - ID of commit record
   * @returns Commit record or undefined
   */
  async getCommit(commitId: string): Promise<CommitRecord | undefined> {
    const records = await this.readAll();
    
    const commit = records
      .filter((r): r is { type: 'commit' } & CommitRecord => r.type === 'commit')
      .map(r => {
        const { type, ...commit } = r;
        return commit;
      })
      .find(c => c.id === commitId);
    
    return commit;
  }
  
  /**
   * Gets active (non-revoked) verifications for an agent.
   * 
   * @param agent - Public key of agent
   * @param domain - Optional domain filter
   * @returns Array of active verification records
   */
  async getActiveVerifications(agent: string, domain?: string): Promise<VerificationRecord[]> {
    const verifications = await this.queryVerifications(agent, domain);
    const revocations = await this.readAll().then(records =>
      records
        .filter((r): r is { type: 'revocation' } & RevocationRecord => r.type === 'revocation')
        .map(r => {
          const { type, ...revocation } = r;
          return revocation;
        })
    );
    
    // Filter out revoked verifications
    const revokedIds = new Set(revocations.map(r => r.verificationId));
    return verifications.filter(v => !revokedIds.has(v.id));
  }
}

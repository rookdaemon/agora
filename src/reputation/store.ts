/**
 * Local reputation store using JSONL (JSON Lines) format.
 * Provides append-only, crash-safe storage for reputation records.
 */

import { appendFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, dirname } from 'node:path';
import type { VerificationRecord, CommitRecord, RevealRecord, RevocationRecord } from './types.js';

/**
 * Type for any reputation record that can be stored.
 */
export type ReputationRecord =
  | { type: 'verification'; data: VerificationRecord }
  | { type: 'commit'; data: CommitRecord }
  | { type: 'reveal'; data: RevealRecord }
  | { type: 'revocation'; data: RevocationRecord };

/**
 * Options for reputation store.
 */
export interface ReputationStoreOptions {
  /** Path to the JSONL file (default: ~/.local/share/agora/reputation.jsonl) */
  filePath?: string;
}

/**
 * Local reputation store.
 * Stores all reputation records in a JSONL file.
 */
export class ReputationStore {
  private filePath: string;
  
  constructor(options: ReputationStoreOptions = {}) {
    this.filePath = options.filePath || join(
      homedir(),
      '.local',
      'share',
      'agora',
      'reputation.jsonl'
    );
    
    this.ensureFileExists();
  }
  
  /**
   * Ensure the store file and directory exist.
   */
  private ensureFileExists(): void {
    const dir = dirname(this.filePath);
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }
    
    // Don't create the file if it doesn't exist - let append do that
  }
  
  /**
   * Append a record to the store.
   * 
   * @param record - Record to append
   */
  append(record: ReputationRecord): void {
    const line = JSON.stringify(record) + '\n';
    appendFileSync(this.filePath, line, 'utf8');
  }
  
  /**
   * Read all records from the store.
   * 
   * @returns Array of all records
   */
  readAll(): ReputationRecord[] {
    if (!existsSync(this.filePath)) {
      return [];
    }
    
    const content = readFileSync(this.filePath, 'utf8');
    if (content.trim() === '') {
      return [];
    }
    
    const lines = content.split('\n').filter(line => line.trim() !== '');
    return lines.map(line => JSON.parse(line) as ReputationRecord);
  }
  
  /**
   * Get all verification records.
   * 
   * @returns Array of verification records
   */
  getVerifications(): VerificationRecord[] {
    const records = this.readAll();
    return records
      .filter(r => r.type === 'verification')
      .map(r => r.data as VerificationRecord);
  }
  
  /**
   * Get verification records for a specific agent.
   * 
   * @param agent - Public key of agent
   * @param domain - Optional domain filter
   * @returns Array of verification records
   */
  getVerificationsForAgent(agent: string, domain?: string): VerificationRecord[] {
    const verifications = this.getVerifications();
    return verifications.filter(v => {
      if (v.target !== agent) return false;
      if (domain && v.domain !== domain) return false;
      return true;
    });
  }
  
  /**
   * Get all commit records.
   * 
   * @returns Array of commit records
   */
  getCommits(): CommitRecord[] {
    const records = this.readAll();
    return records
      .filter(r => r.type === 'commit')
      .map(r => r.data as CommitRecord);
  }
  
  /**
   * Get a commit record by ID.
   * 
   * @param id - Commit record ID
   * @returns Commit record or undefined if not found
   */
  getCommitById(id: string): CommitRecord | undefined {
    const commits = this.getCommits();
    return commits.find(c => c.id === id);
  }
  
  /**
   * Get all reveal records.
   * 
   * @returns Array of reveal records
   */
  getReveals(): RevealRecord[] {
    const records = this.readAll();
    return records
      .filter(r => r.type === 'reveal')
      .map(r => r.data as RevealRecord);
  }
  
  /**
   * Get a reveal record by commitment ID.
   * 
   * @param commitmentId - ID of the commit record
   * @returns Reveal record or undefined if not found
   */
  getRevealByCommitmentId(commitmentId: string): RevealRecord | undefined {
    const reveals = this.getReveals();
    return reveals.find(r => r.commitmentId === commitmentId);
  }
  
  /**
   * Get all revocation records.
   * 
   * @returns Array of revocation records
   */
  getRevocations(): RevocationRecord[] {
    const records = this.readAll();
    return records
      .filter(r => r.type === 'revocation')
      .map(r => r.data as RevocationRecord);
  }
  
  /**
   * Check if a verification has been revoked.
   * 
   * @param verificationId - ID of the verification
   * @returns true if revoked, false otherwise
   */
  isRevoked(verificationId: string): boolean {
    const revocations = this.getRevocations();
    return revocations.some(r => r.verificationId === verificationId);
  }
  
  /**
   * Get active (non-revoked) verifications.
   * 
   * @returns Array of verification records that haven't been revoked
   */
  getActiveVerifications(): VerificationRecord[] {
    const verifications = this.getVerifications();
    const revocations = this.getRevocations();
    const revokedIds = new Set(revocations.map(r => r.verificationId));
    
    return verifications.filter(v => !revokedIds.has(v.id));
  }
  
  /**
   * Get active verifications for a specific agent.
   * 
   * @param agent - Public key of agent
   * @param domain - Optional domain filter
   * @returns Array of active verification records
   */
  getActiveVerificationsForAgent(agent: string, domain?: string): VerificationRecord[] {
    const verifications = this.getActiveVerifications();
    return verifications.filter(v => {
      if (v.target !== agent) return false;
      if (domain && v.domain !== domain) return false;
      return true;
    });
  }
}

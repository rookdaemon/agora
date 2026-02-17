/**
 * Local reputation store using JSONL (JSON Lines) format.
 * Append-only log for crash-safe, tamper-evident storage.
 */

import { existsSync, mkdirSync, readFileSync, appendFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { homedir } from 'node:os';
import { resolve } from 'node:path';
import type {
  VerificationRecord,
  CommitRecord,
  RevealRecord,
  RevocationRecord,
} from './types.js';

/**
 * Type guard for reputation records stored in JSONL.
 */
type ReputationRecord =
  | { type: 'verification'; record: VerificationRecord }
  | { type: 'commit'; record: CommitRecord }
  | { type: 'reveal'; record: RevealRecord }
  | { type: 'revocation'; record: RevocationRecord };

/**
 * Local reputation store backed by JSONL file.
 */
export class ReputationStore {
  private filePath: string;
  
  /**
   * Create a new reputation store.
   * 
   * @param filePath - Path to JSONL file (optional, defaults to ~/.local/share/agora/reputation.jsonl)
   */
  constructor(filePath?: string) {
    this.filePath = filePath || this.getDefaultPath();
    this.ensureFileExists();
  }
  
  /**
   * Get default reputation store path.
   */
  private getDefaultPath(): string {
    return resolve(homedir(), '.local', 'share', 'agora', 'reputation.jsonl');
  }
  
  /**
   * Ensure the store file and directory exist.
   */
  private ensureFileExists(): void {
    const dir = dirname(this.filePath);
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }
    if (!existsSync(this.filePath)) {
      appendFileSync(this.filePath, '');
    }
  }
  
  /**
   * Append a verification record to the store.
   */
  appendVerification(record: VerificationRecord): void {
    const entry: ReputationRecord = { type: 'verification', record };
    this.appendLine(entry);
  }
  
  /**
   * Append a commit record to the store.
   */
  appendCommit(record: CommitRecord): void {
    const entry: ReputationRecord = { type: 'commit', record };
    this.appendLine(entry);
  }
  
  /**
   * Append a reveal record to the store.
   */
  appendReveal(record: RevealRecord): void {
    const entry: ReputationRecord = { type: 'reveal', record };
    this.appendLine(entry);
  }
  
  /**
   * Append a revocation record to the store.
   */
  appendRevocation(record: RevocationRecord): void {
    const entry: ReputationRecord = { type: 'revocation', record };
    this.appendLine(entry);
  }
  
  /**
   * Append a line to the JSONL file.
   */
  private appendLine(entry: ReputationRecord): void {
    const line = JSON.stringify(entry) + '\n';
    appendFileSync(this.filePath, line, 'utf-8');
  }
  
  /**
   * Read all records from the store.
   */
  readAll(): ReputationRecord[] {
    if (!existsSync(this.filePath)) {
      return [];
    }
    
    const content = readFileSync(this.filePath, 'utf-8');
    const lines = content.split('\n').filter(line => line.trim().length > 0);
    
    return lines.map(line => {
      try {
        return JSON.parse(line) as ReputationRecord;
      } catch (error) {
        console.error('Failed to parse JSONL line:', line, error);
        throw error;
      }
    });
  }
  
  /**
   * Get all verification records.
   */
  getVerifications(): VerificationRecord[] {
    return this.readAll()
      .filter((entry): entry is { type: 'verification'; record: VerificationRecord } => 
        entry.type === 'verification'
      )
      .map(entry => entry.record);
  }
  
  /**
   * Get all commit records.
   */
  getCommits(): CommitRecord[] {
    return this.readAll()
      .filter((entry): entry is { type: 'commit'; record: CommitRecord } => 
        entry.type === 'commit'
      )
      .map(entry => entry.record);
  }
  
  /**
   * Get all reveal records.
   */
  getReveals(): RevealRecord[] {
    return this.readAll()
      .filter((entry): entry is { type: 'reveal'; record: RevealRecord } => 
        entry.type === 'reveal'
      )
      .map(entry => entry.record);
  }
  
  /**
   * Get all revocation records.
   */
  getRevocations(): RevocationRecord[] {
    return this.readAll()
      .filter((entry): entry is { type: 'revocation'; record: RevocationRecord } => 
        entry.type === 'revocation'
      )
      .map(entry => entry.record);
  }
  
  /**
   * Get verifications for a specific target message.
   */
  getVerificationsForTarget(targetId: string): VerificationRecord[] {
    return this.getVerifications().filter(v => v.target === targetId);
  }
  
  /**
   * Get verifications by a specific verifier in a domain.
   */
  getVerificationsByVerifier(verifier: string, domain?: string): VerificationRecord[] {
    const verifications = this.getVerifications().filter(v => v.verifier === verifier);
    
    if (domain) {
      return verifications.filter(v => v.domain === domain);
    }
    
    return verifications;
  }
  
  /**
   * Get commit by ID.
   */
  getCommitById(commitId: string): CommitRecord | null {
    const commits = this.getCommits();
    return commits.find(c => c.id === commitId) || null;
  }
  
  /**
   * Get reveal for a specific commit.
   */
  getRevealForCommit(commitId: string): RevealRecord | null {
    const reveals = this.getReveals();
    return reveals.find(r => r.commitmentId === commitId) || null;
  }
}

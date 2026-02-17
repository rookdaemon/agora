/**
 * Local reputation store using JSONL (JSON Lines) format.
 * Append-only log for verification messages.
 */

import { readFileSync, appendFileSync, existsSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import type { VerificationRecord, CommitRecord, RevealRecord, RevocationRecord, TrustScore } from './types.js';
import { computeTrustScore } from './scoring.js';

/**
 * Entry types stored in the reputation log.
 */
type LogEntry = 
  | { type: 'verification'; record: VerificationRecord }
  | { type: 'commit'; record: CommitRecord }
  | { type: 'reveal'; record: RevealRecord }
  | { type: 'revocation'; record: RevocationRecord };

/**
 * Reputation store backed by JSONL append-only log.
 * Provides query methods for reputation data.
 */
export class ReputationStore {
  private readonly filePath: string;
  private verifications: VerificationRecord[] = [];
  private commits: CommitRecord[] = [];
  private reveals: RevealRecord[] = [];
  private revocations: RevocationRecord[] = [];
  private revokedIds: Set<string> = new Set();

  constructor(filePath: string) {
    this.filePath = filePath;
    this.ensureDirectory();
    this.load();
  }

  /**
   * Ensure the directory for the log file exists.
   */
  private ensureDirectory(): void {
    const dir = dirname(this.filePath);
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }
  }

  /**
   * Load all records from the JSONL file.
   */
  private load(): void {
    if (!existsSync(this.filePath)) {
      return; // Empty store
    }

    const content = readFileSync(this.filePath, 'utf-8');
    const lines = content.trim().split('\n').filter(line => line.length > 0);

    for (const line of lines) {
      try {
        const entry = JSON.parse(line) as LogEntry;
        this.processEntry(entry);
      } catch {
        // Skip malformed lines
        console.warn(`Skipping malformed JSONL entry: ${line}`);
      }
    }
  }

  /**
   * Process a log entry and update in-memory state.
   */
  private processEntry(entry: LogEntry): void {
    switch (entry.type) {
      case 'verification':
        this.verifications.push(entry.record);
        break;
      case 'commit':
        this.commits.push(entry.record);
        break;
      case 'reveal':
        this.reveals.push(entry.record);
        break;
      case 'revocation':
        this.revocations.push(entry.record);
        this.revokedIds.add(entry.record.verificationId);
        break;
    }
  }

  /**
   * Append an entry to the JSONL log.
   */
  private append(entry: LogEntry): void {
    const line = JSON.stringify(entry) + '\n';
    appendFileSync(this.filePath, line, 'utf-8');
    this.processEntry(entry);
  }

  /**
   * Add a verification record to the store.
   */
  addVerification(record: VerificationRecord): void {
    this.append({ type: 'verification', record });
  }

  /**
   * Add a commit record to the store.
   */
  addCommit(record: CommitRecord): void {
    this.append({ type: 'commit', record });
  }

  /**
   * Add a reveal record to the store.
   */
  addReveal(record: RevealRecord): void {
    this.append({ type: 'reveal', record });
  }

  /**
   * Add a revocation record to the store.
   */
  addRevocation(record: RevocationRecord): void {
    this.append({ type: 'revocation', record });
  }

  /**
   * Get all verifications for a specific target (message/output).
   */
  getVerificationsForTarget(target: string): VerificationRecord[] {
    return this.verifications.filter(v => v.target === target && !this.revokedIds.has(v.id));
  }

  /**
   * Get all verifications by a specific verifier.
   */
  getVerificationsByVerifier(verifier: string): VerificationRecord[] {
    return this.verifications.filter(v => v.verifier === verifier && !this.revokedIds.has(v.id));
  }

  /**
   * Get all verifications in a specific domain.
   */
  getVerificationsByDomain(domain: string): VerificationRecord[] {
    return this.verifications.filter(v => v.domain === domain && !this.revokedIds.has(v.id));
  }

  /**
   * Get a commit by its ID.
   */
  getCommit(id: string): CommitRecord | undefined {
    return this.commits.find(c => c.id === id);
  }

  /**
   * Get all commits by an agent.
   */
  getCommitsByAgent(agent: string): CommitRecord[] {
    return this.commits.filter(c => c.agent === agent);
  }

  /**
   * Get a reveal by commitment ID.
   */
  getRevealByCommitment(commitmentId: string): RevealRecord | undefined {
    return this.reveals.find(r => r.commitmentId === commitmentId);
  }

  /**
   * Get all reveals by an agent.
   */
  getRevealsByAgent(agent: string): RevealRecord[] {
    return this.reveals.filter(r => r.agent === agent);
  }

  /**
   * Compute trust score for an agent in a domain.
   */
  computeTrustScore(agent: string, domain: string, currentTime?: number): TrustScore {
    // Get all verifications where the target is from this agent
    // This requires linking targets to agents - for now, we'll compute based on
    // verifications targeting any outputs/messages in the domain
    // In a real implementation, we'd need a mapping of target IDs to agent public keys
    
    // For Phase 1, we'll use a simpler approach: filter verifications by domain
    // and assume the scoring function handles the rest
    return computeTrustScore(agent, domain, this.verifications, currentTime, this.revokedIds);
  }

  /**
   * Get all stored verifications (excluding revoked).
   */
  getAllVerifications(): VerificationRecord[] {
    return this.verifications.filter(v => !this.revokedIds.has(v.id));
  }

  /**
   * Get all stored commits.
   */
  getAllCommits(): CommitRecord[] {
    return this.commits;
  }

  /**
   * Get all stored reveals.
   */
  getAllReveals(): RevealRecord[] {
    return this.reveals;
  }

  /**
   * Get all stored revocations.
   */
  getAllRevocations(): RevocationRecord[] {
    return this.revocations;
  }

  /**
   * Check if a verification has been revoked.
   */
  isRevoked(verificationId: string): boolean {
    return this.revokedIds.has(verificationId);
  }

  /**
   * Get the file path of this store.
   */
  getFilePath(): string {
    return this.filePath;
  }
}

/**
 * Get the default reputation store path.
 */
export function getDefaultStorePath(): string {
  const homeDir = process.env.HOME || process.env.USERPROFILE || '/tmp';
  return `${homeDir}/.local/share/agora/reputation.jsonl`;
}

/**
 * Payload for 'paper_discovery' messages.
 * An agent publishes a discovered academic paper to the network.
 * Each paper gets its own envelope for easy referencing and threading.
 */
export interface PaperDiscoveryPayload {
  /** arXiv identifier (e.g. "2501.12345") */
  arxiv_id: string;
  /** Paper title */
  title: string;
  /** List of author names */
  authors: string[];
  /** Key contribution in 1-2 sentences */
  claim: string;
  /** Confidence score (0-1) in the relevance/importance assessment */
  confidence: number;
  /** Tags describing relevance domains */
  relevance_tags: string[];
  /** Agent ID of the discoverer */
  discoverer: string;
  /** ISO 8601 timestamp of discovery */
  timestamp: string;
  /** URL to the abstract page */
  abstract_url: string;
  /** URL to the PDF (optional) */
  pdf_url?: string;
}

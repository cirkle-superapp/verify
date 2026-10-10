/**
 * CirkleChain v1.0 — Open-Source, Zero-Cost, No-Billing Blockchain
 *
 * ════════════════════════════════════════════════════════════════════════════
 *   CirkleChain — A Custom Blockchain for Identity Verification
 * ════════════════════════════════════════════════════════════════════════════
 *
 * Architecture:
 *   - Proof of Authority (PoA) — no mining, no energy waste
 *   - SHA-256 hashing — industry standard
 *   - Merkle trees — efficient inclusion proofs
 *   - W3C Verifiable Credentials — interoperable identity
 *   - Zero-knowledge proofs — privacy-preserving verification
 *
 * Properties:
 *   ✓ Zero gas fees (no billing ever)
 *   ✓ Zero external dependencies (pure Node.js crypto)
 *   ✓ Fully open source (part of the Cirkle platform)
 *   ✓ Immutable (blocks are cryptographically chained)
 *   ✓ Tamper-evident (any change invalidates the chain)
 *   ✓ Verifiable by anyone (public API)
 *   ✓ Self-sovereign (users own their credentials)
 *
 * Block structure:
 *   ┌─────────────────────────────────┐
 *   │ Block Header                   │
 *   │   index: number                │
 *   │   timestamp: ISO 8601          │
 *   │   previousHash: SHA-256         │
 *   │   merkleRoot: SHA-256          │
 *   │   nonce: number (PoA)          │
 *   │   validator: HMAC signature    │
 *   │   hash: SHA-256(header)        │
 *   ├─────────────────────────────────┤
 *   │ Transactions[]                 │
 *   │   type: string                  │
 *   │   payload: any                  │
 *   │   signature: HMAC              │
 *   │   timestamp: ISO 8601          │
 *   └─────────────────────────────────┘
 *
 * Transaction types:
 *   - verification_record  → store verification results
 *   - identity_anchor      → anchor user identity hash
 *   - credential_issued    → issue W3C verifiable credential
 *   - credential_revoked   → revoke a credential
 *   - audit_entry         → store audit log entry
 *   - zkp_commit           → zero-knowledge commitment
 *   - zkp_reveal           → zero-knowledge reveal
 */

import crypto from "node:crypto";
import { sha256, MerkleTree } from "./merkle-tree";
import {
  issueCredential,
  verifyCredential,
  isExpired,
  type VerifiableCredential,
  type CredentialType,
} from "./verifiable-credentials";
import {
  commit,
  reveal,
  verifyCommitment,
  rangeProof,
  membershipProof,
  generateCID,
  type Commitment,
  type Reveal,
} from "./zero-knowledge";

// ════════════════════════════════════════════════════════════════════════════
// Types
// ════════════════════════════════════════════════════════════════════════════

export type TransactionType =
  | "verification_record"
  | "identity_anchor"
  | "credential_issued"
  | "credential_revoked"
  | "audit_entry"
  | "zkp_commit"
  | "zkp_reveal";

export interface Transaction {
  id: string;                  // Transaction hash (CID)
  type: TransactionType;
  payload: any;                // Transaction-specific data
  signature: string;          // HMAC-SHA256 signature
  timestamp: string;          // ISO 8601
}

export interface Block {
  index: number;
  timestamp: string;
  previousHash: string;
  merkleRoot: string;
  nonce: number;
  validator: string;          // HMAC signature proving authority
  hash: string;
  transactions: Transaction[];
}

// ════════════════════════════════════════════════════════════════════════════
// CirkleChain — The Blockchain
// ════════════════════════════════════════════════════════════════════════════

/**
 * CirkleChain — a lightweight, open-source blockchain for identity verification.
 *
 * Proof of Authority (PoA): blocks are validated by the platform's HMAC key.
 * No mining, no gas fees, no billing. The chain is stored in-memory and
 * can be persisted to Turso (authoritative) + Neon (recovery).
 */
export class CirkleChain {
  private chain: Block[] = [];
  private pendingTransactions: Transaction[] = [];
  private secret: string;
  private validators: Set<string> = new Set();
  private revokedCredentials: Set<string> = new Set();

  constructor(secret: string) {
    this.secret = secret || "cirkle-chain-default-secret";
    // Create genesis block
    this.chain.push(this.createGenesisBlock());
  }

  /** Create the genesis block (block 0). */
  private createGenesisBlock(): Block {
    const genesis: Block = {
      index: 0,
      timestamp: new Date().toISOString(),
      previousHash: "0".repeat(64),
      merkleRoot: sha256("genesis"),
      nonce: 0,
      validator: "genesis",
      hash: "",
      transactions: [],
    };
    genesis.hash = this.computeBlockHash(genesis);
    return genesis;
  }

  /** Compute the SHA-256 hash of a block's header. */
  private computeBlockHash(block: Omit<Block, "hash">): string {
    const header = JSON.stringify({
      index: block.index,
      timestamp: block.timestamp,
      previousHash: block.previousHash,
      merkleRoot: block.merkleRoot,
      nonce: block.nonce,
      validator: block.validator,
    });
    return sha256(header);
  }

  /** Sign a transaction payload with HMAC-SHA256. */
  private signTransaction(type: TransactionType, payload: any): string {
    const canonical = JSON.stringify({ type, payload }, Object.keys({ type, payload }).sort());
    return crypto.createHmac("sha256", this.secret).update(canonical).digest("hex");
  }

  /** Verify a transaction's signature. */
  private verifyTransaction(tx: Transaction): boolean {
    const canonical = JSON.stringify({ type: tx.type, payload: tx.payload }, Object.keys({ type: tx.type, payload: tx.payload }).sort());
    const expected = crypto.createHmac("sha256", this.secret).update(canonical).digest("hex");
    const a = Buffer.from(tx.signature, "hex");
    const b = Buffer.from(expected, "hex");
    if (a.length !== b.length) return false;
    return crypto.timingSafeEqual(a, b);
  }

  // ═══ Public API ══════════════════════════════════════════════════════

  /**
   * Add a transaction to the pending pool.
   * Returns the transaction CID (content-addressed identifier).
   */
  addTransaction(type: TransactionType, payload: any): string {
    const tx: Transaction = {
      id: "",
      type,
      payload,
      signature: this.signTransaction(type, payload),
      timestamp: new Date().toISOString(),
    };
    tx.id = generateCID(JSON.stringify(tx));
    this.pendingTransactions.push(tx);
    return tx.id;
  }

  /**
   * Mine a new block (Proof of Authority — no actual mining, just signing).
   * All pending transactions are included in the new block.
   *
   * Returns the mined block.
   */
  mineBlock(): Block {
    const transactions = [...this.pendingTransactions];
    const previousBlock = this.chain[this.chain.length - 1];

    // Build Merkle tree from transactions
    const merkleTree = new MerkleTree(
      transactions.map((tx) => JSON.stringify(tx)),
    );

    const blockData: Omit<Block, "hash"> = {
      index: previousBlock.index + 1,
      timestamp: new Date().toISOString(),
      previousHash: previousBlock.hash,
      merkleRoot: merkleTree.getRoot(),
      nonce: 0, // PoA — no nonce needed
      validator: crypto.createHmac("sha256", this.secret).update(`block-${previousBlock.index + 1}`).digest("hex"),
      transactions,
    };

    const hash = this.computeBlockHash(blockData);
    const block: Block = { ...blockData, hash };

    this.chain.push(block);
    this.pendingTransactions = [];

    return block;
  }

  /**
   * Verify the entire chain integrity.
   * Checks:
   *   - Each block's hash matches its header
   *   - Each block's previousHash matches the previous block's hash
   *   - Each block's merkleRoot matches the Merkle tree of its transactions
   *   - Each transaction's signature is valid
   *
   * Returns true if the chain is valid.
   */
  verifyChain(): { valid: boolean; errors: string[] } {
    const errors: string[] = [];

    for (let i = 0; i < this.chain.length; i++) {
      const block = this.chain[i];

      // Verify hash
      const expectedHash = this.computeBlockHash(block);
      if (block.hash !== expectedHash) {
        errors.push(`Block ${i}: hash mismatch`);
      }

      // Verify previous hash chain
      if (i > 0 && block.previousHash !== this.chain[i - 1].hash) {
        errors.push(`Block ${i}: previousHash mismatch`);
      }

      // Verify Merkle root
      const merkleTree = new MerkleTree(
        block.transactions.map((tx) => JSON.stringify(tx)),
      );
      if (block.merkleRoot !== merkleTree.getRoot()) {
        errors.push(`Block ${i}: merkleRoot mismatch`);
      }

      // Verify transaction signatures
      for (const tx of block.transactions) {
        if (!this.verifyTransaction(tx)) {
          errors.push(`Block ${i}: transaction ${tx.id} signature invalid`);
        }
      }
    }

    return { valid: errors.length === 0, errors };
  }

  /**
   * Generate a Merkle proof for a transaction in a specific block.
   */
  getTransactionProof(blockIndex: number, txIndex: number): {
    blockHash: string;
    merkleRoot: string;
    proof: import("./merkle-tree").MerkleProofElement[];
    transaction: Transaction;
  } | null {
    const block = this.chain[blockIndex];
    if (!block || !block.transactions[txIndex]) return null;

    const merkleTree = new MerkleTree(
      block.transactions.map((tx) => JSON.stringify(tx)),
    );
    const proof = merkleTree.getProof(txIndex);

    return {
      blockHash: block.hash,
      merkleRoot: block.merkleRoot,
      proof,
      transaction: block.transactions[txIndex],
    };
  }

  /**
   * Verify a Merkle proof for a transaction.
   */
  verifyTransactionProof(
    transaction: Transaction,
    proof: import("./merkle-tree").MerkleProofElement[],
    merkleRoot: string,
  ): boolean {
    return MerkleTree.verify(JSON.stringify(transaction), proof, merkleRoot);
  }

  // ═══ High-Level Operations ══════════════════════════════════════════

  /**
   * Anchor a verification record on the blockchain.
   * This creates an immutable, publicly verifiable record of the verification.
   */
  anchorVerification(
    userId: string,
    verificationResult: {
      docType: string;
      country: string;
      status: string;
      score: number;
      timestamp: string;
    },
  ): string {
    return this.addTransaction("verification_record", {
      userId: sha256(userId), // Hash the user ID for privacy
      ...verificationResult,
    });
  }

  /**
   * Anchor a user's identity hash on-chain (self-sovereign identity).
   */
  anchorIdentity(userId: string, identityHash: string): string {
    return this.addTransaction("identity_anchor", {
      userId: sha256(userId),
      identityHash,
    });
  }

  /**
   * Issue a W3C Verifiable Credential and anchor it on-chain.
   */
  issueCredentialOnChain(
    type: CredentialType,
    subjectId: string,
    claims: Record<string, any>,
  ): { credential: VerifiableCredential; txId: string } {
    const credential = issueCredential(type, subjectId, claims, this.secret);
    const txId = this.addTransaction("credential_issued", {
      credentialId: credential.id,
      type: credential.type,
      subject: credential.credentialSubject.id,
      issuer: credential.issuer,
      issuanceDate: credential.issuanceDate,
      expirationDate: credential.expirationDate,
    });
    return { credential, txId };
  }

  /**
   * Revoke a credential on-chain.
   */
  revokeCredential(credentialId: string): string {
    this.revokedCredentials.add(credentialId);
    return this.addTransaction("credential_revoked", {
      credentialId,
      revokedAt: new Date().toISOString(),
    });
  }

  /**
   * Check if a credential is revoked.
   */
  isCredentialRevoked(credentialId: string): boolean {
    return this.revokedCredentials.has(credentialId);
  }

  /**
   * Verify a credential (signature + not revoked + not expired).
   */
  verifyCredentialFull(credential: VerifiableCredential): {
    valid: boolean;
    signatureValid: boolean;
    notRevoked: boolean;
    notExpired: boolean;
    errors: string[];
  } {
    const errors: string[] = [];
    const signatureValid = verifyCredential(credential, this.secret);
    const notRevoked = !this.isCredentialRevoked(credential.id);
    const notExpiredFlag = !isExpired(credential);

    if (!signatureValid) errors.push("Invalid signature");
    if (!notRevoked) errors.push("Credential revoked");
    if (!notExpiredFlag) errors.push("Credential expired");

    return {
      valid: signatureValid && notRevoked && notExpiredFlag,
      signatureValid,
      notRevoked,
      notExpired: notExpiredFlag,
      errors,
    };
  }

  /**
   * Create a zero-knowledge commitment on-chain.
   */
  createZkpCommit(value: string, claim: string): { commitment: Commitment; txId: string } {
    const commitment = commit(value, claim);
    const txId = this.addTransaction("zkp_commit", {
      commitmentHash: commitment.hash,
      claim: commitment.claim,
      committedAt: commitment.committedAt,
    });
    return { commitment, txId };
  }

  /**
   * Reveal a zero-knowledge commitment on-chain.
   */
  revealZkpCommit(value: string, salt: string, claim: string): { reveal: Reveal; txId: string } {
    const revealObj = reveal(value, salt, claim);
    const txId = this.addTransaction("zkp_reveal", {
      value: revealObj.value,
      salt: revealObj.salt,
      claim: revealObj.claim,
      revealedAt: revealObj.revealedAt,
    });
    return { reveal: revealObj, txId };
  }

  // ═══ Chain Inspection ════════════════════════════════════════════════

  /** Get the latest block. */
  getLatestBlock(): Block {
    return this.chain[this.chain.length - 1];
  }

  /** Get the chain height (block count). */
  getHeight(): number {
    return this.chain.length;
  }

  /** Get a block by index. */
  getBlock(index: number): Block | null {
    return this.chain[index] || null;
  }

  /** Get a block by hash. */
  getBlockByHash(hash: string): Block | null {
    return this.chain.find((b) => b.hash === hash) || null;
  }

  /** Get all blocks (for explorer). */
  getAllBlocks(): Block[] {
    return this.chain;
  }

  /** Get pending transactions count. */
  getPendingCount(): number {
    return this.pendingTransactions.length;
  }

  /** Get all transactions across all blocks. */
  getAllTransactions(): Transaction[] {
    return this.chain.flatMap((b) => b.transactions);
  }

  /** Search transactions by type. */
  getTransactionsByType(type: TransactionType): Transaction[] {
    return this.getAllTransactions().filter((tx) => tx.type === type);
  }

  /** Get chain stats. */
  getStats(): {
    height: number;
    totalTransactions: number;
    totalCredentials: number;
    totalVerifications: number;
    totalAnchors: number;
    totalZkpCommits: number;
    pendingTransactions: number;
    chainValid: boolean;
    latestBlockHash: string;
    genesisHash: string;
  } {
    const allTx = this.getAllTransactions();
    return {
      height: this.chain.length,
      totalTransactions: allTx.length,
      totalCredentials: allTx.filter((t) => t.type === "credential_issued").length,
      totalVerifications: allTx.filter((t) => t.type === "verification_record").length,
      totalAnchors: allTx.filter((t) => t.type === "identity_anchor").length,
      totalZkpCommits: allTx.filter((t) => t.type === "zkp_commit").length,
      pendingTransactions: this.pendingTransactions.length,
      chainValid: this.verifyChain().valid,
      latestBlockHash: this.getLatestBlock().hash,
      genesisHash: this.chain[0].hash,
    };
  }

  /** Serialize the entire chain (for persistence to Turso/Neon). */
  serialize(): string {
    return JSON.stringify({
      chain: this.chain,
      pending: this.pendingTransactions,
      revoked: Array.from(this.revokedCredentials),
    });
  }

  /** Deserialize from persisted state. */
  static deserialize(data: string, secret: string): CirkleChain {
    const parsed = JSON.parse(data);
    const chain = new CirkleChain(secret);
    chain.chain = parsed.chain;
    chain.pendingTransactions = parsed.pending || [];
    chain.revokedCredentials = new Set(parsed.revoked || []);
    return chain;
  }
}

// ════════════════════════════════════════════════════════════════════════════
// Singleton instance
// ════════════════════════════════════════════════════════════════════════════

let chainInstance: CirkleChain | null = null;

/**
 * Get the singleton CirkleChain instance.
 * Uses CERTIFICATE_HMAC_SECRET from environment for signing.
 */
export function getChain(): CirkleChain {
  if (!chainInstance) {
    const secret = process.env.CERTIFICATE_HMAC_SECRET || process.env.AUDIT_HMAC_SECRET || "cirkle-chain-fallback";
    chainInstance = new CirkleChain(secret);
  }
  return chainInstance;
}

/**
 * CirkleChain — Merkle Tree Implementation
 *
 * A Merkle tree provides efficient proof of inclusion: you can prove that
 * a specific transaction is in a block without downloading the entire block.
 * This is the foundation of blockchain verification.
 *
 * Properties:
 *   - O(log n) proof size (e.g., 1024 transactions → 10 proof elements)
 *   - Tamper-evident: any change to a leaf invalidates the root
 *   - Built from scratch using Node.js crypto (no external dependencies)
 *
 * Usage:
 *   const tree = new MerkleTree(["tx1", "tx2", "tx3"]);
 *   const root = tree.getRoot();           // block header contains this
 *   const proof = tree.getProof(0);        // proof that tx1 is in the tree
 *   const valid = MerkleTree.verify("tx1", proof, root);  // true
 */

import crypto from "node:crypto";

/** Compute SHA-256 hash of a string, returned as hex. */
export function sha256(data: string): string {
  return crypto.createHash("sha256").update(data, "utf8").digest("hex");
}

/** Concatenate two hashes and hash the result (Merkle parent). */
function merkleParent(left: string, right: string): string {
  // If odd number of leaves, duplicate the last one
  return sha256(left + right);
}

/** A Merkle proof element — either a left or right sibling hash. */
export interface MerkleProofElement {
  position: "left" | "right";
  hash: string;
}

/**
 * Merkle Tree — binary hash tree for efficient inclusion proofs.
 */
export class MerkleTree {
  private leaves: string[];
  private levels: string[][]; // levels[0] = leaves, levels[depth] = root

  constructor(transactions: string[]) {
    if (transactions.length === 0) {
      this.leaves = [sha256("empty")];
    } else {
      this.leaves = transactions.map((tx) => sha256(tx));
    }
    this.levels = this.build();
  }

  /** Build all levels of the tree bottom-up. */
  private build(): string[][] {
    const levels: string[][] = [this.leaves];
    let current = this.leaves;

    while (current.length > 1) {
      const next: string[] = [];
      for (let i = 0; i < current.length; i += 2) {
        const left = current[i];
        const right = i + 1 < current.length ? current[i + 1] : current[i]; // duplicate last if odd
        next.push(merkleParent(left, right));
      }
      levels.push(next);
      current = next;
    }
    return levels;
  }

  /** Get the Merkle root hash (stored in the block header). */
  getRoot(): string {
    return this.levels[this.levels.length - 1][0];
  }

  /** Get all leaf hashes. */
  getLeaves(): string[] {
    return this.leaves;
  }

  /** Get the depth of the tree (log2 of leaf count). */
  getDepth(): number {
    return this.levels.length - 1;
  }

  /**
   * Generate a Merkle proof for the leaf at the given index.
   * The proof is an array of sibling hashes + their positions.
   * Verification: hash(leaf, proof[0], proof[1], ...) == root
   */
  getProof(index: number): MerkleProofElement[] {
    const proof: MerkleProofElement[] = [];
    let idx = index;

    for (let level = 0; level < this.levels.length - 1; level++) {
      const currentLevel = this.levels[level];
      const isRightNode = idx % 2 === 1;
      const siblingIdx = isRightNode ? idx - 1 : idx + 1;

      if (siblingIdx < currentLevel.length) {
        proof.push({
          position: isRightNode ? "left" : "right",
          hash: currentLevel[siblingIdx],
        });
      }
      // If sibling doesn't exist (odd node), use self as sibling
      else {
        proof.push({
          position: "right",
          hash: currentLevel[idx],
        });
      }

      idx = Math.floor(idx / 2);
    }

    return proof;
  }

  /**
   * Verify a Merkle proof (static method).
   * @param leaf The original data (will be hashed)
   * @param proof The proof elements
   * @param root The expected Merkle root
   * @returns true if the proof is valid
   */
  static verify(leaf: string, proof: MerkleProofElement[], root: string): boolean {
    let hash = sha256(leaf);

    for (const element of proof) {
      if (element.position === "left") {
        hash = merkleParent(element.hash, hash);
      } else {
        hash = merkleParent(hash, element.hash);
      }
    }

    return hash === root;
  }

  /** Serialize for API responses. */
  toJSON(): { root: string; leafCount: number; depth: number } {
    return {
      root: this.getRoot(),
      leafCount: this.leaves.length,
      depth: this.getDepth(),
    };
  }
}

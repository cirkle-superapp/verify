import { NextRequest, NextResponse } from "next/server";
import { getChain, type TransactionType } from "@/lib/blockchain/cirkle-chain";
import { issueCredential } from "@/lib/blockchain/verifiable-credentials";
import { commit, reveal, verifyCommitment, rangeProof, membershipProof, generateCID } from "@/lib/blockchain/zero-knowledge";
import { MerkleTree } from "@/lib/blockchain/merkle-tree";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-API-Key",
};

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: CORS_HEADERS });
}

/**
 * GET /api/v1/verify/blockchain
 *
 * CirkleChain — Open-Source, Zero-Cost Blockchain Explorer
 *
 * Returns:
 *   - Chain stats (height, transaction count, validity)
 *   - Latest block
 *   - All blocks (for explorer view)
 *
 * Query params:
 *   - action=stats     → chain statistics
 *   - action=blocks    → all blocks
 *   - action=tx        → search transactions by type
 */
export async function GET(req: NextRequest) {
  const action = req.nextUrl.searchParams.get("action") || "stats";
  const chain = getChain();

  if (action === "stats") {
    const stats = chain.getStats();
    return NextResponse.json({
      name: "CirkleChain v1.0",
      type: "Proof of Authority (PoA)",
      ...stats,
      openSource: true,
      gasFees: 0,
      billingRequired: false,
      consensusAlgorithm: "HMAC-SHA256 Proof of Authority",
      hashAlgorithm: "SHA-256",
      merkleTree: "Binary SHA-256 Merkle Tree",
      credentialsStandard: "W3C Verifiable Credentials 1.1",
      zeroKnowledgeProofs: "Commit-Reveal + Range + Membership",
      contentAddressing: "Cirkle CID (SHA-256 based)",
    }, { headers: CORS_HEADERS });
  }

  if (action === "blocks") {
    const blocks = chain.getAllBlocks().slice(-20).reverse(); // last 20, newest first
    return NextResponse.json({
      height: chain.getHeight(),
      blocks: blocks.map((b) => ({
        index: b.index,
        hash: b.hash.slice(0, 16) + "…",
        fullHash: b.hash,
        timestamp: b.timestamp,
        txCount: b.transactions.length,
        merkleRoot: b.merkleRoot.slice(0, 16) + "…",
        previousHash: b.previousHash.slice(0, 16) + "…",
      })),
    }, { headers: CORS_HEADERS });
  }

  if (action === "tx") {
    const type = req.nextUrl.searchParams.get("type") as TransactionType;
    const txs = type ? chain.getTransactionsByType(type) : chain.getAllTransactions();
    return NextResponse.json({
      count: txs.length,
      transactions: txs.slice(-50).map((tx) => ({
        id: tx.id,
        type: tx.type,
        timestamp: tx.timestamp,
        payload: tx.payload,
      })),
    }, { headers: CORS_HEADERS });
  }

  return NextResponse.json({ error: "Unknown action. Use ?action=stats|blocks|tx" }, { status: 400, headers: CORS_HEADERS });
}

/**
 * POST /api/v1/verify/blockchain
 *
 * CirkleChain operations:
 *   { action: "anchor_verification", userId, result }     → anchor verification on-chain
 *   { action: "anchor_identity", userId, identityHash }   → anchor user identity
 *   { action: "issue_credential", type, subjectId, claims } → issue W3C VC
 *   { action: "revoke_credential", credentialId }          → revoke credential
 *   { action: "mine" }                                       → mine pending transactions
 *   { action: "verify_chain" }                              → verify chain integrity
 *   { action: "zkp_commit", value, claim }                 → zero-knowledge commit
 *   { action: "zkp_reveal", value, salt, claim }            → zero-knowledge reveal
 *   { action: "zkp_verify", commitment, reveal }            → verify ZKP
 *   { action: "range_proof", value, threshold, operator }   → prove value in range
 *   { action: "membership_proof", value, set, claim }        → prove set membership
 *   { action: "merkle_proof", blockIndex, txIndex }         → generate Merkle proof
 *   { action: "verify_merkle", transaction, proof, root }  → verify Merkle proof
 */
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { action } = body;
    const chain = getChain();

    switch (action) {
      case "anchor_verification": {
        const txId = chain.anchorVerification(body.userId, body.result);
        return NextResponse.json({ txId, message: "Verification anchored on-chain" }, { headers: CORS_HEADERS });
      }

      case "anchor_identity": {
        const txId = chain.anchorIdentity(body.userId, body.identityHash);
        return NextResponse.json({ txId, message: "Identity anchored on-chain" }, { headers: CORS_HEADERS });
      }

      case "issue_credential": {
        const { credential, txId } = chain.issueCredentialOnChain(body.type, body.subjectId, body.claims || {});
        return NextResponse.json({ credential, txId, message: "Credential issued and anchored on-chain" }, { headers: CORS_HEADERS });
      }

      case "revoke_credential": {
        const txId = chain.revokeCredential(body.credentialId);
        return NextResponse.json({ txId, message: "Credential revoked on-chain" }, { headers: CORS_HEADERS });
      }

      case "mine": {
        const block = chain.mineBlock();
        return NextResponse.json({
          block: { index: block.index, hash: block.hash, txCount: block.transactions.length, timestamp: block.timestamp },
          message: `Block ${block.index} mined with ${block.transactions.length} transactions`,
        }, { headers: CORS_HEADERS });
      }

      case "verify_chain": {
        const result = chain.verifyChain();
        return NextResponse.json({ valid: result.valid, errors: result.errors, height: chain.getHeight() }, { headers: CORS_HEADERS });
      }

      case "zkp_commit": {
        const { commitment, txId } = chain.createZkpCommit(body.value, body.claim);
        return NextResponse.json({ commitment, txId, message: "Zero-knowledge commitment anchored on-chain" }, { headers: CORS_HEADERS });
      }

      case "zkp_reveal": {
        const { reveal: revealObj, txId } = chain.revealZkpCommit(body.value, body.salt, body.claim);
        return NextResponse.json({ reveal: revealObj, txId, message: "Zero-knowledge reveal anchored on-chain" }, { headers: CORS_HEADERS });
      }

      case "zkp_verify": {
        const result = verifyCommitment(body.commitment, body.reveal);
        return NextResponse.json({ valid: result.valid, claim: result.claim, durationMs: result.durationMs }, { headers: CORS_HEADERS });
      }

      case "range_proof": {
        const result = rangeProof(body.value, body.threshold, body.operator || ">=");
        return NextResponse.json({ commitment: result.commitment, result: result.result, claim: result.commitment.claim }, { headers: CORS_HEADERS });
      }

      case "membership_proof": {
        const result = membershipProof(body.value, body.set, body.claim);
        return NextResponse.json({ commitment: result.commitment, isMember: result.isMember, setSize: result.setSize }, { headers: CORS_HEADERS });
      }

      case "merkle_proof": {
        const proof = chain.getTransactionProof(body.blockIndex, body.txIndex);
        if (!proof) return NextResponse.json({ error: "Block or transaction not found" }, { status: 404, headers: CORS_HEADERS });
        return NextResponse.json({
          blockHash: proof.blockHash.slice(0, 16) + "…",
          merkleRoot: proof.merkleRoot,
          proof: proof.proof,
          transaction: { id: proof.transaction.id, type: proof.transaction.type },
        }, { headers: CORS_HEADERS });
      }

      case "generate_cid": {
        const cid = generateCID(body.data);
        return NextResponse.json({ cid, algorithm: "SHA-256", prefix: "cir_" }, { headers: CORS_HEADERS });
      }

      default:
        return NextResponse.json({ error: `Unknown action: ${action}` }, { status: 400, headers: CORS_HEADERS });
    }
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || "Internal error", code: "internal_error" }, { status: 500, headers: CORS_HEADERS });
  }
}

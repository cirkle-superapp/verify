"use client";

import { useState, useEffect, useCallback } from "react";
import { motion } from "framer-motion";
import { Link2, Box, Shield, Zap, Eye, Lock, Check, Hash, Zap as ZapIcon, FileText } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";

interface ChainStats {
  name: string;
  type: string;
  height: number;
  totalTransactions: number;
  totalCredentials: number;
  totalVerifications: number;
  totalAnchors: number;
  totalZkpCommits: number;
  pendingTransactions: number;
  chainValid: boolean;
  gasFees: number;
  billingRequired: boolean;
  openSource: boolean;
  consensusAlgorithm: string;
  hashAlgorithm: string;
}

interface BlockInfo {
  index: number;
  hash: string;
  fullHash: string;
  timestamp: string;
  txCount: number;
  merkleRoot: string;
  previousHash: string;
}

export function BlockchainExplorer({ onBack }: { onBack?: () => void }) {
  const [stats, setStats] = useState<ChainStats | null>(null);
  const [blocks, setBlocks] = useState<BlockInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [action, setAction] = useState<string>("");
  const [result, setResult] = useState<any>(null);
  const [busy, setBusy] = useState(false);

  const fetchStats = useCallback(async () => {
    try {
      const [statsRes, blocksRes] = await Promise.all([
        fetch("/api/v1/verify/blockchain?action=stats").then(r => r.json()),
        fetch("/api/v1/verify/blockchain?action=blocks").then(r => r.json()),
      ]);
      setStats(statsRes);
      setBlocks(blocksRes.blocks || []);
      setLoading(false);
    } catch {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchStats(); }, [fetchStats]);

  const runAction = async (act: string, body?: any) => {
    setBusy(true);
    setAction(act);
    try {
      const res = await fetch("/api/v1/verify/blockchain", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: act, ...body }),
      });
      const data = await res.json();
      setResult(data);
      // Refresh stats after action
      setTimeout(fetchStats, 500);
    } finally {
      setBusy(false);
    }
  };

  if (loading) {
    return <div className="flex items-center justify-center min-h-[400px] text-muted-foreground animate-pulse">Loading CirkleChain…</div>;
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold flex items-center gap-2">
            <Box className="w-6 h-6 text-primary" />
            CirkleChain Explorer
          </h2>
          <p className="text-sm text-muted-foreground">
            Open-source, zero-cost, no-billing blockchain for identity verification
          </p>
        </div>
        {onBack && <Button variant="ghost" onClick={onBack}>Back</Button>}
      </div>

      {/* Stats */}
      {stats && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <StatCard label="Chain Height" value={stats.height} icon={Box} color="#22c55e" />
          <StatCard label="Transactions" value={stats.totalTransactions} icon={Zap} color="#3b82f6" />
          <StatCard label="Credentials" value={stats.totalCredentials} icon={FileText} color="#8b5cf6" />
          <StatCard label="ZKP Commits" value={stats.totalZkpCommits} icon={Lock} color="#ec4899" />
        </div>
      )}

      {/* Features banner */}
      <Card className="bg-gradient-to-r from-green-50 to-blue-50 dark:from-green-950/20 dark:to-blue-950/20">
        <CardContent className="p-4">
          <div className="flex flex-wrap items-center gap-3 text-sm">
            <Badge variant="outline" className="bg-green-50 dark:bg-green-950">
              <Check className="w-3 h-3 mr-1" /> Open Source
            </Badge>
            <Badge variant="outline" className="bg-green-50 dark:bg-green-950">
              <Check className="w-3 h-3 mr-1" /> Zero Gas Fees
            </Badge>
            <Badge variant="outline" className="bg-green-50 dark:bg-green-950">
              <Check className="w-3 h-3 mr-1" /> No Billing Ever
            </Badge>
            <Badge variant="outline" className="bg-green-50 dark:bg-green-950">
              <Check className="w-3 h-3 mr-1" /> Proof of Authority
            </Badge>
            <Badge variant="outline" className="bg-green-50 dark:bg-green-950">
              <Check className="w-3 h-3 mr-1" /> SHA-256 Hashing
            </Badge>
            <Badge variant="outline" className="bg-green-50 dark:bg-green-950">
              <Check className="w-3 h-3 mr-1" /> Merkle Trees
            </Badge>
            <Badge variant="outline" className="bg-green-50 dark:bg-green-950">
              <Check className="w-3 h-3 mr-1" /> W3C Verifiable Credentials
            </Badge>
            <Badge variant="outline" className="bg-green-50 dark:bg-green-950">
              <Check className="w-3 h-3 mr-1" /> Zero-Knowledge Proofs
            </Badge>
          </div>
        </CardContent>
      </Card>

      {/* Actions */}
      <div className="flex flex-wrap gap-2">
        <Button size="sm" variant="default" disabled={busy} onClick={() => runAction("mine")}>
          <ZapIcon className="w-4 h-4 mr-1" /> Mine Block
        </Button>
        <Button size="sm" variant="outline" disabled={busy} onClick={() => runAction("anchor_verification", { userId: "demo", result: { docType: "national_id", country: "EG", status: "verified", score: 0.92, timestamp: new Date().toISOString() } })}>
          <Link2 className="w-4 h-4 mr-1" /> Anchor Verification
        </Button>
        <Button size="sm" variant="outline" disabled={busy} onClick={() => runAction("issue_credential", { type: "IdentityVerification", subjectId: "did:cirkle:user:demo", claims: { country: "EG", verified: true, score: 0.92 } })}>
          <FileText className="w-4 h-4 mr-1" /> Issue Credential
        </Button>
        <Button size="sm" variant="outline" disabled={busy} onClick={() => runAction("zkp_commit", { value: "1990-01-01", claim: "age_over_18" })}>
          <Lock className="w-4 h-4 mr-1" /> ZKP Commit
        </Button>
        <Button size="sm" variant="outline" disabled={busy} onClick={() => runAction("range_proof", { value: 35, threshold: 18, operator: ">=" })}>
          <Shield className="w-4 h-4 mr-1" /> Range Proof (age ≥ 18)
        </Button>
        <Button size="sm" variant="outline" disabled={busy} onClick={() => runAction("verify_chain")}>
          <Check className="w-4 h-4 mr-1" /> Verify Chain
        </Button>
      </div>

      {/* Result */}
      {result && (
        <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}>
          <Card>
            <CardHeader>
              <CardTitle className="text-sm">Result: {action}</CardTitle>
            </CardHeader>
            <CardContent>
              <pre className="text-xs bg-muted p-4 rounded overflow-auto max-h-64">
                {JSON.stringify(result, null, 2)}
              </pre>
            </CardContent>
          </Card>
        </motion.div>
      )}

      {/* Block explorer */}
      <Card>
        <CardHeader>
          <CardTitle className="text-sm flex items-center gap-2">
            <Hash className="w-4 h-4" /> Block Explorer
            <Badge variant="outline" className="ml-auto">{stats?.height || 0} blocks</Badge>
          </CardTitle>
        </CardHeader>
        <CardContent>
          <ScrollArea className="max-h-96">
            <div className="space-y-2">
              {blocks.length === 0 ? (
                <p className="text-sm text-muted-foreground text-center py-4">
                  No blocks yet. Click "Mine Block" to create the first block.
                </p>
              ) : (
                blocks.map((block) => (
                  <div key={block.index} className="flex items-center gap-3 p-2 rounded border hover:bg-muted/50">
                    <div className="w-10 h-10 rounded-full bg-primary/10 flex items-center justify-center flex-shrink-0">
                      <span className="text-xs font-bold text-primary">{block.index}</span>
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="text-xs font-mono truncate">
                        {block.hash}
                      </div>
                      <div className="text-xs text-muted-foreground">
                        {block.txCount} tx · {new Date(block.timestamp).toLocaleTimeString()}
                      </div>
                    </div>
                    <Badge variant="outline" className="text-xs">
                      {block.txCount} tx
                    </Badge>
                  </div>
                ))
              )}
            </div>
          </ScrollArea>
        </CardContent>
      </Card>

      {/* Architecture */}
      <Card>
        <CardHeader>
          <CardTitle className="text-sm">Architecture</CardTitle>
        </CardHeader>
        <CardContent className="text-xs space-y-2 text-muted-foreground">
          <div><b>Consensus:</b> Proof of Authority (PoA) — no mining, no energy waste</div>
          <div><b>Hashing:</b> SHA-256 (Node.js crypto — zero external dependencies)</div>
          <div><b>Merkle Tree:</b> Binary SHA-256 — O(log n) inclusion proofs</div>
          <div><b>Credentials:</b> W3C Verifiable Credentials 1.1 — interoperable</div>
          <div><b>Zero-Knowledge:</b> Commit-Reveal + Range Proof + Membership Proof</div>
          <div><b>Content Addressing:</b> Cirkle CID (SHA-256 based, like IPFS)</div>
          <div><b>Signing:</b> HMAC-SHA256 (timing-safe comparison)</div>
          <div><b>Gas Fees:</b> 0 (zero billing, zero cost, forever)</div>
          <div><b>License:</b> MIT (fully open source)</div>
        </CardContent>
      </Card>
    </div>
  );
}

function StatCard({ label, value, icon: Icon, color }: { label: string; value: number; icon: any; color: string }) {
  return (
    <Card>
      <CardContent className="p-4">
        <div className="flex items-center gap-2 mb-1">
          <Icon className="w-4 h-4" style={{ color }} />
          <span className="text-xs text-muted-foreground">{label}</span>
        </div>
        <div className="text-2xl font-bold">{value}</div>
      </CardContent>
    </Card>
  );
}

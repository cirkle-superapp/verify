import { NextRequest, NextResponse } from "next/server";
import { createSession, getSession, updateSession, getAllSessions } from "@/lib/session-manager";
import { getClientIp } from "@/lib/rate-limit";

export const runtime = "nodejs";

// POST /api/v1/verify/session — create a new verification session
export async function POST(req: NextRequest) {
  const ip = getClientIp(req);
  const session = createSession(ip);
  return NextResponse.json({ session }, { status: 201 });
}

// GET /api/v1/verify/session — list all sessions (admin) or get by ?id=
export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const id = url.searchParams.get("id");
  if (id) {
    const session = getSession(id);
    if (!session) return NextResponse.json({ error: "Session not found" }, { status: 404 });
    return NextResponse.json({ session });
  }
  const sessions = getAllSessions();
  return NextResponse.json({ sessions, total: sessions.length });
}

// PATCH /api/v1/verify/session?id=xxx — update session state
export async function PATCH(req: NextRequest) {
  const url = new URL(req.url);
  const id = url.searchParams.get("id");
  if (!id) return NextResponse.json({ error: "id parameter required" }, { status: 400 });
  const body = await req.json();
  const session = updateSession(id, body.state, body.step, body.details);
  if (!session) return NextResponse.json({ error: "Session not found or expired" }, { status: 404 });
  return NextResponse.json({ session });
}

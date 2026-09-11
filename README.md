# Cirkle Identity Verification (دواير)

> AI-powered live identity verification for Egyptian & Arabic documents — **zero-cost, self-hosted, privacy-first**.

![Cirkle](https://cirkleapp.vercel.app/logo.svg)

## Features

- **3-pass Arabic OCR**: image quality assessment → Arabic-first OCR → structured field extraction
- **Egyptian National ID validation**: decodes 14-digit ID, validates checksum, infers gender/birthdate
- **MRZ parsing**: TD1 (ID cards) + TD3 (passports) machine-readable zone
- **Live face capture + VLM face match** against document photo
- **Live movement liveness**: 3 random challenges (turn left/right, look up, blink, smile) with anti-spoofing
- **Image quality scoring**: blur/glare/framing/rotation/lighting detection
- **Training database**: labeled synthetic + manual document samples with ground truth
- **Evaluation Lab**: full stress-test dashboard with per-field accuracy charts (recharts)
- **Rate limiting** on all API routes

## Tech Stack (all zero-cost, no per-check billing)

| Layer | Tech |
|---|---|
| Framework | Next.js 16, React 19, TypeScript 5 |
| UI | Tailwind CSS 4, shadcn/ui, Lucide icons |
| AI Vision | z-ai-web-dev-sdk (VLM — bundled, no API key needed) |
| Webcam | native `getUserMedia` API |
| Image processing | sharp + canvas |
| DB | Prisma ORM + SQLite (local) / Turso libSQL (production) |
| Charts | recharts |
| State | Zustand |

## Quick Start

```bash
bun install
bun run db:push    # push schema to local SQLite
bun run dev        # start on http://localhost:3000
```

## Database

Local dev uses SQLite (`db/custom.db`). For production (Turso):

```env
DATABASE_URL=libsql://your-db.turso.io
DATABASE_AUTH_TOKEN=your-token
```

The Prisma client auto-detects the URL protocol and uses the `@prisma/adapter-libsql` adapter for `libsql:` URLs.

## Verification Flow

1. **Intro** → 2. **Document type** → 3. **Capture** (camera/upload) → 4. **Review** (extracted fields) → 5. **Selfie** (face match) → 6. **Liveness** (movement challenge) → 7. **Result** (saved to DB)

## API Endpoints

| Method | Path | Description |
|---|---|---|
| POST | `/api/verify/document` | 3-pass OCR extraction (10 req/min) |
| POST | `/api/verify/face-match` | VLM face comparison (15 req/min) |
| POST | `/api/verify/liveness` | Anti-spoofing frame analysis (10 req/min) |
| GET/POST | `/api/verify/records` | Verification history CRUD |
| GET/POST/DELETE | `/api/verify/samples` | Training samples CRUD |
| POST | `/api/verify/samples/seed` | Bulk seed synthetic samples |
| GET/POST/DELETE | `/api/verify/evaluate` | Stress-test runs |

## Brand

- **Name**: Cirkle (دواير)
- **Theme color**: `#1A4A5A` (deep teal)
- **Background**: `#FDFCF9` (warm cream)
- **Logo**: official SVG from `cirkleapp.vercel.app/logo.svg`

## License

MIT

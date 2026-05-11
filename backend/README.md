# PayStream Backend

Real-time USDC salary streaming on Arc.
Built for the Stablecoin Commerce Stack Challenge — Track 1: Cross-Border Payments.

---

## What This Does

Every 60 seconds, the nanopayment cron reads all active salary streams
and dispatches USDC from the employer's Circle wallet to the worker's
Circle wallet on Arc testnet. Workers withdraw to any supported chain
at any time via CCTP Fast Transfer.

---

## Setup

### 1. Prerequisites

- Node.js 20+
- A free Circle developer account: https://console.circle.com
- A free Supabase project: https://supabase.com

### 2. Clone and install

```bash
cd backend
npm install
```

### 3. Configure environment

```bash
cp .env.example .env
```

Fill in:

- `CIRCLE_API_KEY`: from Circle Console > API Keys
- `CIRCLE_ENTITY_SECRET`: generate once with the Circle SDK helper:

```js
import { getEntitySecretCiphertext } from '@circle-fin/developer-controlled-wallets'
const { entitySecret } = getEntitySecretCiphertext()
console.log(entitySecret) // paste this into .env
```

- `SUPABASE_URL` and `SUPABASE_SERVICE_KEY`: from your Supabase project settings
- `ARC_RPC_URL`: use `https://rpc.arc.testnet.circle.com`

### 4. Create database tables

Paste the SQL block from `src/config/db.js` into your Supabase SQL editor and run it.

Also add the agent_log table:

```sql
create table agent_log (
  id             uuid primary key default gen_random_uuid(),
  stream_id      uuid references streams(id),
  worker_id      text not null,
  action         text not null,
  reason         text,
  activity_score numeric(4,2),
  created_at     timestamptz default now()
);
```

### 5. Start the server

```bash
npm run dev
```

You will see the banner printed and both cron jobs starting.

### 6. Get testnet USDC

Visit the Arc testnet faucet: https://faucet.arc.testnet.circle.com
Request USDC to any address to fund employer wallets for testing.

---

## API Reference

### Health

```
GET /api/v1/health
```

### Wallets

```
POST /api/v1/wallets
Body: { "userId": "emp_001", "role": "employer" }

GET /api/v1/wallets/:userId
Returns wallet record + current USDC balance
```

### Streams

```
POST /api/v1/streams
Body: {
  "employerId":  "emp_001",
  "workerId":    "worker_001",
  "ratePerHour": 18.50
}

GET  /api/v1/streams?employerId=emp_001&status=active
GET  /api/v1/streams/:id
GET  /api/v1/streams/:id/earned    (live earned since last payout)

POST /api/v1/streams/:id/pause
POST /api/v1/streams/:id/resume
POST /api/v1/streams/:id/stop
```

### Withdrawals

```
POST /api/v1/withdrawals
Body: {
  "workerId":           "worker_001",
  "amountUsdc":         200.00,
  "destinationChain":   "ethereum",
  "destinationAddress": "0xYourAddress"
}

GET /api/v1/withdrawals/:id          (poll for status)
GET /api/v1/withdrawals?workerId=worker_001
```

### Payouts

```
GET /api/v1/payouts?streamId=:id     (nanopayment history)
```

### Agent Log

```
GET /api/v1/agent-log?streamId=:id   (AI decisions for the stream)
```

---

## Architecture

```
Frontend (Next.js)
      |
      | REST API
      v
Express Backend (Node.js)
      |
      +-- Circle SDK
      |     +-- Developer-Controlled Wallets (key custody)
      |     +-- createTransaction (nanopayments + withdrawals)
      |     +-- CCTP cross-chain transfers
      |
      +-- node-cron (every 60s)
      |     +-- Fetches active streams from Supabase
      |     +-- Calculates USDC earned since last payout
      |     +-- Dispatches Circle transfer
      |     +-- Waits for Arc confirmation (<1s finality)
      |     +-- Updates stream.last_payout_at
      |
      +-- AI Agent Monitor (every 5min)
      |     +-- Polls work-activity signal per worker
      |     +-- Pauses stream if score < 0.25
      |     +-- Resumes stream if score >= 0.60
      |     +-- Logs decisions to agent_log table
      |
      +-- Supabase (wallets, streams, payouts, withdrawals)
```

---

## Circle Product Feedback

### Why we chose these products

**Circle Developer-Controlled Wallets** is the only correct choice for this use
case. PayStream needs to initiate USDC transfers on behalf of employers every 60
seconds without requiring manual signing. Developer-controlled wallets make
this server-side automation possible with proper key custody.

**Nanopayments** maps precisely to the sub-cent per-minute disbursements.
Without Nanopayments, high-frequency micro-transfers would have gas costs that
dwarf the transfer amounts on any other chain.

**Circle Gateway** gives workers a unified USDC balance across all supported
chains, which is critical so they can see one total balance and withdraw to
whichever chain they prefer, without manually bridging first.

**CCTP with Bridge Kit** handles cross-chain withdrawals. Workers in Nigeria or
the Philippines might prefer USDC on Polygon or Base — CCTP makes this a
single API call from the backend's perspective.

### What worked well

- The `createTransaction` API is clean and consistent regardless of whether
  it is a same-chain transfer or a CCTP cross-chain move.
- Arc testnet confirmation times are genuinely sub-second, which makes the
  live payout experience feel real and impressive in demos.
- The faucet is fast and frictionless for testnet USDC.

### What could be improved

- The Circle SDK TypeScript types could be more complete. Some response fields
  are `any` which requires extra defensive coding.
- A webhook endpoint for transaction state changes (CONFIRMED, FAILED) would
  eliminate the polling loop in `pollForConfirmation` and reduce API calls.
- A streaming endpoint (SSE or WebSocket) from the Circle API for real-time
  transaction updates would make the worker dashboard counter more precise.

### Recommendations

- A native Nanopayments SDK method (rather than `createTransaction` with tiny
  amounts) would make the intent clearer and could enable batched micropayment
  settlement for efficiency at scale.
- A "stream" primitive in the Circle API itself — deposit a float, define a
  rate, specify a recipient — would be an extremely powerful product for
  exactly this use case and would reduce the complexity of the backend
  significantly.

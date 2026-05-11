# PayStream

**Real-time USDC salary streaming on Arc. Built for the Stablecoin Commerce Stack Challenge — Track 1: Cross-Border Payments.**

> Workers earn by the second. Employers deposit once. Withdraw to any chain, any time, instantly.

---

## Project Structure

```
paystream/
├── frontend/
│   ├── index.html      Landing page (open in browser, no build needed)
│   └── app.html        Full dashboard app (worker, employer, history views)
│
├── backend/
│   ├── .env.example    Copy to .env and fill in your keys
│   ├── package.json
│   ├── README.md       Full API docs + Circle Product Feedback
│   └── src/
│       ├── index.js              Server entry point (Express + cron boot)
│       ├── config/
│       │   ├── circle.js         Circle SDK singleton
│       │   └── db.js             Supabase client + SQL schema
│       ├── routes/
│       │   └── index.js          All REST endpoints
│       ├── services/
│       │   ├── walletService.js      Circle wallet creation + balance
│       │   ├── streamService.js      Stream lifecycle (create/pause/resume/stop)
│       │   ├── withdrawalService.js  USDC withdrawals via CCTP
│       │   └── agentService.js       AI monitor (auto-pause/resume streams)
│       └── jobs/
│           └── payoutCron.js     Nanopayment cron — fires every 60 seconds
│
└── README.md           This file
```

---

## Quick Start

### Frontend (no build step needed)

Open `frontend/index.html` in any browser for the landing page.
Open `frontend/app.html` for the full dashboard demo.

Both files are self-contained with zero dependencies.

### Backend

```bash
cd backend
npm install
cp .env.example .env
# Fill in CIRCLE_API_KEY, CIRCLE_ENTITY_SECRET, SUPABASE_URL, SUPABASE_SERVICE_KEY
# Paste the SQL from src/config/db.js into your Supabase SQL editor
npm run dev
```

Server starts at `http://localhost:4000`. Health check: `GET /api/v1/health`

See `backend/README.md` for the full API reference and setup guide.

---

## Circle Tools Used

| Tool | Purpose |
|---|---|
| USDC on Arc | Primary settlement rail for all stream payouts |
| Circle Developer-Controlled Wallets | Key custody for employer and worker wallets |
| Nanopayments | Sub-cent per-minute USDC disbursements |
| Circle Gateway | Unified USDC balance across chains, <500ms |
| CCTP + Bridge Kit | Cross-chain withdrawals (Arc to ETH/Polygon/Base/etc) |

---

## Network

All transactions run on **Arc Testnet**.
Faucet: https://faucet.arc.testnet.circle.com
Explorer: https://explorer.arc.testnet.circle.com

# PayStream

> Real-time USDC salary streaming on Arc. Built for the Stablecoin Commerce Stack Challenge — Track 1: Cross-Border Payments.

![Arc Testnet](https://img.shields.io/badge/Network-Arc%20Testnet-F5A623?style=flat-square&logo=ethereum&logoColor=white)
![Circle USDC](https://img.shields.io/badge/Powered%20by-Circle%20USDC-2775CA?style=flat-square)
![Node.js](https://img.shields.io/badge/Node.js-v20+-339933?style=flat-square&logo=node.js&logoColor=white)
![License](https://img.shields.io/badge/License-MIT-green?style=flat-square)
![Status](https://img.shields.io/badge/Status-Live%20on%20Testnet-brightgreen?style=flat-square)

---

## The Problem

9 million expat workers in the UAE wait 30 to 60 days for money they have already earned. International transfers cost 3 to 8% in fees and take 3 to 5 business days. There is zero transparency about when funds will arrive.

## The Solution

PayStream replaces the monthly paycheck cycle with real-time USDC streaming. Employers deposit a float once. Workers earn by the second. They withdraw to any chain at any time — instantly, at near-zero cost.

---

## Circle Tools Used

| Tool | How PayStream uses it |
|---|---|
| **USDC on Arc** | Primary settlement rail for all stream payouts and withdrawals |
| **Circle Developer-Controlled Wallets** | Server-side key custody. Enables automated per-minute nanopayments without user signing. |
| **Nanopayments** | Sub-cent high-frequency USDC transfers dispatched every 60 seconds per stream. |
| **Circle Gateway** | Unified USDC balance across Arc, Ethereum, Polygon, Base in under 500ms. |
| **CCTP + Arc Bridge Kit** | Cross-chain withdrawals. Fast Transfer completes in 8 to 20 seconds. |

---

## Quick Start

```bash
git clone https://github.com/mimisco-git/Paystream.git
cd Paystream/backend
npm install
cp .env.example .env
# Fill in CIRCLE_API_KEY, CIRCLE_ENTITY_SECRET, SUPABASE_URL, SUPABASE_SERVICE_KEY
npm run dev
```

Health check: `curl http://localhost:4000/api/v1/health`

Open `frontend/index.html` for the landing page.
Open `frontend/app.html` for the full dashboard.

---

## Project Structure

```
paystream/
├── frontend/
│   ├── index.html          Landing page
│   └── app.html            Worker + employer + history dashboard
├── contracts/
│   ├── PayStream.sol       On-chain stream registry on Arc
│   └── scripts/deploy.js   Deployment script
├── backend/
│   ├── .env.example
│   └── src/
│       ├── index.js
│       ├── config/         Circle SDK + Supabase
│       ├── routes/         REST API + Circle webhooks
│       ├── jobs/           Nanopayment cron (every 60s)
│       └── services/       Wallets, streams, withdrawals, AI agent
└── architecture.html       Clickable submission diagram
```

---

## Network

| Property | Value |
|---|---|
| Network | Arc Testnet |
| Chain ID | 2816 |
| RPC | https://rpc.arc.testnet.circle.com |
| USDC | 0x3600000000000000000000000000000000000000 |
| Explorer | https://explorer.arc.testnet.circle.com |
| Faucet | https://faucet.arc.testnet.circle.com |

---

## Circle Product Feedback

**Why we chose these products:** Developer-Controlled Wallets is the only model that enables automated per-minute disbursements without user signing. Nanopayments makes sub-cent micro-transfers economically viable on Arc. Circle Gateway gives workers a unified balance across chains. CCTP makes cross-chain withdrawal a single API call.

**What worked well:** The createTransaction API is clean and consistent. Arc testnet finality is genuinely sub-second. The faucet is fast and frictionless.

**What could be improved:** A webhook signature verification helper in the SDK would reduce boilerplate. A dedicated Nanopayments method distinct from createTransaction would make intent explicit. The entity secret registration flow in the console could be more developer-friendly.

**Recommendation:** A native stream primitive in the Circle API — deposit a float, set a rate, specify a recipient — would be the ideal product for this use case and reduce backend complexity significantly.

---

Built for the Stablecoin Commerce Stack Challenge · Arc + Circle · 2026

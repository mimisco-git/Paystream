# PayStream

**Real-time USDC salary streaming on Arc testnet. Workers earn by the second.**

Built for the Stablecoin Commerce Stack Challenge (Ignyte / Circle / Arc) — Track 1: Best Cross-Border Payments and Remittances Experience.

---

## Live URLs

| Resource | URL |
|---|---|
| Frontend | https://paystream-virid.vercel.app |
| Backend API | https://paystream-9xtb.onrender.com |
| Health check | https://paystream-9xtb.onrender.com/api/v1/health |
| Architecture | https://paystream-virid.vercel.app/architecture.html |
| GitHub | https://github.com/mimisco-git/Paystream |

---

## What is PayStream

PayStream solves one of the UAE's most painful financial problems: the 1.5 million+ low-wage expat workers (construction, hospitality, domestic) who wait 30 days for salary, send money home through expensive remittance corridors, and have no financial identity.

PayStream pays workers by the second. Every 60 seconds, a real Circle USDC nanopayment confirms on Arc testnet. Workers withdraw to any external wallet via CCTP. The entire flow is accessible via email login — no MetaMask, no seed phrases.

---

## Circle Products Used

### USDC
Primary settlement currency for all salary streams and withdrawals. Every nanopayment is denominated in USDC. Workers earn USDC per second, employers hold USDC float.

### Circle Developer-Controlled Wallets
Every new user (worker or employer) gets a Circle developer-controlled wallet created automatically on signup. The wallet is invisible to the user — they just have a balance. No seed phrase, no gas management.

### Circle Gateway
Employer treasury management and unified balance display. The employer dashboard shows treasury float across chains via the Gateway unified balance view.

### CCTP with Bridge Kit
Workers withdraw USDC from Arc to Ethereum, Polygon, Base, Arbitrum, or Avalanche in 8 to 20 seconds. Real Circle attestation service, real burn-and-mint cycle.

### Nanopayments
The core product feature. A cron engine fires every 60 seconds and dispatches a real `createTransaction` call for each active stream. Sub-cent amounts, real Arc transaction hashes, visible on Arcscan.

---

## Architecture

```
Worker / Employer
      |
      | HTTPS
      v
Frontend (Vercel)
  - login.html    Email auth
  - app.html      Role-separated dashboard
  - architecture.html  This diagram
      |
      | REST API
      v
Backend (Render — Node.js / Express)
  - /api/v1/auth         Email signup, login, JWT
  - /api/v1/wallets      Circle wallet creation and balance
  - /api/v1/streams      Create, pause, resume, stop streams
  - /api/v1/payouts      Payout history with Arc tx hashes
  - /api/v1/withdrawals  Real Circle CCTP withdrawals
  - /api/v1/agent-log    AI agent activity
      |
      |--- Circle SDK -----> Arc Testnet (Chain ID: 5042002)
      |--- Supabase -------> PostgreSQL (wallets, streams, payouts, withdrawals)
      |--- Cron (60s) -----> createTransaction per active stream
      |--- Agent (5min) ---> Pause/resume streams based on activity score
```

---

## Project Structure

```
Paystream/
├── frontend/
│   ├── index.html          Landing page
│   ├── login.html          Email auth (signup and login)
│   ├── app.html            Dashboard (worker and employer views)
│   └── architecture.html   Technical architecture page
├── backend/
│   ├── src/
│   │   ├── index.js                 Express server, cron boot
│   │   ├── config/
│   │   │   ├── circle.js            Circle SDK singleton
│   │   │   └── db.js                Supabase client
│   │   ├── routes/
│   │   │   ├── index.js             REST endpoints
│   │   │   ├── auth.js              Email auth routes
│   │   │   └── webhooks.js          Circle webhook handler
│   │   ├── jobs/
│   │   │   └── payoutCron.js        Nanopayment engine every 60s
│   │   └── services/
│   │       ├── walletService.js     Circle wallet creation and balance
│   │       ├── streamService.js     Stream CRUD, pause, resume, stop
│   │       ├── withdrawalService.js Real Circle CCTP withdrawals
│   │       └── agentService.js      AI activity monitor
│   └── package.json
└── README.md
```

---

## Setup and Installation

### Prerequisites
- Node.js 18+
- Circle developer account at https://console.circle.com
- Supabase project

### Backend Setup

```bash
git clone https://github.com/mimisco-git/Paystream.git
cd Paystream/backend
npm install
```

Create `backend/.env`:

```
CIRCLE_API_KEY=your_circle_api_key
CIRCLE_ENTITY_SECRET=your_entity_secret_hex
ARC_RPC_URL=https://rpc.testnet.arc.network
ARC_CHAIN_ID=5042002
USDC_ARC_ADDRESS=0x3600000000000000000000000000000000000000
SUPABASE_URL=your_supabase_project_url
SUPABASE_SERVICE_KEY=your_supabase_service_role_key
JWT_SECRET=your_jwt_secret
PORT=4000
FRONTEND_URL=http://localhost:3000
BACKEND_URL=http://localhost:4000
```

Run the Supabase SQL schema (in `/backend/schema.sql` or run each table manually):

```bash
npm run dev
```

### Frontend Setup

The frontend is plain HTML with no build step. Open `frontend/index.html` directly or serve with any static server:

```bash
cd frontend
npx serve .
```

Update the `API` constant in `app.html` and `login.html` to point to your backend URL.

---

## Database Schema

Six tables in Supabase:

- `users` — email, password_hash, name, role
- `wallets` — user_id, circle_wallet_id, address, role
- `streams` — employer_id, worker_id, rate_per_hour, status, total_paid
- `payouts` — stream_id, amount_usdc, circle_tx_id, arc_tx_hash, status
- `withdrawals` — user_id, amount_usdc, destination_address, circle_tx_id, arc_tx_hash
- `agent_log` — stream_id, action, activity_score, reason

---

## API Endpoints

```
POST /api/v1/auth/signup          Create account + Circle wallet
POST /api/v1/auth/login           Login, get JWT
GET  /api/v1/auth/me              Get current user
GET  /api/v1/auth/user/:userId    Get user by ID (employer name lookup)

POST /api/v1/wallets              Create wallet for user
GET  /api/v1/wallets/:userId      Get wallet + live balance

POST /api/v1/streams              Create salary stream
GET  /api/v1/streams              List streams (by employer or worker)
GET  /api/v1/streams/:id/earned   Get earned amount since last payout
POST /api/v1/streams/:id/pause    Pause stream
POST /api/v1/streams/:id/resume   Resume stream
POST /api/v1/streams/:id/stop     Stop stream permanently

POST /api/v1/withdrawals          Real Circle CCTP withdrawal
GET  /api/v1/withdrawals/:userId  Withdrawal history

GET  /api/v1/payouts              Payout history with Arc tx hashes
GET  /api/v1/agent-log            AI agent activity log

GET  /api/v1/health               Health check
```

---

## Circle Product Feedback

### Why we chose these products

**USDC** was the only correct choice for UAE salary streaming. Expat workers need stability. Volatile tokens would undermine the entire value proposition. USDC on Arc gives dollar-denominated predictability.

**Developer-controlled wallets** are correct for this audience. A construction worker in Dubai will not manage a seed phrase. The wallet must be invisible — just an account with a balance. Circle's developer-controlled model handles this perfectly.

**Nanopayments** are PayStream's core differentiator. Traditional payroll is monthly. PayStream pays by the second. Only Circle's infrastructure makes sub-cent transactions economically viable.

**CCTP** was chosen because UAE workers need to off-ramp to networks where more exchanges and DeFi options exist. Arc-only USDC would limit real-world utility.

**Gateway** provides the unified balance view that makes the employer treasury dashboard coherent. Seeing USDC across chains as one number is exactly what a payroll manager needs.

### What worked well

- Developer-controlled wallets have an excellent API. One call creates a wallet. The mental model is clean.
- Arc testnet USDC contract address is predictable. No ABI lookup needed.
- `createTransaction` is reliable. The polling pattern for confirmation works.
- Arc testnet faucet is fast. USDC arrives within seconds — critical during hackathon development.
- Arcscan is developer-friendly and easy to share with judges.
- The SDK handles idempotency keys correctly. Re-running the cron does not duplicate payments.

### What could be improved

- The SDK response format is inconsistent between `createWalletSet` and `createWallets`. The wallet set ID is nested differently. This caused multiple debugging sessions.
- The entity secret registration flow is not documented clearly for new accounts. A setup wizard in the Circle console would save hours.
- CCTP cross-chain status is difficult to poll reliably. A webhook on attestation confirmation would be cleaner than a polling loop.
- StableFX and USYC require enterprise approval. A hackathon sandbox mode with simulated responses would let builders design around these products without waiting.
- A webhook for transaction confirmation would replace the polling pattern and reduce API call volume significantly.

### Recommendations

- A native streaming payments primitive in the SDK (`createStream` with rate and recipient) would make products like PayStream far easier to build correctly.
- A developer console that shows live wallet balances and transaction history — similar to Stripe's dashboard — would reduce the need for custom admin tooling.
- An official Arc testnet block explorer API would help builders construct richer history views without scraping Arcscan HTML.

---

## Demo Accounts

For testing the live site:

| Role | Email | Password |
|---|---|---|
| Worker | ahmad@paystream.test | password123 |
| Employer | employer@paystream.test | password123 |

---

## Hackathon Details

- **Challenge:** Stablecoin Commerce Stack Challenge
- **Organizer:** Ignyte
- **Technical sponsors:** Circle, Arc
- **Track:** Track 1 — Best Cross-Border Payments and Remittances Experience (UAE)
- **Prize pool:** 5000 USDC (1st place) + 3000 USDC (2nd place)
- **Deadline:** July 13 2026

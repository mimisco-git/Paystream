// src/config/db.js
// -------------------------------------------------------
// Supabase client.  Run the SQL below once in your
// Supabase SQL editor to create the required tables.
// -------------------------------------------------------
import { createClient } from '@supabase/supabase-js'
import dotenv from 'dotenv'
dotenv.config()

export const db = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY,
)

/*
===== PASTE THIS INTO SUPABASE SQL EDITOR =====

-- Wallet registry: one Circle wallet per user
create table wallets (
  id            uuid primary key default gen_random_uuid(),
  user_id       text unique not null,
  role          text not null check (role in ('employer','worker')),
  circle_wallet_id  text unique not null,
  address       text unique not null,
  wallet_set_id text not null,
  created_at    timestamptz default now()
);

-- Stream registry: one active stream per worker
create table streams (
  id              uuid primary key default gen_random_uuid(),
  employer_id     text not null,
  worker_id       text not null,
  employer_wallet text not null,   -- Circle wallet id
  worker_wallet   text not null,   -- Circle wallet id
  rate_per_hour   numeric(20,6) not null,  -- USDC, e.g. 18.500000
  status          text not null default 'active'
                    check (status in ('active','paused','stopped')),
  started_at      timestamptz default now(),
  last_payout_at  timestamptz default now(),
  total_paid      numeric(20,6) default 0,
  created_at      timestamptz default now()
);

-- Payout log: every nanopayment dispatched
create table payouts (
  id              uuid primary key default gen_random_uuid(),
  stream_id       uuid references streams(id),
  amount_usdc     numeric(20,6) not null,
  circle_tx_id    text,
  arc_tx_hash     text,
  status          text default 'pending'
                    check (status in ('pending','confirmed','failed')),
  created_at      timestamptz default now()
);

-- Withdrawal log: worker-initiated withdrawals
create table withdrawals (
  id              uuid primary key default gen_random_uuid(),
  worker_id       text not null,
  wallet_id       text not null,
  amount_usdc     numeric(20,6) not null,
  destination_chain text not null,
  destination_address text,
  circle_tx_id    text,
  arc_tx_hash     text,
  status          text default 'pending'
                    check (status in ('pending','processing','confirmed','failed')),
  settlement_ms   integer,
  created_at      timestamptz default now()
);

-- Indexes for cron job performance
create index streams_active   on streams(status) where status = 'active';
create index payouts_stream   on payouts(stream_id);
create index payouts_pending  on payouts(status) where status = 'pending';

================================================
*/

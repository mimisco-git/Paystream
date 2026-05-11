// src/services/walletService.js
// -------------------------------------------------------
// Manages Circle developer-controlled wallets for every
// employer and worker on PayStream.
//
// Circle developer-controlled wallets are the right model
// here because PayStream needs to initiate transactions
// (nanopayments) on behalf of employers without requiring
// them to sign every 60-second micro-transfer manually.
// -------------------------------------------------------
import { circleClient, ARC_BLOCKCHAIN } from '../config/circle.js'
import { db }                           from '../config/db.js'
import { v4 as uuid }                   from 'uuid'

// -------------------------------------------------------
// createWalletForUser
// Creates a Circle wallet set + one SCA wallet on Arc.
// Idempotent: returns existing wallet if userId already has one.
// -------------------------------------------------------
export async function createWalletForUser(userId, role) {
  // Check if wallet already exists
  const { data: existing } = await db
    .from('wallets')
    .select('*')
    .eq('user_id', userId)
    .single()

  if (existing) return existing

  const idempotencyKey = uuid()

  // Step 1: Create a wallet set (logical grouping)
  const setRes = await circleClient.createWalletSet({
    idempotencyKey,
    name: `paystream-${role}-${userId}`,
  })
  const walletSetId = setRes.data?.walletSet?.id
  if (!walletSetId) throw new Error('Failed to create Circle wallet set')

  // Step 2: Create one SCA wallet inside the set on Arc testnet
  const walletRes = await circleClient.createWallets({
    idempotencyKey: uuid(),
    blockchains:    [ARC_BLOCKCHAIN],
    count:          1,
    walletSetId,
  })
  const wallet = walletRes.data?.wallets?.[0]
  if (!wallet) throw new Error('Failed to create Circle wallet on Arc')

  // Step 3: Persist to Supabase
  const record = {
    user_id:          userId,
    role,
    circle_wallet_id: wallet.id,
    address:          wallet.address,
    wallet_set_id:    walletSetId,
  }
  const { data, error } = await db.from('wallets').insert(record).select().single()
  if (error) throw new Error('DB insert failed: ' + error.message)

  console.log(`[Wallet] Created ${role} wallet for ${userId}: ${wallet.address}`)
  return data
}

// -------------------------------------------------------
// getWalletBalance
// Returns USDC balance for a Circle wallet on Arc.
// -------------------------------------------------------
export async function getWalletBalance(circleWalletId) {
  const res = await circleClient.getWalletTokenBalance({
    id: circleWalletId,
  })
  const balances = res.data?.tokenBalances ?? []
  const usdc = balances.find(b => b.token?.symbol === 'USDC')
  return usdc ? parseFloat(usdc.amount) : 0
}

// -------------------------------------------------------
// getWalletByUserId
// Fetches wallet record from Supabase for a given userId.
// -------------------------------------------------------
export async function getWalletByUserId(userId) {
  const { data, error } = await db
    .from('wallets')
    .select('*')
    .eq('user_id', userId)
    .single()

  if (error) throw new Error('Wallet not found for user: ' + userId)
  return data
}

// -------------------------------------------------------
// listWallets
// Returns all wallets, filtered by role.
// -------------------------------------------------------
export async function listWallets(role) {
  const query = db.from('wallets').select('*')
  if (role) query.eq('role', role)
  const { data, error } = await query
  if (error) throw new Error(error.message)
  return data
}

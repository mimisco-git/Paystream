// src/services/walletService.js
import { circleClient, ARC_BLOCKCHAIN } from '../config/circle.js'
import { db }                           from '../config/db.js'
import { v4 as uuid }                   from 'uuid'

export async function createWalletForUser(userId, role) {
  // Idempotent: return existing wallet if already created
  const { data: existing } = await db
    .from('wallets')
    .select('*')
    .eq('user_id', userId)
    .single()

  if (existing) return existing

  // Step 1: Create wallet set
  // Circle SDK v3 returns { id, ... } directly at res.data (not nested under .walletSet)
  const setRes = await circleClient.createWalletSet({
    idempotencyKey: uuid(),
    name: `ps-${role}-${userId.slice(0,8)}`,
  })

  // Handle both response formats from different SDK versions
  const walletSetId = setRes.data?.walletSet?.id || setRes.data?.id
  if (!walletSetId) {
    console.error('[Wallet] createWalletSet response:', JSON.stringify(setRes.data))
    throw new Error('Failed to create Circle wallet set — no id returned')
  }

  // Step 2: Create wallet on Arc testnet
  const walletRes = await circleClient.createWallets({
    idempotencyKey: uuid(),
    blockchains:    [ARC_BLOCKCHAIN],
    count:          1,
    walletSetId,
  })

  // Handle both response formats
  const wallet = walletRes.data?.wallets?.[0] || walletRes.data?.[0]
  if (!wallet) {
    console.error('[Wallet] createWallets response:', JSON.stringify(walletRes.data))
    throw new Error('Failed to create Circle wallet on Arc — no wallet returned')
  }

  // Step 3: Persist to Supabase
  const record = {
    user_id:          userId,
    role,
    circle_wallet_id: wallet.id,
    address:          wallet.address,
    wallet_set_id:    walletSetId,
  }

  const { data, error } = await db
    .from('wallets')
    .insert(record)
    .select()
    .single()

  if (error) throw new Error('DB insert failed: ' + error.message)

  console.log(`[Wallet] Created ${role} wallet for ${userId}: ${wallet.address}`)
  return data
}

export async function getWalletBalance(circleWalletId) {
  const res      = await circleClient.getWalletTokenBalance({ id: circleWalletId })
  const balances = res.data?.tokenBalances ?? []
  const usdc     = balances.find(b => b.token?.symbol === 'USDC')
  return usdc ? parseFloat(usdc.amount) : 0
}

export async function getWalletAddress(circleWalletId) {
  const { data, error } = await db
    .from('wallets')
    .select('address')
    .eq('circle_wallet_id', circleWalletId)
    .single()
  if (error || !data) throw new Error('Could not resolve wallet address: ' + circleWalletId)
  return data.address
}

export async function getWalletByUserId(userId) {
  const { data, error } = await db
    .from('wallets')
    .select('*')
    .eq('user_id', userId)
    .single()
  if (error) throw new Error('Wallet not found for user: ' + userId)
  return data
}

export async function listWallets(role) {
  const query = db.from('wallets').select('*')
  if (role) query.eq('role', role)
  const { data, error } = await query
  if (error) throw new Error(error.message)
  return data
}

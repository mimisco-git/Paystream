// src/services/withdrawalService.js
// -------------------------------------------------------
// Handles worker-initiated withdrawals.
//
// Same-chain (Arc to Arc): standard Circle transfer.
// Cross-chain (Arc to Ethereum/Polygon/etc): Circle's
// Cross-Chain Transfer Protocol (CCTP) via Bridge Kit.
//
// Circle Gateway gives the worker a unified USDC balance
// across all supported chains — they simply pick where
// to receive it at withdrawal time.
// -------------------------------------------------------
import { v4 as uuid }     from 'uuid'
import { circleClient, ARC_BLOCKCHAIN, USDC_ARC } from '../config/circle.js'
import { db }             from '../config/db.js'
import { getWalletByUserId, getWalletBalance } from './walletService.js'

// Chain identifiers used by Circle API
const CIRCLE_CHAIN_MAP = {
  'arc':       'ARC-TESTNET',
  'ethereum':  'ETH-SEPOLIA',
  'polygon':   'MATIC-AMOY',
  'base':      'BASE-SEPOLIA',
  'arbitrum':  'ARB-SEPOLIA',
  'avalanche': 'AVAX-FUJI',
}

// -------------------------------------------------------
// initiateWithdrawal
// Worker calls this to move USDC to their preferred chain.
// -------------------------------------------------------
export async function initiateWithdrawal({
  workerId,
  amountUsdc,
  destinationChain,          // 'arc' | 'ethereum' | 'polygon' | ...
  destinationAddress = null, // if null, send to same Circle wallet on dest chain
}) {
  // Input validation
  const chainKey = destinationChain.toLowerCase()
  const circleChain = CIRCLE_CHAIN_MAP[chainKey]
  if (!circleChain) {
    throw new Error(`Unsupported destination chain: ${destinationChain}`)
  }

  // Resolve worker wallet
  const workerWallet = await getWalletByUserId(workerId)

  // Check balance
  const balance = await getWalletBalance(workerWallet.circle_wallet_id)
  if (balance < amountUsdc) {
    throw new Error(
      `Insufficient balance. Requested: $${amountUsdc} USDC, available: $${balance.toFixed(6)} USDC`
    )
  }

  // Create withdrawal record
  const { data: withdrawal, error: dbErr } = await db
    .from('withdrawals')
    .insert({
      worker_id:           workerId,
      wallet_id:           workerWallet.circle_wallet_id,
      amount_usdc:         amountUsdc,
      destination_chain:   destinationChain,
      destination_address: destinationAddress,
      status:              'processing',
    })
    .select()
    .single()

  if (dbErr) throw new Error('DB error: ' + dbErr.message)

  // Dispatch async — respond immediately with withdrawal id
  processWithdrawal({ withdrawal, workerWallet, circleChain, destinationAddress })
    .catch(err => {
      console.error(`[Withdrawal] Async processing failed for ${withdrawal.id}:`, err.message)
      db.from('withdrawals').update({ status: 'failed' }).eq('id', withdrawal.id)
    })

  return {
    withdrawalId: withdrawal.id,
    status:       'processing',
    message:      'Withdrawal initiated. Funds will arrive shortly.',
  }
}

// -------------------------------------------------------
// processWithdrawal
// Runs async after the API has already responded.
// -------------------------------------------------------
async function processWithdrawal({
  withdrawal,
  workerWallet,
  circleChain,
  destinationAddress,
}) {
  const t0 = Date.now()
  const amountStr = parseFloat(withdrawal.amount_usdc).toFixed(6)
  const isSameChain = circleChain === ARC_BLOCKCHAIN

  try {
    let circleTx

    if (isSameChain) {
      // Same-chain: direct Circle transfer on Arc
      if (!destinationAddress) {
        throw new Error('Destination address required for same-chain withdrawal')
      }
      const res = await circleClient.createTransaction({
        idempotencyKey:     uuid(),
        walletId:           workerWallet.circle_wallet_id,
        blockchain:         ARC_BLOCKCHAIN,
        tokenAddress:       USDC_ARC,
        destinationAddress,
        amounts:            [amountStr],
        fee: { type: 'level', config: { feeLevel: 'MEDIUM' } },
      })
      circleTx = res.data?.transaction

    } else {
      // Cross-chain: Circle Gateway / CCTP Fast Transfer
      // The worker's Circle wallet holds a unified balance;
      // Circle handles the CCTP burn-and-mint automatically.
      const res = await circleClient.createTransaction({
        idempotencyKey:     uuid(),
        walletId:           workerWallet.circle_wallet_id,
        blockchain:         ARC_BLOCKCHAIN,       // source
        destinationBlockchain: circleChain,        // destination
        tokenAddress:       USDC_ARC,
        destinationAddress: destinationAddress || workerWallet.address,
        amounts:            [amountStr],
        fee: { type: 'level', config: { feeLevel: 'HIGH' } }, // fast transfer
      })
      circleTx = res.data?.transaction
    }

    if (!circleTx?.id) throw new Error('No transaction returned from Circle')

    // Poll for confirmation
    const confirmed = await pollForConfirmation(circleTx.id)
    const elapsed   = Date.now() - t0

    await db
      .from('withdrawals')
      .update({
        status:         'confirmed',
        circle_tx_id:   circleTx.id,
        arc_tx_hash:    confirmed.txHash,
        settlement_ms:  elapsed,
      })
      .eq('id', withdrawal.id)

    console.log(
      `[Withdrawal] Confirmed: $${amountStr} USDC → ${circleChain} `
      + `| ${elapsed}ms | tx: ${confirmed.txHash}`
    )

  } catch (err) {
    await db
      .from('withdrawals')
      .update({ status: 'failed' })
      .eq('id', withdrawal.id)
    throw err
  }
}

// -------------------------------------------------------
// getWithdrawal / listWithdrawals
// -------------------------------------------------------
export async function getWithdrawal(withdrawalId) {
  const { data, error } = await db
    .from('withdrawals')
    .select('*')
    .eq('id', withdrawalId)
    .single()
  if (error) throw new Error('Withdrawal not found')
  return data
}

export async function listWithdrawals(workerId) {
  const { data, error } = await db
    .from('withdrawals')
    .select('*')
    .eq('worker_id', workerId)
    .order('created_at', { ascending: false })
  if (error) throw new Error(error.message)
  return data
}

// -------------------------------------------------------
// Helpers
// -------------------------------------------------------
async function pollForConfirmation(circleTxId, maxWaitMs = 30000) {
  const start = Date.now()
  while (Date.now() - start < maxWaitMs) {
    const res = await circleClient.getTransaction({ id: circleTxId })
    const tx  = res.data?.transaction
    if (tx?.state === 'CONFIRMED') return tx
    if (tx?.state === 'FAILED')    throw new Error('Transaction failed: ' + circleTxId)
    await new Promise(r => setTimeout(r, 600))
  }
  throw new Error('Transaction confirmation timed out')
}

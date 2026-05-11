// src/jobs/payoutCron.js
// -------------------------------------------------------
// THE HEART OF PAYSTREAM.
//
// Runs every 60 seconds. For every active stream it:
//   1. Calculates USDC earned since last payout
//   2. Checks employer has enough float
//   3. Dispatches a Circle transfer (nanopayment)
//   4. Confirms on Arc testnet via viem
//   5. Updates stream.last_payout_at + stream.total_paid
//   6. Logs the payout to the payouts table
//
// This is what replaces the 30-day paycheck cycle with
// per-minute settlement at near-zero cost on Arc.
// -------------------------------------------------------
import cron              from 'node-cron'
import { createPublicClient, http } from 'viem'
import { v4 as uuid }    from 'uuid'
import { circleClient, ARC_BLOCKCHAIN, USDC_ARC } from '../config/circle.js'
import { db }            from '../config/db.js'
import { getEarnedSince } from '../services/streamService.js'
import { getWalletBalance } from '../services/walletService.js'

// Arc testnet public client for tx confirmation
const arcPublicClient = createPublicClient({
  transport: http(process.env.ARC_RPC_URL || 'https://rpc.arc.testnet.circle.com'),
})

// Minimum amount to dispatch (avoids dust transactions)
const MIN_PAYOUT_USDC = 0.000001

// -------------------------------------------------------
// dispatchNanopayment
// Sends USDC from employer wallet to worker wallet.
// Returns the Circle transaction id.
// -------------------------------------------------------
async function dispatchNanopayment({ stream, amountUsdc }) {
  const amountStr = amountUsdc.toFixed(6)

  const res = await circleClient.createTransaction({
    idempotencyKey:  uuid(),
    walletId:        stream.employer_wallet,
    blockchain:      ARC_BLOCKCHAIN,
    tokenAddress:    USDC_ARC,
    destinationAddress: await getWorkerAddress(stream.worker_wallet),
    amounts:         [amountStr],
    fee: {
      type:   'level',
      config: { feeLevel: 'LOW' },  // Arc fees are dollar-denominated and tiny
    },
  })

  const tx = res.data?.transaction
  if (!tx?.id) throw new Error('Circle createTransaction returned no tx id')
  return tx
}

// -------------------------------------------------------
// confirmOnChain
// Polls Circle API until the transaction confirms on Arc.
// Arc has deterministic finality so this is fast (<1s).
// -------------------------------------------------------
async function confirmOnChain(circleTxId, maxWaitMs = 15000) {
  const start = Date.now()
  while (Date.now() - start < maxWaitMs) {
    const res = await circleClient.getTransaction({ id: circleTxId })
    const tx  = res.data?.transaction
    if (tx?.state === 'CONFIRMED') return tx
    if (tx?.state === 'FAILED')    throw new Error('Transaction failed on chain')
    await sleep(500)
  }
  throw new Error(`Transaction not confirmed within ${maxWaitMs}ms`)
}

// -------------------------------------------------------
// processStream
// Full payout cycle for a single active stream.
// -------------------------------------------------------
async function processStream(stream) {
  const earned = getEarnedSince(stream)

  if (earned < MIN_PAYOUT_USDC) {
    // Too small to bother — skip this tick
    return { skipped: true, reason: 'below_minimum', earned }
  }

  // Check employer float before sending
  const float = await getWalletBalance(stream.employer_wallet)
  if (float < earned) {
    console.warn(
      `[Cron] Employer float insufficient for stream ${stream.id}. `
      + `Need: $${earned}, have: $${float}. Pausing stream.`
    )
    await db.from('streams').update({ status: 'paused' }).eq('id', stream.id)
    return { skipped: true, reason: 'insufficient_float', float, earned }
  }

  // Create payout record (pending)
  const { data: payoutRecord } = await db
    .from('payouts')
    .insert({
      stream_id:   stream.id,
      amount_usdc: earned,
      status:      'pending',
    })
    .select()
    .single()

  try {
    // Dispatch nanopayment via Circle
    const circleTx = await dispatchNanopayment({ stream, amountUsdc: earned })
    console.log(`[Cron] Nanopayment dispatched: $${earned} USDC | tx: ${circleTx.id}`)

    // Wait for Arc confirmation (sub-second finality)
    const confirmedTx = await confirmOnChain(circleTx.id)
    const arcHash     = confirmedTx.txHash

    // Update payout record to confirmed
    await db
      .from('payouts')
      .update({
        circle_tx_id: circleTx.id,
        arc_tx_hash:  arcHash,
        status:       'confirmed',
      })
      .eq('id', payoutRecord.id)

    // Advance stream clock and accumulate total_paid
    await db
      .from('streams')
      .update({
        last_payout_at: new Date().toISOString(),
        total_paid:     parseFloat(stream.total_paid) + earned,
      })
      .eq('id', stream.id)

    console.log(`[Cron] Confirmed on Arc: ${arcHash} | stream ${stream.id} | +$${earned} USDC`)
    return { success: true, earned, arcHash, circleTxId: circleTx.id }

  } catch (err) {
    // Mark payout as failed, do not advance clock (will retry next tick)
    await db
      .from('payouts')
      .update({ status: 'failed' })
      .eq('id', payoutRecord.id)

    console.error(`[Cron] Payout failed for stream ${stream.id}:`, err.message)
    return { success: false, error: err.message }
  }
}

// -------------------------------------------------------
// payoutCronTick
// Fetches all active streams and processes them in parallel.
// -------------------------------------------------------
async function payoutCronTick() {
  const { data: activeStreams, error } = await db
    .from('streams')
    .select('*')
    .eq('status', 'active')

  if (error) {
    console.error('[Cron] Failed to fetch active streams:', error.message)
    return
  }

  if (!activeStreams?.length) return

  console.log(`[Cron] Tick — processing ${activeStreams.length} active stream(s)`)

  const results = await Promise.allSettled(
    activeStreams.map(s => processStream(s))
  )

  const succeeded = results.filter(r => r.status === 'fulfilled' && r.value?.success).length
  const skipped   = results.filter(r => r.status === 'fulfilled' && r.value?.skipped).length
  const failed    = results.filter(r => r.status === 'rejected').length

  console.log(
    `[Cron] Done — success: ${succeeded}, skipped: ${skipped}, failed: ${failed}`
  )
}

// -------------------------------------------------------
// startPayoutCron
// Called once on server startup.
// Runs every 60 seconds: "*/60 * * * * *"
// -------------------------------------------------------
export function startPayoutCron() {
  console.log('[Cron] Nanopayment cron started — tick every 60s')
  cron.schedule('*/60 * * * * *', payoutCronTick)
  // Run once immediately on startup so first payout is not delayed
  payoutCronTick()
}

// -------------------------------------------------------
// Helpers
// -------------------------------------------------------
async function getWorkerAddress(workerWalletId) {
  const res  = await circleClient.getWallet({ id: workerWalletId })
  const addr = res.data?.wallet?.address
  if (!addr) throw new Error('Could not resolve worker wallet address')
  return addr
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms))
}

// src/jobs/payoutCron.js
import cron             from 'node-cron'
import { v4 as uuid }   from 'uuid'
import { circleClient, ARC_BLOCKCHAIN, USDC_ARC } from '../config/circle.js'
import { db }           from '../config/db.js'
import { getEarnedSince } from '../services/streamService.js'
import { getWalletBalance } from '../services/walletService.js'

const MIN_PAYOUT_USDC = 0.000001

async function getWorkerAddress(workerWalletId) {
  const { data, error } = await db
    .from('wallets')
    .select('address')
    .eq('circle_wallet_id', workerWalletId)
    .single()
  if (error || !data?.address) {
    throw new Error('Could not resolve worker wallet address for: ' + workerWalletId)
  }
  return data.address
}

async function dispatchNanopayment({ stream, amountUsdc }) {
  const amountStr          = amountUsdc.toFixed(6)
  const destinationAddress = await getWorkerAddress(stream.worker_wallet)

  const res = await circleClient.createTransaction({
    idempotencyKey: uuid(),
    walletId:       stream.employer_wallet,
    blockchain:     ARC_BLOCKCHAIN,
    tokenAddress:   USDC_ARC,
    destinationAddress,
    amounts:        [amountStr],
    fee: { type: 'level', config: { feeLevel: 'LOW' } },
  })

  // createTransaction returns { id, state } at res.data directly
  const txId = res.data?.id
  if (!txId) throw new Error('Circle createTransaction returned no tx id')
  return { id: txId, state: res.data?.state }
}

async function confirmOnChain(circleTxId, maxWaitMs = 30000) {
  const start = Date.now()
  while (Date.now() - start < maxWaitMs) {
    const res = await circleClient.getTransaction({ id: circleTxId })

    // getTransaction returns { transaction: { id, state, txHash, ... } } at res.data
    const tx = res.data?.transaction
    if (!tx) { await sleep(800); continue }

    // Circle uses COMPLETE (not CONFIRMED) for successful transactions
    if (tx.state === 'COMPLETE' || tx.state === 'CONFIRMED') return tx
    if (tx.state === 'FAILED')    throw new Error('Transaction failed on chain')
    await sleep(800)
  }
  throw new Error(`Transaction not confirmed within ${maxWaitMs}ms`)
}

async function processStream(stream) {
  const earned = getEarnedSince(stream)

  if (earned < MIN_PAYOUT_USDC) {
    return { skipped: true, reason: 'below_minimum', earned }
  }

  const float = await getWalletBalance(stream.employer_wallet)
  if (float < earned) {
    console.warn(`[Cron] Float insufficient for stream ${stream.id}. Need: $${earned}, have: $${float}. Pausing.`)
    await db.from('streams').update({ status: 'paused' }).eq('id', stream.id)
    return { skipped: true, reason: 'insufficient_float' }
  }

  const { data: payoutRecord } = await db
    .from('payouts')
    .insert({ stream_id: stream.id, amount_usdc: earned, status: 'pending' })
    .select()
    .single()

  try {
    const circleTx = await dispatchNanopayment({ stream, amountUsdc: earned })
    console.log(`[Cron] Nanopayment dispatched: $${earned} USDC | circle tx: ${circleTx.id}`)

    const confirmedTx = await confirmOnChain(circleTx.id)
    const arcHash     = confirmedTx.txHash || null

    await db
      .from('payouts')
      .update({ circle_tx_id: circleTx.id, arc_tx_hash: arcHash, status: 'confirmed' })
      .eq('id', payoutRecord.id)

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
    await db.from('payouts').update({ status: 'failed' }).eq('id', payoutRecord.id)
    console.error(`[Cron] Payout failed for stream ${stream.id}:`, err.message)
    return { success: false, error: err.message }
  }
}

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

  const results = await Promise.allSettled(activeStreams.map(s => processStream(s)))

  const succeeded = results.filter(r => r.status === 'fulfilled' && r.value?.success).length
  const skipped   = results.filter(r => r.status === 'fulfilled' && r.value?.skipped).length
  const failed    = results.filter(r => r.status === 'rejected').length

  console.log(`[Cron] Done — success: ${succeeded}, skipped: ${skipped}, failed: ${failed}`)
}

export function startPayoutCron() {
  console.log('[Cron] Nanopayment cron started — tick every 60s')
  cron.schedule('*/60 * * * * *', payoutCronTick)
  payoutCronTick()
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms))
}

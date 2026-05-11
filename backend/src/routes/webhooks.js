// src/routes/webhooks.js
// -------------------------------------------------------
// Circle webhook handler.
//
// Instead of polling the Circle API every 500ms waiting
// for CONFIRMED status, Circle pushes events to this
// endpoint the moment a transaction confirms on Arc.
//
// This is production-grade integration vs hackathon polling.
// Register this URL in Circle Console under Notifications.
//
// Endpoint: POST /webhooks/circle
// -------------------------------------------------------
import { Router } from 'express'
import crypto     from 'crypto'
import { db }     from '../config/db.js'

const router = Router()

// -------------------------------------------------------
// Verify Circle webhook signature
// Circle signs every webhook with HMAC-SHA256 using your
// notification secret from the Circle Console.
// -------------------------------------------------------
function verifySignature(req) {
  const secret    = process.env.CIRCLE_NOTIFICATION_SECRET
  if (!secret) return true // skip verification in dev if not set

  const signature = req.headers['x-circle-signature']
  if (!signature) return false

  const hmac     = crypto.createHmac('sha256', secret)
  const digest   = hmac.update(JSON.stringify(req.body)).digest('hex')
  return crypto.timingSafeEqual(
    Buffer.from(signature),
    Buffer.from(digest)
  )
}

// -------------------------------------------------------
// POST /webhooks/circle
// Receives all Circle transaction events.
// -------------------------------------------------------
router.post('/circle', async (req, res) => {
  // Always respond 200 fast — Circle retries if you timeout
  res.status(200).json({ received: true })

  if (!verifySignature(req)) {
    console.warn('[Webhook] Invalid signature — ignoring')
    return
  }

  const { Type: type, Data: data } = req.body ?? {}
  if (!type || !data) return

  console.log(`[Webhook] Received: ${type}`)

  try {
    switch (type) {

      // Transaction confirmed on Arc
      case 'transactions.outbound': {
        const tx = data.transaction
        if (!tx?.id) break

        if (tx.state === 'CONFIRMED') {
          await handleTransactionConfirmed(tx)
        } else if (tx.state === 'FAILED') {
          await handleTransactionFailed(tx)
        }
        break
      }

      default:
        // Ignore other event types
        break
    }
  } catch (err) {
    console.error('[Webhook] Handler error:', err.message)
  }
})

// -------------------------------------------------------
// handleTransactionConfirmed
// Updates payouts and withdrawals tables when Circle
// confirms a transaction on Arc testnet.
// -------------------------------------------------------
async function handleTransactionConfirmed(tx) {
  const circleTxId = tx.id
  const arcHash    = tx.txHash
  const settledMs  = tx.updateDate
    ? new Date(tx.updateDate) - new Date(tx.createDate)
    : null

  // Update payout if this was a nanopayment
  const { data: payout } = await db
    .from('payouts')
    .select('id, stream_id')
    .eq('circle_tx_id', circleTxId)
    .single()

  if (payout) {
    await db
      .from('payouts')
      .update({ status: 'confirmed', arc_tx_hash: arcHash })
      .eq('id', payout.id)

    // Advance stream clock
    await db
      .from('streams')
      .update({ last_payout_at: new Date().toISOString() })
      .eq('id', payout.stream_id)

    console.log(`[Webhook] Payout confirmed: ${circleTxId} | arc: ${arcHash}`)
    return
  }

  // Update withdrawal if this was a withdrawal
  const { data: withdrawal } = await db
    .from('withdrawals')
    .select('id')
    .eq('circle_tx_id', circleTxId)
    .single()

  if (withdrawal) {
    await db
      .from('withdrawals')
      .update({
        status:        'confirmed',
        arc_tx_hash:   arcHash,
        settlement_ms: settledMs,
      })
      .eq('id', withdrawal.id)

    console.log(`[Webhook] Withdrawal confirmed: ${circleTxId} | arc: ${arcHash}`)
  }
}

// -------------------------------------------------------
// handleTransactionFailed
// -------------------------------------------------------
async function handleTransactionFailed(tx) {
  const circleTxId = tx.id

  await db
    .from('payouts')
    .update({ status: 'failed' })
    .eq('circle_tx_id', circleTxId)

  await db
    .from('withdrawals')
    .update({ status: 'failed' })
    .eq('circle_tx_id', circleTxId)

  console.warn(`[Webhook] Transaction failed: ${circleTxId}`)
}

export default router

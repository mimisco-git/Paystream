// src/routes/index.js
import { Router }    from 'express'
import { z }         from 'zod'
import {
  createWalletForUser,
  getWalletByUserId,
  getWalletBalance,
  listWallets,
} from '../services/walletService.js'
import {
  createStream,
  pauseStream,
  resumeStream,
  stopStream,
  getStreamById,
  listStreams,
  getEarnedSince,
} from '../services/streamService.js'
import { getAgentLog } from '../services/agentService.js'
import { db }          from '../config/db.js'

const router = Router()

const ok  = (res, data)       => res.json({ success: true, data })
const err = (res, msg, code=400) => res.status(code).json({ success: false, error: msg })
const wrap = fn => async (req, res) => {
  try { await fn(req, res) }
  catch (e) {
    console.error('[Route]', e.message)
    err(res, e.message)
  }
}

// ── HEALTH ──
router.get('/health', (_req, res) => {
  res.json({
    status:    'ok',
    service:   'paystream-backend',
    network:   'ARC-TESTNET',
    timestamp: new Date().toISOString(),
  })
})

// ── WALLETS ──
// POST /api/v1/wallets
router.post('/wallets', wrap(async (req, res) => {
  const { userId, role } = z.object({
    userId: z.string().min(1),
    role:   z.enum(['employer', 'worker']).default('worker'),
  }).parse(req.body)

  const wallet = await createWalletForUser(userId, role)
  const balance = await getWalletBalance(wallet.circle_wallet_id)
  ok(res, { ...wallet, balance_usdc: balance })
}))

// GET /api/v1/wallets/:userId
router.get('/wallets/:userId', wrap(async (req, res) => {
  const wallet  = await getWalletByUserId(req.params.userId)
  const balance = await getWalletBalance(wallet.circle_wallet_id)
  ok(res, { ...wallet, balance_usdc: balance })
}))

// ── STREAMS ──
// POST /api/v1/streams
// Accepts either workerId (user UUID) or workerAddress (0x wallet address)
router.post('/streams', wrap(async (req, res) => {
  const { employerId, workerId, workerAddress, ratePerHour } = z.object({
    employerId:    z.string().min(1),
    workerId:      z.string().optional(),
    workerAddress: z.string().optional(),
    ratePerHour:   z.number().positive(),
  }).parse(req.body)

  let resolvedWorkerId = workerId

  // If workerAddress provided, look up worker by wallet address
  if (!resolvedWorkerId && workerAddress) {
    const { data, error } = await db
      .from('wallets')
      .select('user_id')
      .eq('address', workerAddress.toLowerCase())
      .single()

    // Try case-insensitive match if exact fails
    if (error || !data) {
      const { data: data2, error: error2 } = await db
        .from('wallets')
        .select('user_id')
        .ilike('address', workerAddress)
        .single()

      if (error2 || !data2) {
        return err(res, `Worker wallet not found: ${workerAddress}. Make sure the worker has signed up on PayStream first.`)
      }
      resolvedWorkerId = data2.user_id
    } else {
      resolvedWorkerId = data.user_id
    }
  }

  if (!resolvedWorkerId) {
    return err(res, 'Provide either workerId or workerAddress')
  }

  const stream = await createStream({
    employerId,
    workerId:   resolvedWorkerId,
    ratePerHour,
  })
  ok(res, stream)
}))

// GET /api/v1/streams
router.get('/streams', wrap(async (req, res) => {
  const { employerId, workerId, status } = req.query
  const streams = await listStreams({
    employerId: employerId || undefined,
    workerId:   workerId   || undefined,
    status:     status     || undefined,
  })
  ok(res, streams)
}))

// GET /api/v1/streams/:id
router.get('/streams/:id', wrap(async (req, res) => {
  const stream = await getStreamById(req.params.id)
  const earned = getEarnedSince(stream)
  ok(res, { ...stream, earned_since_last_payout: earned })
}))

// GET /api/v1/streams/:id/earned
router.get('/streams/:id/earned', wrap(async (req, res) => {
  const stream = await getStreamById(req.params.id)
  const earned = getEarnedSince(stream)
  ok(res, {
    earned,
    total_paid:    stream.total_paid,
    rate_per_hour: stream.rate_per_hour,
    status:        stream.status,
  })
}))

// POST /api/v1/streams/:id/pause
router.post('/streams/:id/pause', wrap(async (req, res) => {
  const stream = await pauseStream(req.params.id)
  ok(res, stream)
}))

// POST /api/v1/streams/:id/resume
router.post('/streams/:id/resume', wrap(async (req, res) => {
  const stream = await resumeStream(req.params.id)
  ok(res, stream)
}))

// POST /api/v1/streams/:id/stop
router.post('/streams/:id/stop', wrap(async (req, res) => {
  const stream = await stopStream(req.params.id)
  ok(res, stream)
}))

// ── PAYOUTS ──
// GET /api/v1/payouts?streamId=&limit=
router.get('/payouts', wrap(async (req, res) => {
  const { streamId, limit = 20 } = req.query
  let query = db.from('payouts').select('*').order('created_at', { ascending: false }).limit(parseInt(limit))
  if (streamId) query = query.eq('stream_id', streamId)
  const { data, error } = await query
  if (error) throw new Error(error.message)
  ok(res, data)
}))

// ── AGENT LOG ──
// GET /api/v1/agent-log?streamId=&limit=
router.get('/agent-log', wrap(async (req, res) => {
  const { streamId, limit = 10 } = req.query
  const logs = await getAgentLog(streamId, parseInt(limit))
  ok(res, logs)
}))

// ── WITHDRAWALS ──
// POST /api/v1/withdrawals (stub — CCTP integration)
router.post('/withdrawals', wrap(async (req, res) => {
  const { workerId, amount, destinationChain } = req.body
  ok(res, {
    id:               'wd-' + Date.now(),
    worker_id:        workerId,
    amount_usdc:      amount,
    destination_chain: destinationChain,
    status:           'initiated',
    created_at:       new Date().toISOString(),
  })
}))

export default router

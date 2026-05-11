// src/routes/index.js
// -------------------------------------------------------
// All PayStream REST endpoints.
// Mounted at /api/v1 in src/index.js
// -------------------------------------------------------
import { Router }    from 'express'
import { z }         from 'zod'
import {
  createWalletForUser,
  getWalletByUserId,
  getWalletBalance,
  listWallets,
}                    from '../services/walletService.js'
import {
  createStream,
  pauseStream,
  resumeStream,
  stopStream,
  getStreamById,
  listStreams,
  getEarnedSince,
}                    from '../services/streamService.js'
import {
  initiateWithdrawal,
  getWithdrawal,
  listWithdrawals,
}                    from '../services/withdrawalService.js'
import { getAgentLog } from '../services/agentService.js'
import { db }          from '../config/db.js'

const router = Router()

// -------------------------------------------------------
// Utility
// -------------------------------------------------------
const ok  = (res, data)    => res.json({ success: true, data })
const err = (res, msg, code = 400) => res.status(code).json({ success: false, error: msg })
const wrap = fn => async (req, res) => {
  try { await fn(req, res) }
  catch (e) {
    console.error('[Route]', e.message)
    err(res, e.message)
  }
}

// ===============================================================
// WALLETS
// POST /api/v1/wallets          Create wallet for a user
// GET  /api/v1/wallets/:userId  Get wallet + balance
// ===============================================================

router.post('/wallets', wrap(async (req, res) => {
  const { userId, role } = z.object({
    userId: z.string().min(1),
    role:   z.enum(['employer', 'worker']),
  }).parse(req.body)

  const wallet = await createWalletForUser(userId, role)
  ok(res, wallet)
}))

router.get('/wallets/:userId', wrap(async (req, res) => {
  const wallet  = await getWalletByUserId(req.params.userId)
  const balance = await getWalletBalance(wallet.circle_wallet_id)
  ok(res, { ...wallet, balance_usdc: balance })
}))

// ===============================================================
// STREAMS
// POST /api/v1/streams                    Create a stream
// GET  /api/v1/streams?employerId=&workerId=&status=  List
// GET  /api/v1/streams/:id                Get one stream + earned
// POST /api/v1/streams/:id/pause          Pause
// POST /api/v1/streams/:id/resume         Resume
// POST /api/v1/streams/:id/stop           Stop
// GET  /api/v1/streams/:id/earned         Live earned amount
// ===============================================================

router.post('/streams', wrap(async (req, res) => {
  const body = z.object({
    employerId:  z.string().min(1),
    workerId:    z.string().min(1),
    ratePerHour: z.number().positive(),
  }).parse(req.body)

  const stream = await createStream(body)
  ok(res, stream)
}))

router.get('/streams', wrap(async (req, res) => {
  const { employerId, workerId, status } = req.query
  const streams = await listStreams({
    employerId: employerId || undefined,
    workerId:   workerId   || undefined,
    status:     status     || undefined,
  })
  ok(res, streams)
}))

router.get('/streams/:id', wrap(async (req, res) => {
  const stream = await getStreamById(req.params.id)
  const earned = getEarnedSince(stream)
  ok(res, { ...stream, earned_since_last_payout: earned })
}))

router.post('/streams/:id/pause', wrap(async (req, res) => {
  const stream = await pauseStream(req.params.id)
  ok(res, stream)
}))

router.post('/streams/:id/resume', wrap(async (req, res) => {
  const stream = await resumeStream(req.params.id)
  ok(res, stream)
}))

router.post('/streams/:id/stop', wrap(async (req, res) => {
  const stream = await stopStream(req.params.id)
  ok(res, stream)
}))

router.get('/streams/:id/earned', wrap(async (req, res) => {
  const stream = await getStreamById(req.params.id)
  if (stream.status !== 'active') {
    return ok(res, { earned: 0, status: stream.status })
  }
  const earned = getEarnedSince(stream)
  ok(res, {
    earned,
    total_paid: stream.total_paid,
    rate_per_hour: stream.rate_per_hour,
    status: stream.status,
  })
}))

// ===============================================================
// WITHDRAWALS
// POST /api/v1/withdrawals              Initiate withdrawal
// GET  /api/v1/withdrawals/:id          Get status
// GET  /api/v1/withdrawals?workerId=    List for worker
// ===============================================================

router.post('/withdrawals', wrap(async (req, res) => {
  const body = z.object({
    workerId:           z.string().min(1),
    amountUsdc:         z.number().positive(),
    destinationChain:   z.string().min(1),
    destinationAddress: z.string().optional(),
  }).parse(req.body)

  const result = await initiateWithdrawal(body)
  ok(res, result)
}))

router.get('/withdrawals/:id', wrap(async (req, res) => {
  const wd = await getWithdrawal(req.params.id)
  ok(res, wd)
}))

router.get('/withdrawals', wrap(async (req, res) => {
  const { workerId } = req.query
  if (!workerId) return err(res, 'workerId query param required')
  const wds = await listWithdrawals(workerId)
  ok(res, wds)
}))

// ===============================================================
// PAYOUTS
// GET /api/v1/payouts?streamId=   Recent payouts for a stream
// ===============================================================

router.get('/payouts', wrap(async (req, res) => {
  const { streamId, limit = 50 } = req.query
  if (!streamId) return err(res, 'streamId query param required')

  const { data, error } = await db
    .from('payouts')
    .select('*')
    .eq('stream_id', streamId)
    .order('created_at', { ascending: false })
    .limit(parseInt(limit))

  if (error) return err(res, error.message)
  ok(res, data)
}))

// ===============================================================
// AGENT LOG
// GET /api/v1/agent-log?streamId=  AI decision log for UI panel
// ===============================================================

router.get('/agent-log', wrap(async (req, res) => {
  const { streamId, limit = 20 } = req.query
  if (!streamId) return err(res, 'streamId query param required')
  const log = await getAgentLog(streamId, parseInt(limit))
  ok(res, log)
}))

// ===============================================================
// HEALTH CHECK
// ===============================================================

router.get('/health', (_, res) => {
  res.json({
    status:     'ok',
    service:    'paystream-backend',
    network:    'ARC-TESTNET',
    timestamp:  new Date().toISOString(),
  })
})

export default router

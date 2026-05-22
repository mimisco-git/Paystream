// src/routes/index.js
import { Router }    from 'express'
import { z }         from 'zod'
import {
  createWalletForUser,
  getWalletByUserId,
  getWalletBalance,
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
import {
  createDepartment, listDepartments, getDepartmentByInviteCode,
  joinDepartment, getDepartmentWorkers, updateDepartment,
  deleteDepartment, rateWorker, generatePayrollReport
} from '../services/departmentService.js'
import { createWithdrawal, listWithdrawals } from '../services/withdrawalService.js'
import { db }          from '../config/db.js'

const router = Router()
const ok  = (res, data)          => res.json({ success: true, data })
const err = (res, msg, code=400) => res.status(code).json({ success: false, error: msg })
const wrap = fn => async (req, res) => {
  try { await fn(req, res) }
  catch (e) { console.error('[Route]', e.message); err(res, e.message) }
}

// ── HEALTH ──
router.get('/health', (_req, res) => res.json({
  status: 'ok', service: 'paystream-backend',
  network: 'ARC-TESTNET', timestamp: new Date().toISOString(),
}))

// ── USER LOOKUP (for employer name display) ──
router.get('/auth/user/:userId', wrap(async (req, res) => {
  const { data, error } = await db
    .from('users')
    .select('id, name, role, email')
    .eq('id', req.params.userId)
    .single()
  if (error || !data) return err(res, 'User not found', 404)
  ok(res, data)
}))

// ── WALLETS ──
router.post('/wallets', wrap(async (req, res) => {
  const { userId, role } = z.object({
    userId: z.string().min(1),
    role:   z.enum(['employer','worker']).default('worker'),
  }).parse(req.body)
  const wallet  = await createWalletForUser(userId, role)
  const balance = await getWalletBalance(wallet.circle_wallet_id)
  ok(res, { ...wallet, balance_usdc: balance })
}))

router.get('/wallets/:userId', wrap(async (req, res) => {
  const wallet  = await getWalletByUserId(req.params.userId)
  const balance = await getWalletBalance(wallet.circle_wallet_id)
  ok(res, { ...wallet, balance_usdc: balance })
}))

// ── STREAMS ──
router.post('/streams', wrap(async (req, res) => {
  const { employerId, workerId, workerAddress, ratePerHour, companyName, departmentId, workerTitle } = z.object({
    employerId:    z.string().min(1),
    workerId:      z.string().optional(),
    workerAddress: z.string().optional(),
    ratePerHour:   z.number().positive(),
    companyName:   z.string().optional(),
    departmentId:  z.string().optional(),
    workerTitle:   z.string().optional(),
  }).parse(req.body)

  let resolvedWorkerId = workerId

  if (!resolvedWorkerId && workerAddress) {
    const { data } = await db.from('wallets').select('user_id')
      .ilike('address', workerAddress).single()
    if (!data) return err(res, `Worker wallet not found: ${workerAddress}. The worker must sign up on PayStream first.`)
    resolvedWorkerId = data.user_id
  }

  if (!resolvedWorkerId) return err(res, 'Provide either workerId or workerAddress')
  if (resolvedWorkerId === employerId) return err(res, 'You cannot create a stream to yourself')

  const stream = await createStream({ employerId, workerId: resolvedWorkerId, ratePerHour, companyName, departmentId, workerTitle })
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

// ── PAUSE / RESUME / STOP ──
router.post('/streams/:id/pause', wrap(async (req, res) => {
  const stream = await getStreamById(req.params.id)
  if (stream.status !== 'active') return err(res, 'Stream is not active')
  const updated = await pauseStream(req.params.id)
  ok(res, updated)
}))

router.post('/streams/:id/resume', wrap(async (req, res) => {
  const stream = await getStreamById(req.params.id)
  if (stream.status !== 'paused') return err(res, 'Stream is not paused')
  const updated = await resumeStream(req.params.id)
  ok(res, updated)
}))

router.post('/streams/:id/stop', wrap(async (req, res) => {
  const stream = await getStreamById(req.params.id)
  if (stream.status === 'stopped') return err(res, 'Stream already stopped')
  const updated = await stopStream(req.params.id)
  ok(res, updated)
}))

// ── PAYOUTS ──
router.get('/payouts', wrap(async (req, res) => {
  const { streamId, limit = 20 } = req.query
  let query = db.from('payouts').select('*').order('created_at', { ascending: false }).limit(parseInt(limit))
  if (streamId) query = query.eq('stream_id', streamId)
  const { data, error } = await query
  if (error) throw new Error(error.message)
  ok(res, data)
}))

// ── AGENT LOG ──
router.get('/agent-log', wrap(async (req, res) => {
  const { streamId, limit = 10 } = req.query
  const logs = await getAgentLog(streamId, parseInt(limit))
  ok(res, logs)
}))


// ── DEPARTMENTS ──
router.post('/departments', wrap(async (req, res) => {
  const { employerId, name, description, ratePerHour, budgetMonthly, color } = z.object({
    employerId:    z.string().min(1),
    name:          z.string().min(1).max(60),
    description:   z.string().optional(),
    ratePerHour:   z.number().positive(),
    budgetMonthly: z.number().positive().optional(),
    color:         z.string().optional(),
  }).parse(req.body)
  const dept = await createDepartment({ employerId, name, description, ratePerHour, budgetMonthly, color })
  ok(res, dept)
}))

router.get('/departments', wrap(async (req, res) => {
  const { employerId } = req.query
  if (!employerId) return err(res, 'employerId required')
  const depts = await listDepartments(employerId)
  ok(res, depts)
}))

router.get('/departments/invite/:code', wrap(async (req, res) => {
  const dept = await getDepartmentByInviteCode(req.params.code)
  ok(res, dept)
}))

router.post('/departments/join', wrap(async (req, res) => {
  const { userId, inviteCode, jobTitle } = z.object({
    userId:     z.string().min(1),
    inviteCode: z.string().min(1),
    jobTitle:   z.string().optional(),
  }).parse(req.body)
  const result = await joinDepartment({ userId, inviteCode, jobTitle })
  ok(res, result)
}))

router.get('/departments/:id/workers', wrap(async (req, res) => {
  const workers = await getDepartmentWorkers(req.params.id)
  ok(res, workers)
}))

router.patch('/departments/:id', wrap(async (req, res) => {
  const { employerId, ...updates } = req.body
  const dept = await updateDepartment(req.params.id, employerId, updates)
  ok(res, dept)
}))

router.delete('/departments/:id', wrap(async (req, res) => {
  const { employerId } = req.query
  const result = await deleteDepartment(req.params.id, employerId)
  ok(res, result)
}))

router.post('/departments/rate', wrap(async (req, res) => {
  const { employerId, workerId, rating, comment, period } = z.object({
    employerId: z.string().min(1),
    workerId:   z.string().min(1),
    rating:     z.number().min(1).max(5),
    comment:    z.string().optional(),
    period:     z.string().optional(),
  }).parse(req.body)
  const result = await rateWorker({ employerId, workerId, rating, comment, period })
  ok(res, result)
}))

router.get('/departments/payroll', wrap(async (req, res) => {
  const { employerId, start, end } = req.query
  if (!employerId) return err(res, 'employerId required')
  const periodStart = start || new Date(new Date().setDate(1)).toISOString()
  const periodEnd   = end   || new Date().toISOString()
  const report = await generatePayrollReport(employerId, periodStart, periodEnd)
  ok(res, report)
}))

export default router

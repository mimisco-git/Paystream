// src/routes/index.js
import express from 'express'
import { z } from 'zod'
import { db } from '../config/db.js'
import { getWalletByUserId, getWalletBalance } from '../services/walletService.js'
import { createStream, pauseStream, resumeStream, stopStream, getEarnedSince } from '../services/streamService.js'
import { createWithdrawal, listWithdrawals } from '../services/withdrawalService.js'
import { getAgentLog } from '../services/agentService.js'
import {
  createDepartment, listDepartments, getDepartmentByInviteCode,
  joinDepartment, getDepartmentWorkers, updateDepartment,
  deleteDepartment, rateWorker, generatePayrollReport,
  streamFromDepartment, persistentPauseStream,
  listApplications, approveApplication, rejectApplication,
  getWorkerDepartmentStatus
} from '../services/departmentService.js'

const router = express.Router()

function ok(res, data)       { res.json({ success: true, data }) }
function err(res, msg, code) { res.status(code || 400).json({ success: false, error: msg }) }

function wrap(fn) {
  return async (req, res) => {
    try { await fn(req, res) }
    catch (e) { console.error('[Route]', e.message); err(res, e.message) }
  }
}

// ── WALLETS ──
router.post('/wallets', wrap(async (req, res) => {
  const { userId, role } = z.object({ userId: z.string().min(1), role: z.string().optional() }).parse(req.body)
  const wallet = await getWalletByUserId(userId)
  ok(res, wallet)
}))

router.get('/wallets/:userId', wrap(async (req, res) => {
  const wallet  = await getWalletByUserId(req.params.userId)
  const balance = await getWalletBalance(wallet.circle_wallet_id)
  await db.from('wallets').update({ balance_usdc: balance }).eq('user_id', req.params.userId)
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

  // Resolve worker ID from address if needed
  let resolvedWorkerId = workerId
  if (!resolvedWorkerId && workerAddress) {
    const { data: wallet } = await db.from('wallets').select('user_id').eq('address', workerAddress).single()
    if (!wallet) return err(res, 'Worker wallet not found. Worker must sign up first.')
    resolvedWorkerId = wallet.user_id
  }
  if (!resolvedWorkerId) return err(res, 'workerId or workerAddress required')

  const stream = await createStream({ employerId, workerId: resolvedWorkerId, ratePerHour, companyName, departmentId, workerTitle })
  ok(res, stream)
}))

router.get('/streams', wrap(async (req, res) => {
  const { employerId, workerId } = req.query
  let query = db.from('streams').select('*').order('created_at', { ascending: false })
  if (employerId) query = query.eq('employer_id', employerId)
  if (workerId)   query = query.eq('worker_id',   workerId)
  const { data, error } = await query
  if (error) throw new Error(error.message)
  ok(res, data || [])
}))

router.get('/streams/:id', wrap(async (req, res) => {
  const { data, error } = await db.from('streams').select('*').eq('id', req.params.id).single()
  if (error) throw new Error(error.message)
  ok(res, data)
}))

router.get('/streams/:id/earned', wrap(async (req, res) => {
  const result = await getEarnedSince(req.params.id)
  ok(res, result)
}))

// Persistent pause — saves paused_by, paused_at, pause_reason to DB
router.post('/streams/:id/pause', wrap(async (req, res) => {
  const { pausedBy, reason } = req.body
  const result = await persistentPauseStream(req.params.id, pausedBy, reason)
  ok(res, result)
}))

router.post('/streams/:id/resume', wrap(async (req, res) => {
  const result = await resumeStream(req.params.id)
  ok(res, result)
}))

router.post('/streams/:id/stop', wrap(async (req, res) => {
  const result = await stopStream(req.params.id)
  ok(res, result)
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

// ── WITHDRAWALS ──
router.post('/withdrawals', wrap(async (req, res) => {
  const { userId, amount, destinationAddress, destinationChain } = z.object({
    userId:             z.string().min(1),
    amount:             z.number().positive().max(10000),
    destinationAddress: z.string().min(10),
    destinationChain:   z.string().default('Arc'),
  }).parse(req.body)
  console.log('[Route] Withdrawal:', { userId, amount, destinationChain })
  const result = await createWithdrawal({ userId, amount, destinationAddress, destinationChain })
  ok(res, result)
}))

router.get('/withdrawals/:userId', wrap(async (req, res) => {
  const data = await listWithdrawals(req.params.userId)
  ok(res, data)
}))

// ── DEPARTMENTS ──
router.post('/departments', wrap(async (req, res) => {
  const { employerId, name, description, ratePerHour, budgetMonthly, color, isAdminDept } = z.object({
    employerId:    z.string().min(1),
    name:          z.string().min(1).max(60),
    description:   z.string().optional(),
    ratePerHour:   z.number().positive(),
    budgetMonthly: z.number().positive().optional(),
    color:         z.string().optional(),
    isAdminDept:   z.boolean().optional(),
  }).parse(req.body)
  const dept = await createDepartment({ employerId, name, description, ratePerHour, budgetMonthly, color, isAdminDept })
  ok(res, dept)
}))

router.get('/departments', wrap(async (req, res) => {
  const { employerId } = req.query
  if (!employerId) return err(res, 'employerId required')
  const depts = await listDepartments(employerId)
  ok(res, depts)
}))

// Must be before /:id routes to avoid conflict
router.get('/departments/invite/:code', wrap(async (req, res) => {
  const dept = await getDepartmentByInviteCode(req.params.code)
  ok(res, dept)
}))

router.get('/departments/payroll', wrap(async (req, res) => {
  const { employerId, start, end } = req.query
  if (!employerId) return err(res, 'employerId required')
  const periodStart = start || new Date(new Date().setDate(1)).toISOString()
  const periodEnd   = end   || new Date().toISOString()
  const report = await generatePayrollReport(employerId, periodStart, periodEnd)
  ok(res, report)
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

router.post('/departments/stream', wrap(async (req, res) => {
  const { departmentId, workerAddress, employerId, workerTitle } = z.object({
    departmentId:  z.string().min(1),
    workerAddress: z.string().min(10),
    employerId:    z.string().min(1),
    workerTitle:   z.string().optional(),
  }).parse(req.body)
  const stream = await streamFromDepartment({ departmentId, workerAddress, employerId, workerTitle })
  ok(res, stream)
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


// ── DEPARTMENT APPLICATIONS ──
// GET /api/v1/departments/applications?employerId=&status=pending
router.get('/departments/applications', wrap(async (req, res) => {
  const { employerId, status } = req.query
  if (!employerId) return err(res, 'employerId required')
  const apps = await listApplications(employerId, status)
  ok(res, apps)
}))

// POST /api/v1/departments/applications/:id/approve
router.post('/departments/applications/:id/approve', wrap(async (req, res) => {
  const { reviewedBy } = req.body
  if (!reviewedBy) return err(res, 'reviewedBy required')
  const result = await approveApplication(req.params.id, reviewedBy)
  ok(res, result)
}))

// POST /api/v1/departments/applications/:id/reject
router.post('/departments/applications/:id/reject', wrap(async (req, res) => {
  const { reviewedBy, reason } = req.body
  if (!reviewedBy) return err(res, 'reviewedBy required')
  const result = await rejectApplication(req.params.id, reviewedBy, reason)
  ok(res, result)
}))

// GET /api/v1/departments/my-status/:workerId
router.get('/departments/my-status/:workerId', wrap(async (req, res) => {
  const status = await getWorkerDepartmentStatus(req.params.workerId)
  ok(res, status)
}))

// ── HEALTH ──
router.get('/health', (req, res) => {
  res.json({ status: 'ok', service: 'paystream-backend', network: 'ARC-TESTNET', timestamp: new Date().toISOString() })
})

export default router

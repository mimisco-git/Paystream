// src/routes/auth.js
import express from 'express'
import bcrypt from 'bcryptjs'
import jwt from 'jsonwebtoken'
import { v4 as uuid } from 'uuid'
import { db } from '../config/db.js'
import { circleClient, ARC_BLOCKCHAIN } from '../config/circle.js'

const router = express.Router()
const JWT_SECRET = process.env.JWT_SECRET || 'paystream-arc-circle-2026'

function ok(res, data)  { res.json({ success: true,  data }) }
function err(res, msg, code=400) { res.status(code).json({ success: false, error: msg }) }

function wrap(fn) {
  return async (req, res) => {
    try { await fn(req, res) }
    catch(e) { console.error('[Auth]', e.message); err(res, e.message) }
  }
}

// ── SIGNUP ──
router.post('/signup', wrap(async (req, res) => {
  const { email, password, name, role, inviteCode } = req.body
  if (!email || !password || !name) return err(res, 'Email, password and name required')

  const { data: existing } = await db.from('users').select('id').eq('email', email.toLowerCase()).single()
  if (existing) return err(res, 'Email already registered')

  const hash = await bcrypt.hash(password, 10)
  const userId = uuid()

  // Create Circle wallet
  let walletId = null, walletAddress = null, walletSetId = null
  try {
    const wsRes = await circleClient.createWalletSet({ idempotencyKey: uuid(), name: 'PayStream-' + userId })
    walletSetId = wsRes.data?.walletSet?.id || wsRes.data?.id
    if (!walletSetId) throw new Error('No wallet set ID returned')

    const wRes = await circleClient.createWallets({
      idempotencyKey: uuid(), walletSetId, blockchains: [ARC_BLOCKCHAIN], count: 1
    })
    const wallet = wRes.data?.wallets?.[0]
    if (!wallet) throw new Error('No wallet returned')
    walletId = wallet.id; walletAddress = wallet.address
  } catch (e) {
    console.error('[Signup] Wallet creation failed:', e.message)
    return err(res, 'Failed to create Circle wallet: ' + e.message)
  }

  // Determine role from invite code
  let finalRole = role || 'worker'
  let deptId = null, employerId = null

  if (inviteCode) {
    const { data: dept } = await db.from('departments').select('*').eq('invite_code', inviteCode).single()
    if (dept) {
      deptId = dept.id
      employerId = dept.employer_id
      if (dept.is_admin_dept) finalRole = 'worker' // admin dept workers are still workers
    }
  }

  // Create user
  const { data: user, error: uErr } = await db.from('users').insert({
    id: userId, email: email.toLowerCase(), password_hash: hash,
    name, role: finalRole, department_id: deptId,
    employer_id: employerId, invite_code: inviteCode || null,
    is_admin: false, admin_permissions: []
  }).select().single()
  if (uErr) return err(res, uErr.message)

  // Save wallet
  await db.from('wallets').insert({
    user_id: userId, role: finalRole,
    circle_wallet_id: walletId, address: walletAddress,
    wallet_set_id: walletSetId
  })

  const token = jwt.sign({ userId, email: email.toLowerCase(), role: finalRole, name }, JWT_SECRET, { expiresIn: '7d' })
  console.log('[Signup] New user:', name, email, finalRole)
  ok(res, { token, user: { id: userId, email: email.toLowerCase(), name, role: finalRole }, wallet: { address: walletAddress, balance: 0 } })
}))

// ── LOGIN ──
router.post('/login', wrap(async (req, res) => {
  const { email, password } = req.body
  if (!email || !password) return err(res, 'Email and password required')

  const { data: user } = await db.from('users').select('*').eq('email', email.toLowerCase()).single()
  if (!user) return err(res, 'Invalid email or password')

  const ok2 = await bcrypt.compare(password, user.password_hash)
  if (!ok2) return err(res, 'Invalid email or password')

  const { data: wallet } = await db.from('wallets').select('*').eq('user_id', user.id).single()
  let balance = 0
  if (wallet?.circle_wallet_id) {
    try {
      const wb = await circleClient.getWallet({ id: wallet.circle_wallet_id })
      const balances = wb.data?.wallet?.balances || []
      const usdc = balances.find(b => b.token?.symbol === 'USDC' || b.token?.name?.includes('USD'))
      balance = parseFloat(usdc?.amount || 0)
      await db.from('wallets').update({ balance_usdc: balance }).eq('user_id', user.id)
    } catch(e) {}
  }

  const token = jwt.sign({ userId: user.id, email: user.email, role: user.role, name: user.name }, JWT_SECRET, { expiresIn: '7d' })
  ok(res, { token, user: { id: user.id, email: user.email, name: user.name, role: user.role, is_admin: user.is_admin, admin_permissions: user.admin_permissions }, wallet: { address: wallet?.address, balance } })
}))

// ── ME ──
router.get('/me', wrap(async (req, res) => {
  const auth = req.headers.authorization?.split(' ')[1]
  if (!auth) return err(res, 'Unauthorized', 401)
  try {
    const pl = jwt.verify(auth, JWT_SECRET)
    const { data: user } = await db.from('users').select('*').eq('id', pl.userId).single()
    if (!user) return err(res, 'User not found', 404)
    ok(res, { id: user.id, email: user.email, name: user.name, role: user.role, is_admin: user.is_admin, admin_permissions: user.admin_permissions })
  } catch(e) { err(res, 'Invalid token', 401) }
}))

// ── GET USER BY ID ──
router.get('/user/:userId', wrap(async (req, res) => {
  const { data: user } = await db.from('users').select('id,name,email,role,is_admin,admin_permissions,job_title,rating,department_id').eq('id', req.params.userId).single()
  if (!user) return err(res, 'User not found', 404)
  ok(res, user)
}))

// ── FORGOT PASSWORD ──
router.post('/forgot-password', wrap(async (req, res) => {
  const { email } = req.body
  if (!email) return err(res, 'Email required')

  const { data: user } = await db.from('users').select('id,name,email').eq('email', email.toLowerCase()).single()

  // Always return success to prevent email enumeration
  if (!user) { ok(res, { message: 'If that email exists, a reset link has been sent.' }); return }

  // Generate token
  const token = uuid().replace(/-/g, '') + uuid().replace(/-/g, '')
  const expires = new Date(Date.now() + 60 * 60 * 1000) // 1 hour

  await db.from('password_resets').insert({
    user_id: user.id, email: email.toLowerCase(), token, expires_at: expires.toISOString()
  })

  // In production send email — for demo log the reset link
  const resetUrl = (process.env.FRONTEND_URL || 'https://paystream-virid.vercel.app') + '/reset-password.html?token=' + token
  console.log('[ForgotPassword] Reset link for', email, ':', resetUrl)

  ok(res, { message: 'If that email exists, a reset link has been sent.', _dev_reset_url: resetUrl })
}))

// ── RESET PASSWORD ──
router.post('/reset-password', wrap(async (req, res) => {
  const { token, password } = req.body
  if (!token || !password) return err(res, 'Token and new password required')
  if (password.length < 6) return err(res, 'Password must be at least 6 characters')

  const { data: reset } = await db.from('password_resets')
    .select('*').eq('token', token).eq('used', false).single()

  if (!reset) return err(res, 'Invalid or expired reset token')
  if (new Date(reset.expires_at) < new Date()) return err(res, 'Reset token has expired')

  const hash = await bcrypt.hash(password, 10)
  await db.from('users').update({ password_hash: hash }).eq('id', reset.user_id)
  await db.from('password_resets').update({ used: true }).eq('id', reset.id)

  console.log('[ResetPassword] Password reset for user', reset.user_id)
  ok(res, { message: 'Password reset successfully. You can now log in.' })
}))

// ── ADMIN: UPDATE PERMISSIONS ──
router.post('/admin/permissions', wrap(async (req, res) => {
  const { employerId, workerId, permissions, isAdmin } = req.body
  if (!employerId || !workerId) return err(res, 'employerId and workerId required')

  // Verify the requester is actually an employer
  const { data: employer } = await db.from('users').select('role').eq('id', employerId).single()
  if (!employer || employer.role !== 'employer') return err(res, 'Only employers can assign admin permissions')

  await db.from('users').update({
    is_admin: isAdmin || false,
    admin_permissions: permissions || []
  }).eq('id', workerId)

  console.log('[Admin] Permissions updated for', workerId, ':', permissions)
  ok(res, { updated: true, permissions, is_admin: isAdmin })
}))

export default router

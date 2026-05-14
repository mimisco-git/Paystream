// src/routes/auth.js
// -------------------------------------------------------
// Email + password authentication for PayStream.
//
// POST /api/v1/auth/signup  — create account + Circle wallet
// POST /api/v1/auth/login   — login, get JWT token
// GET  /api/v1/auth/me      — get current user + wallet
// POST /api/v1/auth/logout  — clear session
// -------------------------------------------------------
import { Router }   from 'express'
import bcrypt       from 'bcryptjs'
import jwt          from 'jsonwebtoken'
import { z }        from 'zod'
import { db }       from '../config/db.js'
import { createWalletForUser, getWalletByUserId, getWalletBalance } from '../services/walletService.js'

const router = Router()
const JWT_SECRET = process.env.JWT_SECRET || 'paystream-secret-change-in-prod'

// ── helpers ──
const ok  = (res, data) => res.json({ success: true, data })
const err = (res, msg, code = 400) => res.status(code).json({ success: false, error: msg })
const wrap = fn => async (req, res) => {
  try { await fn(req, res) }
  catch (e) { console.error('[Auth]', e.message); err(res, e.message) }
}

// ── middleware: verify JWT ──
export function requireAuth(req, res, next) {
  const header = req.headers.authorization
  if (!header?.startsWith('Bearer ')) return err(res, 'Not authenticated', 401)
  try {
    const token = header.slice(7)
    req.user = jwt.verify(token, JWT_SECRET)
    next()
  } catch {
    err(res, 'Invalid or expired token', 401)
  }
}

// ── POST /api/v1/auth/signup ──
router.post('/signup', wrap(async (req, res) => {
  const { email, password, name, role } = z.object({
    email:    z.string().email(),
    password: z.string().min(6),
    name:     z.string().min(1),
    role:     z.enum(['employer', 'worker']).default('worker'),
  }).parse(req.body)

  // Check email not already taken
  const { data: existing } = await db
    .from('users')
    .select('id')
    .eq('email', email.toLowerCase())
    .single()

  if (existing) return err(res, 'Email already registered')

  // Hash password
  const passwordHash = await bcrypt.hash(password, 12)

  // Create user record
  const { data: user, error: dbErr } = await db
    .from('users')
    .insert({
      email:         email.toLowerCase(),
      password_hash: passwordHash,
      name,
      role,
    })
    .select()
    .single()

  if (dbErr) throw new Error('Failed to create user: ' + dbErr.message)

  // Create Circle wallet automatically
  console.log(`[Auth] Creating ${role} wallet for ${email}`)
  const wallet = await createWalletForUser(user.id, role)

  // Issue JWT
  const token = jwt.sign(
    { userId: user.id, email: user.email, role: user.role, name: user.name },
    JWT_SECRET,
    { expiresIn: '7d' }
  )

  ok(res, {
    token,
    user: {
      id:      user.id,
      email:   user.email,
      name:    user.name,
      role:    user.role,
    },
    wallet: {
      address:   wallet.address,
      balance:   0,
    },
  })
}))

// ── POST /api/v1/auth/login ──
router.post('/login', wrap(async (req, res) => {
  const { email, password } = z.object({
    email:    z.string().email(),
    password: z.string().min(1),
  }).parse(req.body)

  // Find user
  const { data: user } = await db
    .from('users')
    .select('*')
    .eq('email', email.toLowerCase())
    .single()

  if (!user) return err(res, 'Invalid email or password', 401)

  // Check password
  const valid = await bcrypt.compare(password, user.password_hash)
  if (!valid) return err(res, 'Invalid email or password', 401)

  // Get wallet + balance
  let wallet = null
  let balance = 0
  try {
    wallet  = await getWalletByUserId(user.id)
    balance = await getWalletBalance(wallet.circle_wallet_id)
  } catch {
    // Wallet might not exist yet — create it
    wallet  = await createWalletForUser(user.id, user.role)
    balance = 0
  }

  // Issue JWT
  const token = jwt.sign(
    { userId: user.id, email: user.email, role: user.role, name: user.name },
    JWT_SECRET,
    { expiresIn: '7d' }
  )

  ok(res, {
    token,
    user: {
      id:    user.id,
      email: user.email,
      name:  user.name,
      role:  user.role,
    },
    wallet: {
      address: wallet.address,
      balance,
    },
  })
}))

// ── GET /api/v1/auth/me ──
router.get('/me', requireAuth, wrap(async (req, res) => {
  const { userId } = req.user

  const { data: user } = await db
    .from('users')
    .select('id, email, name, role, created_at')
    .eq('id', userId)
    .single()

  if (!user) return err(res, 'User not found', 404)

  let wallet = null, balance = 0
  try {
    wallet  = await getWalletByUserId(userId)
    balance = await getWalletBalance(wallet.circle_wallet_id)
  } catch { /* no wallet yet */ }

  ok(res, {
    user,
    wallet: wallet ? { address: wallet.address, balance } : null,
  })
}))

export default router

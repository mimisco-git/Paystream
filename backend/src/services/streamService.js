// src/services/streamService.js
// -------------------------------------------------------
// A "stream" is a database row that tracks the ongoing
// salary relationship between one employer and one worker.
//
// The actual USDC movement is triggered by the cron job
// (src/jobs/payoutCron.js) every 60 seconds, which reads
// all active streams and dispatches nanopayments for the
// USDC earned since the last payout.
// -------------------------------------------------------
import { db }              from '../config/db.js'
import { getWalletByUserId, getWalletBalance } from './walletService.js'

// -------------------------------------------------------
// createStream
// Starts a new salary stream from employer to worker.
// Validates that the employer has enough USDC float first.
// -------------------------------------------------------
export async function createStream({
  employerId,
  workerId,
  ratePerHour,   // e.g. 18.50
}) {
  // Resolve wallets
  const [empWallet, workerWallet] = await Promise.all([
    getWalletByUserId(employerId),
    getWalletByUserId(workerId),
  ])

  // Safety: require at least 24h of runway in employer float
  const balance   = await getWalletBalance(empWallet.circle_wallet_id)
  const minFloat  = ratePerHour * 24
  if (balance < minFloat) {
    throw new Error(
      `Employer float too low. Need $${minFloat.toFixed(2)} USDC for 24h runway, `
      + `current balance: $${balance.toFixed(2)} USDC`
    )
  }

  // Stop any existing active stream for this worker
  await db
    .from('streams')
    .update({ status: 'stopped' })
    .eq('worker_id', workerId)
    .eq('status',    'active')

  // Create new stream
  const { data, error } = await db
    .from('streams')
    .insert({
      employer_id:     employerId,
      worker_id:       workerId,
      employer_wallet: empWallet.circle_wallet_id,
      worker_wallet:   workerWallet.circle_wallet_id,
      rate_per_hour:   ratePerHour,
      status:          'active',
      last_payout_at:  new Date().toISOString(),
    })
    .select()
    .single()

  if (error) throw new Error('Failed to create stream: ' + error.message)
  console.log(`[Stream] Created: ${employerId} → ${workerId} @ $${ratePerHour}/hr`)
  return data
}

// -------------------------------------------------------
// pauseStream / resumeStream
// Controlled by the AI agent when work activity drops.
// -------------------------------------------------------
export async function pauseStream(streamId) {
  const { data, error } = await db
    .from('streams')
    .update({ status: 'paused' })
    .eq('id',     streamId)
    .eq('status', 'active')
    .select()
    .single()

  if (error) throw new Error('Pause failed: ' + error.message)
  console.log(`[Stream] Paused: ${streamId}`)
  return data
}

export async function resumeStream(streamId) {
  const { data, error } = await db
    .from('streams')
    .update({
      status:         'active',
      last_payout_at: new Date().toISOString(), // reset clock on resume
    })
    .eq('id',     streamId)
    .eq('status', 'paused')
    .select()
    .single()

  if (error) throw new Error('Resume failed: ' + error.message)
  console.log(`[Stream] Resumed: ${streamId}`)
  return data
}

export async function stopStream(streamId) {
  const { data, error } = await db
    .from('streams')
    .update({ status: 'stopped' })
    .eq('id', streamId)
    .select()
    .single()

  if (error) throw new Error('Stop failed: ' + error.message)
  console.log(`[Stream] Stopped: ${streamId}`)
  return data
}

// -------------------------------------------------------
// getStreamById / listStreams
// -------------------------------------------------------
export async function getStreamById(streamId) {
  const { data, error } = await db
    .from('streams')
    .select('*')
    .eq('id', streamId)
    .single()

  if (error) throw new Error('Stream not found: ' + streamId)
  return data
}

export async function listStreams(filters = {}) {
  let q = db.from('streams').select('*').order('created_at', { ascending: false })
  if (filters.employerId) q = q.eq('employer_id', filters.employerId)
  if (filters.workerId)   q = q.eq('worker_id',   filters.workerId)
  if (filters.status)     q = q.eq('status',       filters.status)
  const { data, error } = await q
  if (error) throw new Error(error.message)
  return data
}

// -------------------------------------------------------
// getEarnedSince
// Calculates USDC earned between lastPayoutAt and now.
// This is the amount the cron dispatches per tick.
// -------------------------------------------------------
export function getEarnedSince(stream) {
  const lastPayout = new Date(stream.last_payout_at)
  const now        = new Date()
  const elapsedMs  = now - lastPayout
  const elapsedHrs = elapsedMs / (1000 * 60 * 60)
  const earned     = elapsedHrs * parseFloat(stream.rate_per_hour)
  return Math.max(0, parseFloat(earned.toFixed(6)))
}

// src/services/agentService.js
// -------------------------------------------------------
// THE AI AGENT LAYER — PayStream's Track 4 differentiator.
//
// A lightweight AI agent polls external work-activity
// signals (GitHub commits, Clockify clock-in status,
// a simple toggle API) every 5 minutes per worker.
//
// If activity drops, the agent pauses the stream so the
// employer never overpays. When activity resumes, the
// agent re-activates the stream automatically.
//
// Agent decisions and reasoning are logged to Supabase
// and surfaced in the UI's "AI Stream Monitor" panel.
// -------------------------------------------------------
import cron   from 'node-cron'
import { db } from '../config/db.js'
import { pauseStream, resumeStream, listStreams } from './streamService.js'

// -------------------------------------------------------
// checkWorkActivity
// Returns a 0.0–1.0 activity score for a given workerId.
//
// In production this would call:
//   - Clockify API (clock in/out status)
//   - GitHub Events API (recent commits)
//   - A custom "I am working" toggle in the worker UI
//
// For the hackathon demo, we simulate realistic patterns:
// high activity during work hours, low at night.
// -------------------------------------------------------
async function checkWorkActivity(workerId) {
  const hour = new Date().getHours()

  // Simulated activity score (replace with real API calls)
  const isWorkHour = hour >= 8 && hour < 18
  const baseScore  = isWorkHour ? 0.8 : 0.1
  const jitter     = (Math.random() - 0.5) * 0.2
  const score      = Math.min(1, Math.max(0, baseScore + jitter))

  // TODO: replace with real check, e.g.:
  //   const clockify = await fetch(
  //     `https://api.clockify.me/api/v1/user/${workerId}/time-entries?in-progress=true`,
  //     { headers: { 'X-Api-Key': process.env.CLOCKIFY_API_KEY } }
  //   )
  //   const clocked = (await clockify.json()).length > 0
  //   return clocked ? 1.0 : 0.0

  return { score, source: 'simulated', isWorkHour }
}

// -------------------------------------------------------
// logAgentAction
// Writes an agent decision to the agent_log table,
// which the frontend streams to the AI Monitor panel.
// -------------------------------------------------------
async function logAgentAction({ streamId, workerId, action, reason, score }) {
  await db.from('agent_log').insert({
    stream_id: streamId,
    worker_id: workerId,
    action,
    reason,
    activity_score: score,
  }).catch(e => console.warn('[Agent] Log write failed:', e.message))

  console.log(`[Agent] ${action.toUpperCase()} | worker: ${workerId} | score: ${score.toFixed(2)} | ${reason}`)
}

// -------------------------------------------------------
// evaluateStream
// Core agent logic: check activity, decide action.
// -------------------------------------------------------
async function evaluateStream(stream) {
  const { score, source } = await checkWorkActivity(stream.worker_id)

  if (stream.status === 'active' && score < 0.25) {
    // Low activity detected — pause stream
    await pauseStream(stream.id)
    await logAgentAction({
      streamId: stream.id,
      workerId: stream.worker_id,
      action:   'pause',
      reason:   `Activity score ${score.toFixed(2)} below threshold (0.25). Source: ${source}`,
      score,
    })
    return { action: 'paused', score }
  }

  if (stream.status === 'paused' && score >= 0.6) {
    // Activity restored — resume stream
    await resumeStream(stream.id)
    await logAgentAction({
      streamId: stream.id,
      workerId: stream.worker_id,
      action:   'resume',
      reason:   `Activity score ${score.toFixed(2)} above resume threshold (0.60). Source: ${source}`,
      score,
    })
    return { action: 'resumed', score }
  }

  // No state change needed
  await logAgentAction({
    streamId: stream.id,
    workerId: stream.worker_id,
    action:   'monitor',
    reason:   `Activity score ${score.toFixed(2)} — stream status unchanged (${stream.status})`,
    score,
  })
  return { action: 'no_change', score }
}

// -------------------------------------------------------
// agentTick
// Runs every 5 minutes. Evaluates all active and paused streams.
// -------------------------------------------------------
async function agentTick() {
  const streams = await listStreams({ status: 'active' })
  const paused  = await listStreams({ status: 'paused' })
  const all     = [...streams, ...paused]

  if (!all.length) return

  console.log(`[Agent] Evaluating ${all.length} stream(s)`)
  await Promise.allSettled(all.map(evaluateStream))
}

// -------------------------------------------------------
// startAgentMonitor
// Called once on server startup alongside the cron.
// -------------------------------------------------------
export function startAgentMonitor() {
  console.log('[Agent] AI stream monitor started — evaluating every 5 min')
  cron.schedule('*/5 * * * *', agentTick)
}

// -------------------------------------------------------
// getAgentLog
// Returns recent agent decisions for a stream, for the UI.
// -------------------------------------------------------
export async function getAgentLog(streamId, limit = 20) {
  const { data, error } = await db
    .from('agent_log')
    .select('*')
    .eq('stream_id', streamId)
    .order('created_at', { ascending: false })
    .limit(limit)

  if (error) throw new Error(error.message)
  return data
}

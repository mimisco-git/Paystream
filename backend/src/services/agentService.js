// src/services/agentService.js
// -------------------------------------------------------
// AI agent that monitors work activity and auto-pauses
// or resumes streams based on activity score.
//
// Threshold lowered for demo: pauses only at score < 0.05
// so the stream stays active during hackathon presentation.
// -------------------------------------------------------
import cron   from 'node-cron'
import { db } from '../config/db.js'
import { pauseStream, resumeStream, listStreams } from './streamService.js'

async function checkWorkActivity(workerId) {
  const hour = new Date().getHours()

  // Simulate realistic activity — high during work hours
  // In production: replace with Clockify API or GitHub Events API
  const isWorkHour = hour >= 6 && hour < 23  // wide window for demo
  const baseScore  = isWorkHour ? 0.85 : 0.30
  const jitter     = (Math.random() - 0.5) * 0.1
  const score      = Math.min(1, Math.max(0, baseScore + jitter))

  return { score, source: 'simulated', isWorkHour }
}

async function logAgentAction({ streamId, workerId, action, reason, score }) {
  await db.from('agent_log').insert({
    stream_id:      streamId,
    worker_id:      workerId,
    action,
    reason,
    activity_score: score,
  }).catch(e => console.warn('[Agent] Log write failed:', e.message))

  console.log(`[Agent] ${action.toUpperCase()} | worker: ${workerId} | score: ${score.toFixed(2)} | ${reason}`)
}

async function evaluateStream(stream) {
  const { score, source } = await checkWorkActivity(stream.worker_id)

  // Lowered threshold for demo — only pauses on near-zero activity
  if (stream.status === 'active' && score < 0.05) {
    await pauseStream(stream.id)
    await logAgentAction({
      streamId: stream.id,
      workerId: stream.worker_id,
      action:   'pause',
      reason:   `Activity score ${score.toFixed(2)} below threshold (0.05). Source: ${source}`,
      score,
    })
    return { action: 'paused', score }
  }

  if (stream.status === 'paused' && score >= 0.30) {
    await resumeStream(stream.id)
    await logAgentAction({
      streamId: stream.id,
      workerId: stream.worker_id,
      action:   'resume',
      reason:   `Activity score ${score.toFixed(2)} above resume threshold (0.30). Source: ${source}`,
      score,
    })
    return { action: 'resumed', score }
  }

  await logAgentAction({
    streamId: stream.id,
    workerId: stream.worker_id,
    action:   'monitor',
    reason:   `Activity score ${score.toFixed(2)} — stream status unchanged (${stream.status})`,
    score,
  })
  return { action: 'no_change', score }
}

async function agentTick() {
  const streams = await listStreams({ status: 'active' })
  const paused  = await listStreams({ status: 'paused' })
  const all     = [...streams, ...paused]

  if (!all.length) return

  console.log(`[Agent] Evaluating ${all.length} stream(s)`)
  await Promise.allSettled(all.map(evaluateStream))
}

export function startAgentMonitor() {
  console.log('[Agent] AI stream monitor started — evaluating every 5 min')
  cron.schedule('*/5 * * * *', agentTick)
}

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

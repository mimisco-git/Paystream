// src/services/messageService.js
import { db } from '../config/db.js'

// ── SEND MESSAGE ──
export async function sendMessage({ employerId, workerId, senderId, senderRole, body, streamId }) {
  if (!body || !body.trim()) throw new Error('Message body required')

  const { data, error } = await db.from('messages').insert({
    employer_id: employerId,
    worker_id:   workerId,
    sender_id:   senderId,
    sender_role: senderRole,
    body:        body.trim(),
    stream_id:   streamId || null,
    read:        false,
  }).select().single()

  if (error) throw new Error('Failed to send message: ' + error.message)
  console.log('[Message] Sent from', senderRole, senderId, '->', workerId)
  return data
}

// ── GET CONVERSATION (between employer and worker) ──
export async function getConversation(employerId, workerId, limit) {
  const { data, error } = await db.from('messages')
    .select('*')
    .eq('employer_id', employerId)
    .eq('worker_id', workerId)
    .order('created_at', { ascending: true })
    .limit(limit || 50)

  if (error) throw new Error(error.message)
  return data || []
}

// ── GET ALL CONVERSATIONS FOR EMPLOYER ──
export async function getEmployerConversations(employerId) {
  // Get latest message per worker
  const { data, error } = await db.from('messages')
    .select('*')
    .eq('employer_id', employerId)
    .order('created_at', { ascending: false })

  if (error) throw new Error(error.message)

  // Group by worker_id, keep latest
  const seen = new Map()
  for (const msg of (data || [])) {
    if (!seen.has(msg.worker_id)) seen.set(msg.worker_id, msg)
  }

  // Enrich with worker name
  const convos = await Promise.all(Array.from(seen.values()).map(async msg => {
    const { data: worker } = await db.from('users')
      .select('name, email').eq('id', msg.worker_id).single()
    const { data: unreadCount } = await db.from('messages')
      .select('id', { count: 'exact' })
      .eq('employer_id', employerId)
      .eq('worker_id', msg.worker_id)
      .eq('read', false)
      .eq('sender_role', 'worker')
    return {
      ...msg,
      worker_name:  worker?.name || 'Worker',
      worker_email: worker?.email || '',
      unread_count: unreadCount?.length || 0,
    }
  }))

  return convos.sort((a, b) => new Date(b.created_at) - new Date(a.created_at))
}

// ── GET WORKER INBOX ──
export async function getWorkerInbox(workerId) {
  const { data, error } = await db.from('messages')
    .select('*')
    .eq('worker_id', workerId)
    .order('created_at', { ascending: false })

  if (error) throw new Error(error.message)

  // Group by employer
  const seen = new Map()
  for (const msg of (data || [])) {
    if (!seen.has(msg.employer_id)) seen.set(msg.employer_id, msg)
  }

  const convos = await Promise.all(Array.from(seen.values()).map(async msg => {
    const { data: employer } = await db.from('users')
      .select('name, email').eq('id', msg.employer_id).single()
    const { data: unread } = await db.from('messages')
      .select('id')
      .eq('worker_id', workerId)
      .eq('employer_id', msg.employer_id)
      .eq('read', false)
      .eq('sender_role', 'employer')
    return {
      ...msg,
      employer_name:  employer?.name || 'Employer',
      employer_email: employer?.email || '',
      unread_count:   unread?.length || 0,
    }
  }))

  return convos.sort((a, b) => new Date(b.created_at) - new Date(a.created_at))
}

// ── MARK MESSAGES AS READ ──
export async function markRead(employerId, workerId, readerRole) {
  // Mark messages sent by the OTHER party as read
  const senderRole = readerRole === 'employer' ? 'worker' : 'employer'
  await db.from('messages')
    .update({ read: true })
    .eq('employer_id', employerId)
    .eq('worker_id', workerId)
    .eq('sender_role', senderRole)
    .eq('read', false)
  return { marked: true }
}

// ── UNREAD COUNT ──
export async function getUnreadCount(userId, role) {
  const field = role === 'employer' ? 'employer_id' : 'worker_id'
  const senderRole = role === 'employer' ? 'worker' : 'employer'

  const { data, error } = await db.from('messages')
    .select('id')
    .eq(field, userId)
    .eq('sender_role', senderRole)
    .eq('read', false)

  if (error) return 0
  return data?.length || 0
}

// ── BROADCAST TO DEPARTMENT ──
export async function broadcastToDepartment({ employerId, departmentId, body }) {
  const { data: streams } = await db.from('streams')
    .select('worker_id')
    .eq('department_id', departmentId)
    .eq('employer_id', employerId)

  if (!streams?.length) return { sent: 0 }

  const messages = streams.map(s => ({
    employer_id: employerId,
    worker_id:   s.worker_id,
    sender_id:   employerId,
    sender_role: 'employer',
    body:        body.trim(),
    read:        false,
  }))

  const { error } = await db.from('messages').insert(messages)
  if (error) throw new Error('Broadcast failed: ' + error.message)

  console.log('[Message] Broadcast to', streams.length, 'workers in dept', departmentId)
  return { sent: streams.length }
}

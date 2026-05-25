// src/services/departmentService.js - v3 with approval flow
import { db } from '../config/db.js'
import { circleClient, ARC_BLOCKCHAIN } from '../config/circle.js'

function generateInviteCode(name) {
  const slug = name.toLowerCase().replace(/[^a-z0-9]/g,'').slice(0,8)
  const rand = Math.random().toString(36).slice(2,7)
  return slug+'-'+rand
}

// ── CREATE DEPARTMENT ──
export async function createDepartment({ employerId, name, description, ratePerHour, budgetMonthly, color, isAdminDept }) {
  const inviteCode = generateInviteCode(name)
  const { data, error } = await db.from('departments').insert({
    employer_id: employerId, name, description: description||'',
    rate_per_hour: ratePerHour, budget_monthly: budgetMonthly||null,
    invite_code: inviteCode, color: color||'#C87A10',
    is_admin_dept: isAdminDept||false,
    cached_member_count: 0, cached_total_streaming: 0,
  }).select().single()
  if (error) throw new Error('Failed to create department: '+error.message)
  console.log('[Dept] Created:', name, '| invite:', inviteCode)
  return data
}

// ── LIST DEPARTMENTS ──
export async function listDepartments(employerId) {
  const { data, error } = await db.from('departments').select('*')
    .eq('employer_id', employerId)
    .order('is_admin_dept', { ascending: false })
    .order('created_at', { ascending: true })
  if (error) throw new Error(error.message)

  const enriched = await Promise.all((data||[]).map(async dept => {
    const { data: streams } = await db.from('streams').select('worker_id,total_paid,status,rate_per_hour').eq('department_id', dept.id)
    const { data: pending } = await db.from('department_applications').select('id').eq('department_id', dept.id).eq('status','pending')
    const workers   = streams?.length||0
    const active    = streams?.filter(s=>s.status==='active').length||0
    const paused    = streams?.filter(s=>s.status==='paused').length||0
    const totalPaid = streams?.reduce((s,x)=>s+parseFloat(x.total_paid||0),0)||0
    const liveRate  = streams?.filter(s=>s.status==='active').reduce((s,x)=>s+parseFloat(x.rate_per_hour||0),0)||0
    const pendingCount = pending?.length||0
    await db.from('departments').update({ cached_member_count: workers, cached_total_streaming: totalPaid }).eq('id', dept.id)
    return { ...dept, worker_count: workers, active_count: active, paused_count: paused, total_paid: totalPaid, live_rate_per_hour: liveRate, pending_count: pendingCount }
  }))
  return enriched
}

// ── GET DEPT BY INVITE CODE ──
export async function getDepartmentByInviteCode(inviteCode) {
  const { data, error } = await db.from('departments').select('*').eq('invite_code', inviteCode).single()
  if (error||!data) throw new Error('Invalid invite code')
  const { data: employer } = await db.from('users').select('name,email').eq('id', data.employer_id).single()
  return { ...data, employer_name: employer?.name||'Unknown Employer' }
}

// ── JOIN DEPARTMENT (creates application, waits for approval) ──
export async function joinDepartment({ userId, inviteCode, jobTitle }) {
  const dept = await getDepartmentByInviteCode(inviteCode)

  // Get worker info
  const { data: worker } = await db.from('users').select('name,email').eq('id', userId).single()

  // Check if already applied or joined
  const { data: existing } = await db.from('department_applications')
    .select('*').eq('department_id', dept.id).eq('worker_id', userId).single()

  if (existing) {
    if (existing.status === 'approved') return { status: 'already_member', department: dept }
    if (existing.status === 'pending')  return { status: 'pending_approval', department: dept, application: existing }
    if (existing.status === 'rejected') {
      // Allow re-apply - update existing
      await db.from('department_applications').update({ status:'pending', created_at: new Date().toISOString() }).eq('id', existing.id)
      return { status: 'reapplied', department: dept }
    }
  }

  // Update user department info
  await db.from('users').update({
    department_id: dept.id,
    job_title:     jobTitle||'Team Member',
    invite_code:   inviteCode,
    employer_id:   dept.employer_id,
  }).eq('id', userId)

  // Create application record
  const { data: app, error } = await db.from('department_applications').insert({
    department_id: dept.id,
    employer_id:   dept.employer_id,
    worker_id:     userId,
    worker_name:   worker?.name||'Unknown',
    worker_email:  worker?.email||'',
    job_title:     jobTitle||'Team Member',
    status:        'pending',
  }).select().single()

  if (error) throw new Error('Failed to create application: '+error.message)

  console.log('[Dept] Application submitted:', worker?.name, '->', dept.name)
  return { status: 'pending_approval', department: dept, application: app }
}

// ── LIST PENDING APPLICATIONS (for employer/admin) ──
export async function listApplications(employerId, status) {
  let query = db.from('department_applications').select('*, departments(name,color,rate_per_hour)')
    .eq('employer_id', employerId)
    .order('created_at', { ascending: false })
  if (status) query = query.eq('status', status)
  const { data, error } = await query
  if (error) throw new Error(error.message)
  return data || []
}

// ── APPROVE APPLICATION ──
export async function approveApplication(applicationId, reviewedBy) {
  const { data: app, error: fetchErr } = await db.from('department_applications')
    .select('*').eq('id', applicationId).single()
  if (fetchErr||!app) throw new Error('Application not found')
  if (app.status !== 'pending') throw new Error('Application is not pending')

  // Get wallets
  const { data: empWallet }    = await db.from('wallets').select('*').eq('user_id', app.employer_id).single()
  const { data: workerWallet } = await db.from('wallets').select('*').eq('user_id', app.worker_id).single()
  const { data: dept }         = await db.from('departments').select('*').eq('id', app.department_id).single()

  if (!empWallet || !workerWallet) throw new Error('Wallet not found for employer or worker')

  // Create salary stream
  const { data: stream, error: streamErr } = await db.from('streams').insert({
    employer_id:     app.employer_id,
    worker_id:       app.worker_id,
    employer_wallet: empWallet.circle_wallet_id,
    worker_wallet:   workerWallet.circle_wallet_id,
    rate_per_hour:   dept.rate_per_hour,
    department_id:   app.department_id,
    company_name:    dept.name,
    worker_title:    app.job_title,
    status:          'active',
    last_payout_at:  new Date().toISOString(),
  }).select().single()

  if (streamErr) throw new Error('Failed to create stream: '+streamErr.message)

  // Mark application approved
  await db.from('department_applications').update({
    status:      'approved',
    reviewed_by:  reviewedBy,
    reviewed_at:  new Date().toISOString(),
  }).eq('id', applicationId)

  // Update user admin status if admin dept
  if (dept.is_admin_dept) {
    await db.from('users').update({
      is_admin: true,
      admin_permissions: ['pause_stream','resume_stream','view_reports']
    }).eq('id', app.worker_id)
  }

  console.log('[Dept] Approved:', app.worker_name, '->', dept.name, '| stream:', stream.id)
  return { approved: true, stream, application: app }
}

// ── REJECT APPLICATION ──
export async function rejectApplication(applicationId, reviewedBy, reason) {
  await db.from('department_applications').update({
    status:      'rejected',
    reviewed_by:  reviewedBy,
    reviewed_at:  new Date().toISOString(),
    pause_reason: reason||'Rejected by employer',
  }).eq('id', applicationId)
  return { rejected: true, applicationId }
}

// ── GET WORKER DEPARTMENT STATUS ──
export async function getWorkerDepartmentStatus(workerId) {
  const { data: user } = await db.from('users').select('department_id,job_title,is_admin,employer_id').eq('id', workerId).single()
  if (!user?.department_id) return null

  const { data: dept } = await db.from('departments').select('*').eq('id', user.department_id).single()
  const { data: app }  = await db.from('department_applications')
    .select('*').eq('worker_id', workerId).eq('department_id', user.department_id)
    .order('created_at', { ascending: false }).limit(1).single()
  const { data: employer } = user.employer_id
    ? await db.from('users').select('name,email').eq('id', user.employer_id).single()
    : { data: null }

  return {
    department:  dept,
    job_title:   user.job_title,
    is_admin:    user.is_admin,
    employer:    employer,
    application: app,
    status:      app?.status || 'unknown',
  }
}

// ── STREAM FROM DEPARTMENT ──
export async function streamFromDepartment({ departmentId, workerAddress, employerId, workerTitle }) {
  const { data: dept } = await db.from('departments').select('*').eq('id', departmentId).single()
  if (!dept) throw new Error('Department not found')
  const { data: workerWallet } = await db.from('wallets').select('*').eq('address', workerAddress).single()
  if (!workerWallet) throw new Error('Worker wallet not found. Worker must sign up first.')
  const { data: empWallet } = await db.from('wallets').select('*').eq('user_id', employerId).single()
  if (!empWallet) throw new Error('Employer wallet not found')
  const { data: stream, error } = await db.from('streams').insert({
    employer_id:     employerId,
    worker_id:       workerWallet.user_id,
    employer_wallet: empWallet.circle_wallet_id,
    worker_wallet:   workerWallet.circle_wallet_id,
    rate_per_hour:   dept.rate_per_hour,
    department_id:   departmentId,
    company_name:    dept.name,
    worker_title:    workerTitle||'Team Member',
    status:          'active',
    last_payout_at:  new Date().toISOString(),
  }).select().single()
  if (error) throw new Error(error.message)
  return stream
}

// ── GET DEPT WORKERS ──
export async function getDepartmentWorkers(departmentId) {
  const { data: streams, error } = await db.from('streams').select('*')
    .eq('department_id', departmentId).order('created_at', { ascending: false })
  if (error) throw new Error(error.message)
  const enriched = await Promise.all((streams||[]).map(async s => {
    const { data: user } = await db.from('users').select('name,email,job_title,rating,is_admin,admin_permissions').eq('id', s.worker_id).single()
    return { ...s, worker_name: user?.name||s.worker_id.slice(0,8), worker_email: user?.email, job_title: user?.job_title||s.worker_title, rating: user?.rating||5, is_admin: user?.is_admin||false, admin_permissions: user?.admin_permissions||[] }
  }))
  return enriched
}

// ── PERSISTENT PAUSE ──
export async function persistentPauseStream(streamId, pausedBy, reason) {
  const { error } = await db.from('streams').update({
    status: 'paused', paused_by: pausedBy,
    paused_at: new Date().toISOString(), pause_reason: reason||'Paused by admin',
    updated_at: new Date().toISOString(),
  }).eq('id', streamId)
  if (error) throw new Error(error.message)
  return { paused: true, streamId, pausedBy, reason }
}

// ── UPDATE DEPARTMENT ──
export async function updateDepartment(deptId, employerId, updates) {
  const { data, error } = await db.from('departments').update(updates).eq('id', deptId).eq('employer_id', employerId).select().single()
  if (error) throw new Error(error.message)
  return data
}

// ── DELETE DEPARTMENT ──
export async function deleteDepartment(deptId, employerId) {
  await db.from('streams').update({ status:'stopped' }).eq('department_id', deptId)
  const { error } = await db.from('departments').delete().eq('id', deptId).eq('employer_id', employerId)
  if (error) throw new Error(error.message)
  return { deleted: true }
}

// ── RATE WORKER ──
export async function rateWorker({ employerId, workerId, rating, comment, period }) {
  const { data, error } = await db.from('worker_ratings').insert({
    employer_id: employerId, worker_id: workerId, rating,
    comment: comment||'', period: period||new Date().toISOString().slice(0,7),
  }).select().single()
  if (error) throw new Error(error.message)
  const { data: all } = await db.from('worker_ratings').select('rating').eq('worker_id', workerId)
  if (all?.length) {
    const avg = all.reduce((s,r)=>s+parseFloat(r.rating),0)/all.length
    await db.from('users').update({ rating: avg.toFixed(1) }).eq('id', workerId)
  }
  return data
}

// ── PAYROLL REPORT ──
export async function generatePayrollReport(employerId, periodStart, periodEnd) {
  const depts = await listDepartments(employerId)
  const report = []
  for (const dept of depts) {
    const { data: streams } = await db.from('streams').select('id,total_paid,rate_per_hour,status').eq('department_id', dept.id)
    const streamIds = new Set((streams||[]).map(s=>s.id))
    const { data: payouts } = await db.from('payouts').select('amount_usdc,stream_id').gte('created_at', periodStart).lte('created_at', periodEnd)
    const deptPayouts = (payouts||[]).filter(p=>streamIds.has(p.stream_id))
    const total = deptPayouts.reduce((s,p)=>s+parseFloat(p.amount_usdc||0),0)
    const liveRate = (streams||[]).filter(s=>s.status==='active').reduce((s,x)=>s+parseFloat(x.rate_per_hour||0),0)
    report.push({
      department: dept.name, is_admin_dept: dept.is_admin_dept,
      workers: dept.worker_count, active: dept.active_count,
      pending: dept.pending_count||0,
      total_usdc: total, total_aed: total*3.6725,
      budget: dept.budget_monthly,
      budget_used_pct: dept.budget_monthly ? ((total/dept.budget_monthly)*100).toFixed(1) : null,
      live_rate_per_hour: liveRate,
    })
  }
  return {
    employer_id: employerId, period_start: periodStart, period_end: periodEnd,
    departments: report, grand_total: report.reduce((s,r)=>s+r.total_usdc,0),
    generated_at: new Date().toISOString(),
  }
}

// src/services/departmentService.js - v2 Premium
import { db } from '../config/db.js'

function generateInviteCode(name) {
  const slug = name.toLowerCase().replace(/[^a-z0-9]/g,'').slice(0,8)
  const rand = Math.random().toString(36).slice(2,7)
  return slug+'-'+rand
}

// ── CREATE DEPARTMENT ──
export async function createDepartment({ employerId, name, description, ratePerHour, budgetMonthly, color, isAdminDept }) {
  const inviteCode = generateInviteCode(name)
  const { data, error } = await db.from('departments').insert({
    employer_id:    employerId,
    name,
    description:    description||'',
    rate_per_hour:  ratePerHour,
    budget_monthly: budgetMonthly||null,
    invite_code:    inviteCode,
    color:          color||'#C87A10',
    is_admin_dept:  isAdminDept||false,
    cached_member_count: 0,
    cached_total_streaming: 0,
  }).select().single()
  if (error) throw new Error('Failed to create department: '+error.message)
  console.log('[Dept] Created:', name, '| invite:', inviteCode, '| admin dept:', isAdminDept)
  return data
}

// ── LIST DEPARTMENTS (with cached metrics for speed) ──
export async function listDepartments(employerId) {
  const { data, error } = await db
    .from('departments').select('*')
    .eq('employer_id', employerId)
    .order('is_admin_dept', { ascending: false })
    .order('created_at', { ascending: true })
  if (error) throw new Error(error.message)

  // Enrich with live stream data in parallel
  const enriched = await Promise.all((data||[]).map(async dept => {
    const { data: streams } = await db
      .from('streams').select('worker_id,total_paid,status,rate_per_hour')
      .eq('department_id', dept.id)
    const workers   = streams?.length||0
    const active    = streams?.filter(s=>s.status==='active').length||0
    const paused    = streams?.filter(s=>s.status==='paused').length||0
    const totalPaid = streams?.reduce((s,x)=>s+parseFloat(x.total_paid||0),0)||0
    const liveRate  = streams?.filter(s=>s.status==='active').reduce((s,x)=>s+parseFloat(x.rate_per_hour||0),0)||0
    // Update cache
    await db.from('departments').update({
      cached_member_count:     workers,
      cached_total_streaming:  totalPaid,
    }).eq('id', dept.id)
    return { ...dept, worker_count:workers, active_count:active, paused_count:paused, total_paid:totalPaid, live_rate_per_hour:liveRate }
  }))
  return enriched
}

// ── GET DEPARTMENT BY INVITE CODE ──
export async function getDepartmentByInviteCode(inviteCode) {
  const { data, error } = await db.from('departments').select('*').eq('invite_code', inviteCode).single()
  if (error||!data) throw new Error('Invalid invite code')
  const { data: employer } = await db.from('users').select('name,email').eq('id', data.employer_id).single()
  return { ...data, employer_name: employer?.name||'Unknown Employer' }
}

// ── JOIN DEPARTMENT ──
export async function joinDepartment({ userId, inviteCode, jobTitle }) {
  const dept = await getDepartmentByInviteCode(inviteCode)
  const { error } = await db.from('users').update({
    department_id: dept.id,
    job_title:     jobTitle||'Team Member',
    invite_code:   inviteCode,
    employer_id:   dept.employer_id,
    is_admin:      dept.is_admin_dept||false,
    admin_permissions: dept.is_admin_dept ? ['pause_stream','resume_stream','view_reports'] : [],
  }).eq('id', userId)
  if (error) throw new Error('Failed to join department: '+error.message)

  // Auto-create stream at department rate if employer has funds
  if (dept.rate_per_hour && dept.employer_id) {
    try {
      const { data: empWallet } = await db.from('wallets').select('*').eq('user_id', dept.employer_id).single()
      const { data: workerWallet } = await db.from('wallets').select('*').eq('user_id', userId).single()
      if (empWallet && workerWallet && parseFloat(empWallet.balance_usdc||0) >= dept.rate_per_hour) {
        await db.from('streams').insert({
          employer_id:     dept.employer_id,
          worker_id:       userId,
          employer_wallet: empWallet.circle_wallet_id,
          worker_wallet:   workerWallet.circle_wallet_id,
          rate_per_hour:   dept.rate_per_hour,
          department_id:   dept.id,
          company_name:    dept.name,
          worker_title:    jobTitle||'Team Member',
          status:          'active',
          last_payout_at:  new Date().toISOString(),
        })
        console.log('[Dept] Auto-stream created for', userId, 'in', dept.name)
      }
    } catch(e) { console.warn('[Dept] Auto-stream failed:', e.message) }
  }
  return { department: dept, job_title: jobTitle }
}

// ── STREAM DIRECTLY FROM DEPARTMENT ──
export async function streamFromDepartment({ departmentId, workerAddress, employerId, workerTitle }) {
  const { data: dept } = await db.from('departments').select('*').eq('id', departmentId).single()
  if (!dept) throw new Error('Department not found')

  // Find worker by address
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

// ── GET DEPARTMENT WORKERS ──
export async function getDepartmentWorkers(departmentId) {
  const { data: streams, error } = await db
    .from('streams').select('*').eq('department_id', departmentId).order('created_at', { ascending: false })
  if (error) throw new Error(error.message)

  // Enrich with user data
  const enriched = await Promise.all((streams||[]).map(async s => {
    const { data: user } = await db.from('users').select('name,email,job_title,rating,is_admin,admin_permissions').eq('id', s.worker_id).single()
    return { ...s, worker_name: user?.name||s.worker_id.slice(0,8), worker_email: user?.email, job_title: user?.job_title||s.worker_title, rating: user?.rating||5, is_admin: user?.is_admin||false, admin_permissions: user?.admin_permissions||[] }
  }))
  return enriched
}

// ── PERSISTENT PAUSE (survives restart) ──
export async function persistentPauseStream(streamId, pausedBy, reason) {
  const { error } = await db.from('streams').update({
    status:       'paused',
    paused_by:    pausedBy,
    paused_at:    new Date().toISOString(),
    pause_reason: reason||'Paused by admin',
    updated_at:   new Date().toISOString(),
  }).eq('id', streamId)
  if (error) throw new Error(error.message)
  console.log('[Stream] Persistently paused:', streamId, 'by', pausedBy)
  return { paused: true, streamId, pausedBy, reason }
}

// ── ADMIN PAUSE (workers with pause permission) ──
export async function adminPauseStream(streamId, adminUserId, reason) {
  // Verify admin has permission
  const { data: admin } = await db.from('users').select('is_admin,admin_permissions,employer_id').eq('id', adminUserId).single()
  if (!admin?.is_admin) throw new Error('Insufficient permissions')
  if (!admin.admin_permissions?.includes('pause_stream')) throw new Error('Admin does not have pause_stream permission')
  return persistentPauseStream(streamId, adminUserId, reason||'Paused by department admin')
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
  const { data: allRatings } = await db.from('worker_ratings').select('rating').eq('worker_id', workerId)
  if (allRatings?.length) {
    const avg = allRatings.reduce((s,r)=>s+parseFloat(r.rating),0)/allRatings.length
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
    const { data: payouts } = await db.from('payouts').select('amount_usdc,created_at').gte('created_at', periodStart).lte('created_at', periodEnd)
    const streamIds = new Set((streams||[]).map(s=>s.id))
    const deptPayouts = (payouts||[]).filter(p=>streamIds.has(p.stream_id))
    const total = deptPayouts.reduce((s,p)=>s+parseFloat(p.amount_usdc||0),0)
    const liveRate = (streams||[]).filter(s=>s.status==='active').reduce((s,x)=>s+parseFloat(x.rate_per_hour||0),0)
    report.push({
      department: dept.name, is_admin_dept: dept.is_admin_dept,
      workers: dept.worker_count, active: dept.active_count,
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

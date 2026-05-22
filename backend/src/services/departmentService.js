// src/services/departmentService.js
import { db }    from '../config/db.js'
import { v4 as uuid } from 'uuid'

function generateInviteCode(deptName, employerId) {
  const slug = deptName.toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 8)
  const rand = Math.random().toString(36).slice(2, 7)
  return slug + '-' + rand
}

export async function createDepartment({
  employerId, name, description, ratePerHour, budgetMonthly, color
}) {
  const inviteCode = generateInviteCode(name, employerId)

  const { data, error } = await db.from('departments').insert({
    employer_id:    employerId,
    name,
    description:    description || '',
    rate_per_hour:  ratePerHour,
    budget_monthly: budgetMonthly || null,
    invite_code:    inviteCode,
    color:          color || '#C87A10',
  }).select().single()

  if (error) throw new Error('Failed to create department: ' + error.message)
  console.log(`[Dept] Created: ${name} | code: ${inviteCode}`)
  return data
}

export async function listDepartments(employerId) {
  const { data, error } = await db
    .from('departments')
    .select('*')
    .eq('employer_id', employerId)
    .order('created_at', { ascending: true })

  if (error) throw new Error(error.message)

  // For each department get worker count and total paid
  const enriched = await Promise.all((data || []).map(async dept => {
    const { data: streams } = await db
      .from('streams')
      .select('worker_id, total_paid, status')
      .eq('department_id', dept.id)

    const workers    = streams?.length || 0
    const active     = streams?.filter(s => s.status === 'active').length || 0
    const totalPaid  = streams?.reduce((s, x) => s + parseFloat(x.total_paid || 0), 0) || 0

    return { ...dept, worker_count: workers, active_count: active, total_paid: totalPaid }
  }))

  return enriched
}

export async function getDepartmentByInviteCode(inviteCode) {
  const { data, error } = await db
    .from('departments')
    .select('*, users!departments_employer_id_fkey(name)')
    .eq('invite_code', inviteCode)
    .single()

  if (error || !data) throw new Error('Invalid invite code')

  // Get employer name separately
  const { data: employer } = await db
    .from('users')
    .select('name, email')
    .eq('id', data.employer_id)
    .single()

  return { ...data, employer_name: employer?.name || 'Unknown Employer' }
}

export async function joinDepartment({ userId, inviteCode, jobTitle }) {
  // Find department
  const dept = await getDepartmentByInviteCode(inviteCode)

  // Update user with department and job title
  const { error } = await db
    .from('users')
    .update({
      department_id: dept.id,
      job_title:     jobTitle || 'Team Member',
      invite_code:   inviteCode,
    })
    .eq('id', userId)

  if (error) throw new Error('Failed to join department: ' + error.message)

  console.log(`[Dept] User ${userId} joined department ${dept.name}`)
  return { department: dept, job_title: jobTitle }
}

export async function getDepartmentWorkers(departmentId) {
  // Get all streams in this department
  const { data: streams, error } = await db
    .from('streams')
    .select('*, users!streams_worker_id_fkey(name, email, job_title, rating)')
    .eq('department_id', departmentId)
    .order('created_at', { ascending: false })

  if (error) throw new Error(error.message)
  return streams || []
}

export async function updateDepartment(deptId, employerId, updates) {
  const { data, error } = await db
    .from('departments')
    .update(updates)
    .eq('id', deptId)
    .eq('employer_id', employerId)
    .select()
    .single()

  if (error) throw new Error('Failed to update department: ' + error.message)
  return data
}

export async function deleteDepartment(deptId, employerId) {
  // Stop all streams in dept first
  await db.from('streams')
    .update({ status: 'stopped' })
    .eq('department_id', deptId)

  const { error } = await db
    .from('departments')
    .delete()
    .eq('id', deptId)
    .eq('employer_id', employerId)

  if (error) throw new Error('Failed to delete department: ' + error.message)
  return { deleted: true }
}

export async function rateWorker({ employerId, workerId, rating, comment, period }) {
  // Upsert rating for this period
  const { data, error } = await db.from('worker_ratings').insert({
    employer_id: employerId,
    worker_id:   workerId,
    rating,
    comment:     comment || '',
    period:      period || new Date().toISOString().slice(0, 7),
  }).select().single()

  if (error) throw new Error('Failed to rate worker: ' + error.message)

  // Update average rating on user
  const { data: allRatings } = await db
    .from('worker_ratings')
    .select('rating')
    .eq('worker_id', workerId)

  if (allRatings?.length) {
    const avg = allRatings.reduce((s, r) => s + parseFloat(r.rating), 0) / allRatings.length
    await db.from('users').update({ rating: avg.toFixed(1) }).eq('id', workerId)
  }

  return data
}

export async function generatePayrollReport(employerId, periodStart, periodEnd) {
  const depts = await listDepartments(employerId)
  const report = []

  for (const dept of depts) {
    const { data: payouts } = await db
      .from('payouts')
      .select('amount_usdc, created_at, stream_id')
      .gte('created_at', periodStart)
      .lte('created_at', periodEnd)

    const { data: streams } = await db
      .from('streams')
      .select('worker_id, rate_per_hour, company_name, worker_title')
      .eq('department_id', dept.id)

    const deptTotal = payouts?.reduce((s, p) => s + parseFloat(p.amount_usdc || 0), 0) || 0

    report.push({
      department:   dept.name,
      workers:      streams?.length || 0,
      total_usdc:   deptTotal,
      total_aed:    deptTotal * 3.6725,
      budget:       dept.budget_monthly,
      budget_used:  dept.budget_monthly ? ((deptTotal / dept.budget_monthly) * 100).toFixed(1) : null,
    })
  }

  return {
    employer_id:  employerId,
    period_start: periodStart,
    period_end:   periodEnd,
    departments:  report,
    grand_total:  report.reduce((s, r) => s + r.total_usdc, 0),
    generated_at: new Date().toISOString(),
  }
}

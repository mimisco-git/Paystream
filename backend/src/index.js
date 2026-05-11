// src/index.js
// -------------------------------------------------------
// PayStream Backend — Entry Point
//
// Boots the Express server, starts the nanopayment cron,
// and starts the AI stream monitor agent.
// -------------------------------------------------------
import 'dotenv/config'
import express from 'express'
import cors    from 'cors'
import routes  from './routes/index.js'
import { startPayoutCron }   from './jobs/payoutCron.js'
import { startAgentMonitor } from './services/agentService.js'

const app  = express()
const PORT = process.env.PORT || 4000

// -------------------------------------------------------
// Middleware
// -------------------------------------------------------
app.use(cors({
  origin: [
    process.env.FRONTEND_URL || 'http://localhost:3000',
    'http://localhost:3001',
  ],
  credentials: true,
}))
app.use(express.json())

// Request logger (lightweight, no dependency needed)
app.use((req, _res, next) => {
  console.log(`[${new Date().toISOString()}] ${req.method} ${req.path}`)
  next()
})

// -------------------------------------------------------
// Routes
// -------------------------------------------------------
app.use('/api/v1', routes)

// 404 handler
app.use((_req, res) => res.status(404).json({ error: 'Route not found' }))

// Error handler
app.use((err, _req, res, _next) => {
  console.error('[Server Error]', err)
  res.status(500).json({ error: 'Internal server error' })
})

// -------------------------------------------------------
// Start
// -------------------------------------------------------
app.listen(PORT, () => {
  console.log(`
  ╔═══════════════════════════════════════╗
  ║         PayStream Backend             ║
  ║  Real-time USDC salary streaming      ║
  ║  Built on Arc · Powered by Circle     ║
  ╠═══════════════════════════════════════╣
  ║  Server:   http://localhost:${PORT}      ║
  ║  Network:  ARC-TESTNET                ║
  ║  Health:   /api/v1/health             ║
  ╚═══════════════════════════════════════╝
  `)

  // Boot the nanopayment cron (every 60s)
  startPayoutCron()

  // Boot the AI agent monitor (every 5min)
  startAgentMonitor()
})

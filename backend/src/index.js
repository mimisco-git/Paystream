// src/index.js
import 'dotenv/config'
import express  from 'express'
import cors     from 'cors'
import routes   from './routes/index.js'
import webhooks from './routes/webhooks.js'
import { startPayoutCron }   from './jobs/payoutCron.js'
import { startAgentMonitor } from './services/agentService.js'

const app  = express()
const PORT = process.env.PORT || 4000

app.use(cors({
  origin: [
    process.env.FRONTEND_URL || 'http://localhost:3000',
    'http://localhost:3001',
  ],
  credentials: true,
}))

app.use('/webhooks', express.json({ type: '*/*' }))
app.use(express.json())

app.use((req, _res, next) => {
  console.log(`[${new Date().toISOString()}] ${req.method} ${req.path}`)
  next()
})

app.use('/api/v1',   routes)
app.use('/webhooks', webhooks)

app.use((_req, res) => res.status(404).json({ error: 'Route not found' }))
app.use((err, _req, res, _next) => {
  console.error('[Server Error]', err)
  res.status(500).json({ error: 'Internal server error' })
})

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
  ║  Webhooks: /webhooks/circle           ║
  ╚═══════════════════════════════════════╝
  `)
  startPayoutCron()
  startAgentMonitor()
})

// debug-tx.js — run with: node --input-type=module < debug-tx.js
import { initiateDeveloperControlledWalletsClient } from '@circle-fin/developer-controlled-wallets'
import { v4 as uuid } from 'uuid'
import dotenv from 'dotenv'
dotenv.config()

const client = initiateDeveloperControlledWalletsClient({
  apiKey:       process.env.CIRCLE_API_KEY,
  entitySecret: process.env.CIRCLE_ENTITY_SECRET,
})

try {
  const res = await client.createTransaction({
    idempotencyKey:     uuid(),
    walletId:           '1e57dbff-9660-5696-a762-2c8e12604982',
    blockchain:         'ARC-TESTNET',
    tokenAddress:       '0x3600000000000000000000000000000000000000',
    destinationAddress: '0xad376bfb8ed6d7e971daf4fd25c046ebddde27a1',
    amounts:            ['0.050000'],
    fee: { type: 'level', config: { feeLevel: 'LOW' } },
  })

  console.log('FULL RESPONSE DATA:')
  console.log(JSON.stringify(res.data, null, 2))
  console.log('\nres.data.transaction:', res.data?.transaction)
  console.log('res.data.id:', res.data?.id)
  console.log('res.data keys:', Object.keys(res.data || {}))
} catch (err) {
  console.log('ERROR:', JSON.stringify(err?.response?.data, null, 2))
  console.log('MESSAGE:', err.message)
}

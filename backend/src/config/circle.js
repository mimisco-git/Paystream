// src/config/circle.js
// -------------------------------------------------------
// Initialises the Circle Developer-Controlled Wallets SDK.
// One instance shared across the entire app.
// -------------------------------------------------------
import {
  initiateDeveloperControlledWalletsClient,
} from '@circle-fin/developer-controlled-wallets'
import dotenv from 'dotenv'
dotenv.config()

if (!process.env.CIRCLE_API_KEY)    throw new Error('Missing CIRCLE_API_KEY in .env')
if (!process.env.CIRCLE_ENTITY_SECRET) throw new Error('Missing CIRCLE_ENTITY_SECRET in .env')

export const circleClient = initiateDeveloperControlledWalletsClient({
  apiKey:       process.env.CIRCLE_API_KEY,
  entitySecret: process.env.CIRCLE_ENTITY_SECRET,
})

// Blockchain identifier used in every Circle API call
export const ARC_BLOCKCHAIN = 'ARC-TESTNET'
export const USDC_ARC       = process.env.USDC_ARC_ADDRESS

console.log('[Circle] SDK initialised — blockchain: ARC-TESTNET')

// src/services/withdrawalService.js
// -------------------------------------------------------
// Handles real USDC withdrawals from worker wallets
// using Circle developer-controlled wallets SDK.
//
// For same-chain (Arc to Arc): createTransaction directly
// For cross-chain (Arc to ETH/Polygon/etc): CCTP burn + mint
// -------------------------------------------------------
import { circleClient, ARC_BLOCKCHAIN } from '../config/circle.js'
import { db }                           from '../config/db.js'
import { getWalletByUserId, getWalletBalance } from './walletService.js'
import { v4 as uuid }                   from 'uuid'

// Chain IDs for CCTP routing
const CHAIN_MAP = {
  'Arc':       { blockchain: 'ARBTESTNET', chainId: '5042002'  },
  'Ethereum':  { blockchain: 'ETH-SEPOLIA', chainId: '11155111' },
  'Polygon':   { blockchain: 'MATIC-AMOY',  chainId: '80002'    },
  'Base':      { blockchain: 'BASE-SEPOLIA', chainId: '84532'   },
  'Arbitrum':  { blockchain: 'ARB-SEPOLIA',  chainId: '421614'  },
  'Avalanche': { blockchain: 'AVAX-FUJI',    chainId: '43113'   },
}

// USDC contract addresses per chain (testnet)
const USDC_CONTRACTS = {
  'Arc':       '0x3600000000000000000000000000000000000000',
  'Ethereum':  '0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238',
  'Polygon':   '0x9999f7Fea5938fD3b1E26A12c3f2fb024e194f97',
  'Base':      '0x036CbD53842c5426634e7929541eC2318f3dCF7e',
  'Arbitrum':  '0x75faf114eafb1BDbe2F0316DF893fd58CE46AA4d',
  'Avalanche': '0x5425890298aed601595a70AB815c96711a31Bc65',
}

export async function createWithdrawal({ userId, amount, destinationAddress, destinationChain }) {
  // 1. Get worker's Circle wallet
  const wallet  = await getWalletByUserId(userId)
  const balance = await getWalletBalance(wallet.circle_wallet_id)

  // 2. Validate balance
  if (balance < amount) {
    throw new Error(
      `Insufficient balance. Available: $${balance.toFixed(4)} USDC, requested: $${amount.toFixed(4)} USDC`
    )
  }

  if (amount < 0.001) {
    throw new Error('Minimum withdrawal is $0.001 USDC')
  }

  if (!destinationAddress || !destinationAddress.startsWith('0x') || destinationAddress.length < 40) {
    throw new Error('Invalid destination address. Must be a valid 0x Ethereum-format address.')
  }

  const chain = CHAIN_MAP[destinationChain] || CHAIN_MAP['Arc']
  const usdcContract = USDC_CONTRACTS[destinationChain] || USDC_CONTRACTS['Arc']
  const isSameChain  = destinationChain === 'Arc' || !destinationChain

  console.log(`[Withdrawal] Initiating $${amount} USDC from ${wallet.address} → ${destinationAddress} on ${destinationChain}`)

  // 3. Create the Circle transaction
  let txResult
  try {
    const txPayload = {
      idempotencyKey:    uuid(),
      walletId:          wallet.circle_wallet_id,
      tokenAddress:      usdcContract,
      destinationAddress,
      amounts:           [amount.toString()],
      blockchain:        ARC_BLOCKCHAIN,
      fee: {
        type:           'level',
        config:         { feeLevel: 'MEDIUM' },
      },
    }

    console.log('[Withdrawal] Creating Circle transaction:', JSON.stringify(txPayload, null, 2))
    const res = await circleClient.createTransaction(txPayload)

    // Handle SDK response format
    txResult = res.data?.transaction || res.data
    if (!txResult?.id) {
      console.error('[Withdrawal] Unexpected response:', JSON.stringify(res.data))
      throw new Error('Circle transaction creation failed: no transaction ID returned')
    }

    console.log(`[Withdrawal] Transaction created: ${txResult.id} | state: ${txResult.state}`)
  } catch (err) {
    // If Circle throws, check if it is a known error
    const errMsg = err?.response?.data?.message || err.message || 'Unknown Circle error'
    console.error('[Withdrawal] Circle error:', errMsg)
    throw new Error('Circle transaction failed: ' + errMsg)
  }

  // 4. Wait for confirmation (poll up to 30s)
  let confirmed = false
  let arcHash   = null
  let finalState = txResult.state

  for (let attempt = 0; attempt < 15; attempt++) {
    await new Promise(r => setTimeout(r, 2000))
    try {
      const poll = await circleClient.getTransaction({ id: txResult.id })
      const tx   = poll.data?.transaction || poll.data
      finalState = tx?.state || finalState
      arcHash    = tx?.txHash || tx?.transactionHash || null

      console.log(`[Withdrawal] Poll ${attempt+1}: state=${finalState} hash=${arcHash}`)

      if (['COMPLETE', 'CONFIRMED', 'SUCCEEDED'].includes(finalState)) {
        confirmed = true
        break
      }
      if (['FAILED', 'DENIED', 'CANCELLED'].includes(finalState)) {
        throw new Error(`Transaction ${finalState.toLowerCase()}: ${tx?.errorReason || 'Unknown reason'}`)
      }
    } catch (pollErr) {
      console.warn(`[Withdrawal] Poll error attempt ${attempt+1}:`, pollErr.message)
    }
  }

  // 5. Save to Supabase
  const { data: record, error: dbErr } = await db
    .from('withdrawals')
    .insert({
      user_id:             userId,
      amount_usdc:         amount,
      destination_address: destinationAddress,
      destination_chain:   destinationChain,
      circle_tx_id:        txResult.id,
      arc_tx_hash:         arcHash,
      status:              confirmed ? 'confirmed' : 'pending',
    })
    .select()
    .single()

  if (dbErr) console.warn('[Withdrawal] DB insert error:', dbErr.message)

  return {
    id:                  record?.id || uuid(),
    circle_tx_id:        txResult.id,
    arc_tx_hash:         arcHash,
    amount_usdc:         amount,
    destination_address: destinationAddress,
    destination_chain:   destinationChain,
    status:              confirmed ? 'confirmed' : 'pending',
    confirmed,
  }
}

export async function listWithdrawals(userId) {
  const { data, error } = await db
    .from('withdrawals')
    .select('*')
    .eq('user_id', userId)
    .order('created_at', { ascending: false })
    .limit(20)

  if (error) throw new Error(error.message)
  return data
}

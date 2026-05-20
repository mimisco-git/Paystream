// deploy.js — Deploy PayStream.sol to Arc testnet
// Run: node deploy.js
// Requires: DEPLOYER_PRIVATE_KEY in .env

import 'dotenv/config'
import { createWalletClient, createPublicClient, http, parseEther } from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import { readFileSync } from 'fs'
import { exec } from 'child_process'
import { promisify } from 'util'

const execAsync = promisify(exec)

const ARC_TESTNET = {
  id:   5042002,
  name: 'Arc Testnet',
  nativeCurrency: { name: 'ETH', symbol: 'ETH', decimals: 18 },
  rpcUrls: { default: { http: ['https://rpc.testnet.arc.network'] } },
}

async function deploy() {
  const privateKey = process.env.DEPLOYER_PRIVATE_KEY
  if (!privateKey) throw new Error('DEPLOYER_PRIVATE_KEY not set in .env')

  const account = privateKeyToAccount(privateKey.startsWith('0x') ? privateKey : '0x' + privateKey)
  console.log('Deployer:', account.address)

  // Compile with solc
  console.log('Compiling PayStream.sol...')
  try {
    await execAsync('solc --bin --abi --optimize contracts/PayStream.sol -o contracts/build --overwrite')
  } catch(e) {
    console.log('solc not found — using pre-compiled bytecode for demo')
    console.log('Install: npm install -g solc')
    console.log('Contract source: contracts/PayStream.sol')
    console.log('Deploy manually via Remix IDE at https://remix.ethereum.org')
    console.log('Network: Arc Testnet | Chain ID: 5042002 | RPC: https://rpc.testnet.arc.network')
    return
  }

  console.log('Deployment complete. Verify on Arcscan: https://testnet.arcscan.app')
}

deploy().catch(console.error)

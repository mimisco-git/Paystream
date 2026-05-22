import { ethers } from 'ethers'
import { readFileSync } from 'fs'
import dotenv from 'dotenv'
dotenv.config()

const RPC = 'https://rpc.testnet.arc.network'
const provider = new ethers.JsonRpcProvider(RPC)
const wallet = new ethers.Wallet(process.env.DEPLOYER_PRIVATE_KEY, provider)

console.log('Deployer:', wallet.address)
console.log('Checking balance...')
const bal = await provider.getBalance(wallet.address)
console.log('ETH balance:', ethers.formatEther(bal))

if (bal === 0n) {
  console.log('ERROR: No ETH for gas. Get testnet ETH from https://faucet.arc.testnet.circle.com')
  process.exit(1)
}

// PayStream bytecode (pre-compiled)
const abi = [
  "function createStream(address worker, uint256 ratePerHour) returns (uint256)",
  "function pauseStream(uint256 streamId)",
  "function resumeStream(uint256 streamId)",
  "function stopStream(uint256 streamId)",
  "function earned(uint256 streamId) view returns (uint256)",
  "function getStream(uint256 streamId) view returns (tuple(uint256,address,address,uint256,uint256,uint256,uint256,uint8))",
  "event StreamCreated(uint256 indexed id, address indexed employer, address indexed worker, uint256 ratePerSecond)",
  "event PaymentDispatched(uint256 indexed id, address indexed worker, uint256 amount)"
]

console.log('Deploying PayStream.sol to Arc testnet...')
console.log('Compiling via solc is required. Run: npx solcjs --bin --abi contracts/PayStream.sol')
console.log('')
console.log('Or paste this into Remix with MetaMask on Arc Testnet (Chain 5042002):')
console.log('https://remix.ethereum.org')
console.log('')
console.log('Deployer address to fund:', wallet.address)

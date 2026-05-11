// scripts/deploy.js
// -------------------------------------------------------
// Deploys PayStream.sol to Arc testnet.
// Run: npm run deploy
//
// Before running:
//   1. Add DEPLOYER_PRIVATE_KEY to backend/.env
//      (the private key of a funded Arc testnet wallet)
//   2. Get testnet ETH from: https://faucet.arc.testnet.circle.com
//   3. Run: npm run deploy
//
// After deploying, copy the contract address into:
//   backend/.env as PAYSTREAM_CONTRACT_ADDRESS
// -------------------------------------------------------
import hre from "hardhat";

const USDC_ARC_TESTNET = "0x3600000000000000000000000000000000000000";

async function main() {
  const [deployer] = await hre.ethers.getSigners();
  console.log("Deploying PayStream.sol with account:", deployer.address);

  const balance = await hre.ethers.provider.getBalance(deployer.address);
  console.log("Account balance:", hre.ethers.formatEther(balance), "ETH");

  const PayStream = await hre.ethers.getContractFactory("PayStream");
  const paystream = await PayStream.deploy(USDC_ARC_TESTNET);
  await paystream.waitForDeployment();

  const address = await paystream.getAddress();
  console.log("\nPayStream deployed to Arc testnet:", address);
  console.log("USDC address used:", USDC_ARC_TESTNET);
  console.log("\nAdd this to backend/.env:");
  console.log("PAYSTREAM_CONTRACT_ADDRESS=" + address);
  console.log("\nView on Arcscan:");
  console.log("https://explorer.arc.testnet.circle.com/address/" + address);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

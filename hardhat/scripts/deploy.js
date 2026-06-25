// Deploys both contracts (required + advanced tracks).
// Usage: npx hardhat run scripts/deploy.js --network ritual

const hre = require("hardhat");

async function main() {
  const { ethers, network } = hre;
  const [deployer] = await ethers.getSigners();
  const balance = await ethers.provider.getBalance(deployer.address);

  console.log("network :", network.name);
  console.log("deployer:", deployer.address);
  console.log("balance :", ethers.formatEther(balance), "ETH");
  console.log("---");

  console.log("deploying PrivacyPreservingBountyJudge ...");
  const Required = await ethers.getContractFactory("PrivacyPreservingBountyJudge");
  const required = await Required.deploy();
  await required.waitForDeployment();
  const requiredAddr = await required.getAddress();
  const requiredTx = required.deploymentTransaction();
  console.log("  address:", requiredAddr);
  console.log("  tx hash:", requiredTx ? requiredTx.hash : "(local)");

  console.log("deploying RitualHiddenBountyJudge ...");
  const Advanced = await ethers.getContractFactory("RitualHiddenBountyJudge");
  const advanced = await Advanced.deploy();
  await advanced.waitForDeployment();
  const advancedAddr = await advanced.getAddress();
  const advancedTx = advanced.deploymentTransaction();
  console.log("  address:", advancedAddr);
  console.log("  tx hash:", advancedTx ? advancedTx.hash : "(local)");

  console.log("---");
  console.log("submit these on the proof-of-building form:");
  console.log("  required contract:", requiredAddr);
  console.log("  required tx hash :", requiredTx ? requiredTx.hash : "(local)");
  console.log("  advanced contract:", advancedAddr);
  console.log("  advanced tx hash :", advancedTx ? advancedTx.hash : "(local)");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

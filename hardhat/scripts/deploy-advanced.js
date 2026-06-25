// Deploys only the advanced track contract.
// Used when the first deploy succeeded but the second hit a nonce race.
// Usage: npx hardhat run scripts/deploy-advanced.js --network ritual

const hre = require("hardhat");

async function main() {
  const { ethers, network } = hre;
  const [deployer] = await ethers.getSigners();
  const balance = await ethers.provider.getBalance(deployer.address);

  console.log("network :", network.name);
  console.log("deployer:", deployer.address);
  console.log("balance :", ethers.formatEther(balance), "ETH");
  console.log("---");

  console.log("deploying RitualHiddenBountyJudge ...");
  const Advanced = await ethers.getContractFactory("RitualHiddenBountyJudge");
  const advanced = await Advanced.deploy();
  await advanced.waitForDeployment();
  const advancedAddr = await advanced.getAddress();
  const advancedTx = advanced.deploymentTransaction();
  console.log("  address:", advancedAddr);
  console.log("  tx hash:", advancedTx ? advancedTx.hash : "(local)");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

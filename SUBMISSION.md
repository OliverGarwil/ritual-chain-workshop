# Submission — Privacy-Preserving AI Bounty Judge

## Team

This submission was built by a team of two. Both members contributed to the
design, contracts, tests, and documentation.

| Member  | GitHub                                            | Discord        |
|---------|---------------------------------------------------|----------------|
| Oliver  | [@OliverGarwil](https://github.com/OliverGarwil)  | OliverGarwil   |
| Nixx    | [@nixx66](https://github.com/nixx66)              | nixx66         |

Deployer wallet (Ritual testnet): `0xD3eD96eA2cc979F9F2792047C28807Bd20DA3947`

---


This fork upgrades the Ritual Academy workshop project (`hardhat/contracts/AIJudge.sol`)
to keep submissions hidden until judging completes.

## Tracks

Both tracks are implemented.

### Required: Commit-reveal

- Contract: [`hardhat/contracts/PrivacyPreservingBountyJudge.sol`](hardhat/contracts/PrivacyPreservingBountyJudge.sol)
- Tests:    [`hardhat/test/PrivacyPreservingBountyJudge.test.js`](hardhat/test/PrivacyPreservingBountyJudge.test.js) — 9 cases
- Function signatures match the homework spec exactly:
  - `submitCommitment(uint256 bountyId, bytes32 commitment)`
  - `revealAnswer(uint256 bountyId, string calldata answer, bytes32 salt)`
  - `judgeAll(uint256 bountyId, bytes calldata llmInput)`
  - `finalizeWinner(uint256 bountyId, uint256 winnerIndex)`
- Commitment formula matches the homework spec exactly:
  - `keccak256(abi.encodePacked(answer, salt, msg.sender, bountyId))`
- Deployed to Ritual testnet (chain id 1979)
  - Address: `0xe7Ac1dF37b2a4788666ECe9905bb99ac3E8eeEB8`
  - Tx hash: `0x3b814d59b6790b576552e714047b798dcd88dc152016df008ca304490c5c89a3`
  - Explorer: https://explorer.ritualfoundation.org/address/0xe7Ac1dF37b2a4788666ECe9905bb99ac3E8eeEB8

### Advanced: Ritual TEE hidden submissions

- Contract: [`hardhat/contracts/RitualHiddenBountyJudge.sol`](hardhat/contracts/RitualHiddenBountyJudge.sol)
- Tests:    [`hardhat/test/RitualHiddenBountyJudge.test.js`](hardhat/test/RitualHiddenBountyJudge.test.js) — 7 cases
- Deployed to Ritual testnet (chain id 1979)
  - Address: `0x99D493FE1b91CE949303F19B5517EcDf4d9f8fCa`
  - Tx hash: `0xa093a2e3538673cb38e87e6c385110437aac76bded24ba3fe7a1cd456a424a33`
  - Explorer: https://explorer.ritualfoundation.org/address/0x99D493FE1b91CE949303F19B5517EcDf4d9f8fCa

## Documentation

- [`ARCHITECTURE_NOTE.md`](ARCHITECTURE_NOTE.md) — required vs advanced design
- [`TEST_PLAN.md`](TEST_PLAN.md) — reveal-case matrix for both tracks
- [`REFLECTION.md`](REFLECTION.md) — homework reflection
- [`DEMO_GUIDE.md`](DEMO_GUIDE.md) — short reviewer walkthrough
- [`docs/TEE_DESIGN.md`](docs/TEE_DESIGN.md) — deep-dive into the advanced design
- [`docs/BATCH_JUDGING_FLOW.md`](docs/BATCH_JUDGING_FLOW.md) — one-LLM-call rule
- [`docs/DATA_FLOW.md`](docs/DATA_FLOW.md) — on-chain vs off-chain table

## What's left untouched

- `hardhat/contracts/AIJudge.sol` — original workshop contract (kept for diff context)
- `web/` — original workshop frontend
- All other original workshop files

## How to run

```bash
cd hardhat
npm install
npx hardhat test
```

Both contracts compile under Solidity 0.8.24 with `viaIR: true` and all 16
tests pass locally.

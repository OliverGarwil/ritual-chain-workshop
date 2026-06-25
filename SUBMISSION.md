# Submission — Privacy-Preserving AI Bounty Judge

This fork upgrades the Ritual Academy workshop project (`hardhat/contracts/AIJudge.sol`)
to keep submissions hidden until judging completes.

## Tracks

Both tracks are implemented.

### Required: Commit-reveal

- Contract: [`hardhat/contracts/PrivacyPreservingBountyJudge.sol`](hardhat/contracts/PrivacyPreservingBountyJudge.sol)
- Tests:    [`hardhat/test/PrivacyPreservingBountyJudge.test.js`](hardhat/test/PrivacyPreservingBountyJudge.test.js) — 9 cases
- Deployed to Ritual testnet (chain id 1979)
  - Address: `0x6157493d7473Fa1e369290241430BCadD68e6E22`
  - Tx hash: `0x9f15e2fb438700aee250da88203f82ce9bd2a5f0bfea0c69e4fb065361c4d1a3`
  - Explorer: https://explorer.ritualfoundation.org/address/0x6157493d7473Fa1e369290241430BCadD68e6E22

### Advanced: Ritual TEE hidden submissions

- Contract: [`hardhat/contracts/RitualHiddenBountyJudge.sol`](hardhat/contracts/RitualHiddenBountyJudge.sol)
- Tests:    [`hardhat/test/RitualHiddenBountyJudge.test.js`](hardhat/test/RitualHiddenBountyJudge.test.js) — 7 cases
- Deployed to Ritual testnet (chain id 1979)
  - Address: `0x190b74650b88C0F048cd4166006F1Cb6c52d21fF`
  - Tx hash: `0x2f9ff75c0979d9a4ff03720562749d13449a81b11ca4d946feeaf1c39ad876bc`
  - Explorer: https://explorer.ritualfoundation.org/address/0x190b74650b88C0F048cd4166006F1Cb6c52d21fF

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

Both contracts compile under Solidity 0.8.24 with `viaIR: true` and all 16 tests
pass locally.

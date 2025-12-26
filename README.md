# Cipher Vault

Cipher Vault is a privacy-preserving ETH collateral vault that lets users borrow confidential cUSDT on Zama FHEVM. It keeps collateral and debt amounts encrypted on-chain while still enforcing collateral limits and enabling repay and withdrawal flows.

## Overview
Cipher Vault combines an ETH-backed lending vault with a confidential ERC7984 token. Collateral and debt amounts are tracked as encrypted `euint64` values. Users can stake ETH, borrow cUSDT within a fixed collateral ratio, repay by sending confidential tokens back to the vault, and withdraw ETH when their debt is cleared.

## Problems Solved
- On-chain lending positions are usually transparent, exposing user balances and risk profiles.
- Users want borrowing and repayment flows that preserve privacy without relying on trusted servers.
- Confidential transfers should still allow the protocol to enforce collateralization rules.

Cipher Vault solves these by using FHE to store and compute on encrypted balances directly on-chain.

## Key Features
- Encrypted collateral tracking (`euint64`) with on-chain verification.
- Encrypted debt tracking and minting of confidential cUSDT.
- Private repay flow via `confidentialTransferAndCall`.
- Fixed collateral ratio enforced on-chain (no off-chain price feed).
- User-side decryption for balances with Zama FHEVM tooling.

## Advantages
- Privacy by design: collateral and debt are encrypted at rest and in computation.
- Simple, auditable logic with deterministic rules and no hidden off-chain logic.
- ERC7984 token integration for confidential balances and transfers.
- Clear separation between vault logic and token issuance.
- Production-aligned stack: Hardhat + FHEVM + Vite + React.

## System Design
### Contracts
- `CipherVault`: Accepts ETH, tracks encrypted collateral and debt, enforces borrow limits, and handles repayment.
- `ConfidentialUSDT`: ERC7984 confidential token with a vault-controlled minter.

### Data Model
- Collateral is stored as both plaintext wei and encrypted micro-ETH.
- Debt is stored as encrypted micro-USDT.
- 1 micro-ETH = 1e12 wei.
- Borrow limit: `MAX_BORROW_MICRO_USDT_PER_MICRO_ETH = 1000`.

### Flow Summary
1. **Stake**: User stakes ETH in multiples of `1e12` wei; encrypted collateral is updated.
2. **Borrow**: User submits an encrypted amount; the vault mints at most the available headroom.
3. **Repay**: User sends confidential cUSDT to the vault, which burns the applied amount.
4. **Withdraw**: User withdraws ETH after reducing their collateral.

## Tech Stack
- **Smart contracts**: Solidity 0.8.27, Hardhat, hardhat-deploy
- **Confidential compute**: Zama FHEVM, OpenZeppelin Confidential Contracts (ERC7984)
- **Frontend**: React + Vite
- **Wallet and RPC**: RainbowKit + wagmi + viem (reads) + ethers (writes)
- **Testing**: Hardhat tests with FHEVM helpers

## Repository Structure
```
.
├── contracts/          # Solidity contracts
├── deploy/             # Deployment scripts
├── tasks/              # Hardhat tasks (export, stake, borrow, repay, decrypt)
├── test/               # Test suites
├── home/               # Frontend (Vite + React)
├── docs/               # Zama integration docs
└── hardhat.config.ts   # Hardhat configuration
```

## Getting Started
### Prerequisites
- Node.js 20+
- npm

### Install
```bash
npm install
```

### Environment
Create a `.env` file in the project root with:
```
INFURA_API_KEY=your_infura_key
PRIVATE_KEY=your_deployer_private_key
ETHERSCAN_API_KEY=optional
```
Notes:
- Deployment uses a private key (not a mnemonic).
- Hardhat loads `.env` via `dotenv` in `hardhat.config.ts`.

### Compile and Test
```bash
npm run compile
npm run test
```

### Local Deployment (for testing)
```bash
npx hardhat node
npx hardhat deploy --network localhost
```

### Sepolia Deployment
```bash
npx hardhat deploy --network sepolia
npx hardhat verify --network sepolia <CIPHER_VAULT_ADDRESS>
```

### Export Frontend ABI and Addresses
The frontend reads ABI and addresses from `home/src/config/contracts.ts`. After a deployment, regenerate it from `deployments/<network>`:
```bash
npx hardhat vault:export-frontend --network sepolia
```

## Hardhat Tasks
- `npx hardhat vault:addresses --network <network>`
- `npx hardhat vault:stake --eth 0.01 --network <network>`
- `npx hardhat vault:borrow --amount 123456 --network <network>`
- `npx hardhat vault:repay --amount 123456 --network <network>`
- `npx hardhat vault:decrypt --user <address> --network <network>`

## Frontend Usage
```bash
cd home
npm install
npm run dev
```
Notes:
- The app expects Sepolia by default and uses a public RPC.
- Contract addresses and ABIs must be exported with `vault:export-frontend`.
- Reads are performed with `viem`, writes with `ethers`.

## Limitations
- Fixed collateral ratio (no dynamic pricing).
- No liquidation or interest rate logic.
- Only ETH collateral and cUSDT debt are supported.
- Borrowed and repaid amounts are in micro units (6 decimals).

## Future Plans
- Dynamic collateral ratio with an oracle-driven price feed.
- Liquidation and health factor monitoring.
- Interest accrual and configurable risk parameters.
- Multi-collateral support and additional confidential assets.
- Enhanced analytics and user-side privacy tooling.

## License
BSD-3-Clause-Clear. See `LICENSE`.

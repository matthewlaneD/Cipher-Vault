#!/usr/bin/env bash
set -euo pipefail

node -e "require('dotenv').config(); if (!process.env.PRIVATE_KEY) { console.error('Missing PRIVATE_KEY in .env'); process.exit(1); }"

npm test
npx hardhat deploy --network sepolia
npx hardhat --network sepolia vault:addresses
npx hardhat --network sepolia vault:export-frontend

echo "Done. Frontend config updated at home/src/config/contracts.ts"

import { useMemo, useState } from 'react';
import { useAccount, useReadContract } from 'wagmi';
import { Contract, formatEther, parseEther } from 'ethers';

import { Header } from './Header';
import { useEthersSigner } from '../hooks/useEthersSigner';
import { useZamaInstance } from '../hooks/useZamaInstance';
import {
  CIPHER_VAULT_ABI,
  CIPHER_VAULT_ADDRESS,
  CONFIDENTIAL_USDT_ABI,
  CONFIDENTIAL_USDT_ADDRESS,
  WEI_PER_MICRO_ETH,
} from '../config/contracts';
import { decryptU64, parseUnits6, toUnits6String } from '../lib/fhe';
import '../styles/VaultApp.css';

type TxState = 'idle' | 'signing' | 'pending' | 'confirmed' | 'error';

export function VaultApp() {
  const { address, isConnected } = useAccount();
  const signerPromise = useEthersSigner();
  const { instance, isLoading: zamaLoading, error: zamaError } = useZamaInstance();

  const [stakeEth, setStakeEth] = useState('0.01');
  const [withdrawEth, setWithdrawEth] = useState('0.005');
  const [borrowUsdt, setBorrowUsdt] = useState('10');
  const [repayUsdt, setRepayUsdt] = useState('5');

  const [txState, setTxState] = useState<TxState>('idle');
  const [txHash, setTxHash] = useState<string>('');
  const [txError, setTxError] = useState<string>('');

  const [decryptedCollateralMicroEth, setDecryptedCollateralMicroEth] = useState<bigint | null>(null);
  const [decryptedDebtMicroUsdt, setDecryptedDebtMicroUsdt] = useState<bigint | null>(null);
  const [decryptedCusdtBalance, setDecryptedCusdtBalance] = useState<bigint | null>(null);

  const hasAddresses = true

  const vaultReadEnabled = Boolean(isConnected && address && hasAddresses);

  const collateralWeiRead = useReadContract({
    address: CIPHER_VAULT_ADDRESS,
    abi: CIPHER_VAULT_ABI,
    functionName: 'collateralWeiOf',
    args: address ? [address] : undefined,
    query: { enabled: vaultReadEnabled },
  });

  const collateralEncRead = useReadContract({
    address: CIPHER_VAULT_ADDRESS,
    abi: CIPHER_VAULT_ABI,
    functionName: 'collateralMicroEthOf',
    args: address ? [address] : undefined,
    query: { enabled: vaultReadEnabled },
  });

  const debtEncRead = useReadContract({
    address: CIPHER_VAULT_ADDRESS,
    abi: CIPHER_VAULT_ABI,
    functionName: 'debtMicroUsdtOf',
    args: address ? [address] : undefined,
    query: { enabled: vaultReadEnabled },
  });

  const cusdtBalEncRead = useReadContract({
    address: CONFIDENTIAL_USDT_ADDRESS,
    abi: CONFIDENTIAL_USDT_ABI,
    functionName: 'confidentialBalanceOf',
    args: address ? [address] : undefined,
    query: { enabled: vaultReadEnabled },
  });

  const collateralWei = (collateralWeiRead.data as bigint | undefined) ?? 0n;
  const collateralEth = useMemo(() => formatEther(collateralWei), [collateralWei]);

  const canDecrypt =
    Boolean(instance && signerPromise && address) &&
    collateralEncRead.data &&
    debtEncRead.data &&
    cusdtBalEncRead.data;

  const resetTx = () => {
    setTxState('idle');
    setTxHash('');
    setTxError('');
  };

  const withTx = async (fn: () => Promise<{ hash: string; wait: () => Promise<any> }>) => {
    resetTx();
    try {
      setTxState('signing');
      const tx = await fn();
      setTxHash(tx.hash);
      setTxState('pending');
      await tx.wait();
      setTxState('confirmed');
    } catch (e) {
      setTxState('error');
      setTxError(e instanceof Error ? e.message : 'Transaction failed');
    }
  };

  const ensureMicroEthWei = (wei: bigint) => {
    if (wei <= 0n) throw new Error('Amount must be > 0');
    if (wei % BigInt(WEI_PER_MICRO_ETH) !== 0n) {
      throw new Error(`Amount must be a multiple of ${WEI_PER_MICRO_ETH} wei`);
    }
  };

  const handleDecrypt = async () => {
    if (!instance || !signerPromise || !address) return;

    const signer = await signerPromise;
    const collateralHandle = collateralEncRead.data as `0x${string}`;
    const debtHandle = debtEncRead.data as `0x${string}`;
    const balanceHandle = cusdtBalEncRead.data as `0x${string}`;

    const [collateral, debt, balance] = await Promise.all([
      decryptU64(instance, signer, collateralHandle, CIPHER_VAULT_ADDRESS, address),
      decryptU64(instance, signer, debtHandle, CIPHER_VAULT_ADDRESS, address),
      decryptU64(instance, signer, balanceHandle, CONFIDENTIAL_USDT_ADDRESS, address),
    ]);

    setDecryptedCollateralMicroEth(collateral);
    setDecryptedDebtMicroUsdt(debt);
    setDecryptedCusdtBalance(balance);
  };

  const handleStake = async () => {
    if (!signerPromise || !hasAddresses) return;
    await withTx(async () => {
      const signer = await signerPromise;
      const value = parseEther(stakeEth);
      ensureMicroEthWei(value);
      const vault = new Contract(CIPHER_VAULT_ADDRESS, CIPHER_VAULT_ABI, signer);
      return vault.stake({ value });
    });
  };

  const handleWithdraw = async () => {
    if (!signerPromise || !hasAddresses) return;
    await withTx(async () => {
      const signer = await signerPromise;
      const value = parseEther(withdrawEth);
      ensureMicroEthWei(value);
      const vault = new Contract(CIPHER_VAULT_ADDRESS, CIPHER_VAULT_ABI, signer);
      return vault.withdraw(value);
    });
  };

  const handleBorrow = async () => {
    if (!instance || !address || !signerPromise || !hasAddresses) return;
    await withTx(async () => {
      const signer = await signerPromise;
      const amount = parseUnits6(borrowUsdt);
      const encrypted = await instance.createEncryptedInput(CIPHER_VAULT_ADDRESS, address).add64(amount).encrypt();
      const vault = new Contract(CIPHER_VAULT_ADDRESS, CIPHER_VAULT_ABI, signer);
      return vault.borrow(encrypted.handles[0], encrypted.inputProof);
    });
  };

  const handleRepay = async () => {
    if (!instance || !address || !signerPromise || !hasAddresses) return;
    await withTx(async () => {
      const signer = await signerPromise;
      const amount = parseUnits6(repayUsdt);
      const encrypted = await instance
        .createEncryptedInput(CONFIDENTIAL_USDT_ADDRESS, address)
        .add64(amount)
        .encrypt();
      const token = new Contract(CONFIDENTIAL_USDT_ADDRESS, CONFIDENTIAL_USDT_ABI, signer);
      return token['confidentialTransferAndCall(address,bytes32,bytes,bytes)'](
        CIPHER_VAULT_ADDRESS,
        encrypted.handles[0],
        encrypted.inputProof,
        '0x',
      );
    });
  };

  const decryptedCollateralEth = useMemo(() => {
    if (decryptedCollateralMicroEth === null) return '—';
    const intPart = decryptedCollateralMicroEth / 1_000_000n;
    const frac = decryptedCollateralMicroEth % 1_000_000n;
    return `${intPart}.${frac.toString().padStart(6, '0')}`;
  }, [decryptedCollateralMicroEth]);

  return (
    <div className="vault-page">
      <Header />

      <main className="vault-main">
        <div className="vault-shell">
          <section className="vault-hero">
            <h2 className="vault-title">Cipher Vault</h2>
            <p className="vault-subtitle">Stake ETH, borrow encrypted cUSDT, repay, and withdraw.</p>
          </section>

          {!hasAddresses && (
            <div className="vault-banner vault-banner--warn">
              Deploy and export the addresses/ABIs with: `npx hardhat deploy --network sepolia` then
              `npx hardhat vault:export-frontend --network sepolia`.
            </div>
          )}

          {zamaError && <div className="vault-banner vault-banner--error">{zamaError}</div>}

          <section className="vault-grid">
            <div className="vault-card">
              <h3 className="vault-card-title">Account</h3>
              <div className="vault-row">
                <span className="vault-label">Connected</span>
                <span className="vault-value">{isConnected ? 'Yes' : 'No'}</span>
              </div>
              <div className="vault-row">
                <span className="vault-label">Address</span>
                <span className="vault-value vault-mono">{address ?? '—'}</span>
              </div>
              <div className="vault-row">
                <span className="vault-label">Relayer</span>
                <span className="vault-value">{zamaLoading ? 'Initializing…' : 'Ready'}</span>
              </div>
            </div>

            <div className="vault-card">
              <h3 className="vault-card-title">Positions</h3>
              <div className="vault-row">
                <span className="vault-label">Collateral (ETH, onchain)</span>
                <span className="vault-value">{collateralEth}</span>
              </div>
              <div className="vault-row">
                <span className="vault-label">Collateral (ETH, decrypted)</span>
                <span className="vault-value">{decryptedCollateralEth}</span>
              </div>
              <div className="vault-row">
                <span className="vault-label">Debt (USDT, decrypted)</span>
                <span className="vault-value">
                  {decryptedDebtMicroUsdt === null ? '—' : toUnits6String(decryptedDebtMicroUsdt)}
                </span>
              </div>
              <div className="vault-row">
                <span className="vault-label">cUSDT balance (decrypted)</span>
                <span className="vault-value">
                  {decryptedCusdtBalance === null ? '—' : toUnits6String(decryptedCusdtBalance)}
                </span>
              </div>
              <button className="vault-btn" onClick={handleDecrypt} disabled={!canDecrypt}>
                Decrypt
              </button>
              <div className="vault-hint vault-mono">
                Collateral handle: {collateralEncRead.data ? String(collateralEncRead.data) : '—'}
              </div>
              <div className="vault-hint vault-mono">Debt handle: {debtEncRead.data ? String(debtEncRead.data) : '—'}</div>
              <div className="vault-hint vault-mono">
                Balance handle: {cusdtBalEncRead.data ? String(cusdtBalEncRead.data) : '—'}
              </div>
            </div>
          </section>

          <section className="vault-actions">
            <div className="vault-card">
              <h3 className="vault-card-title">Stake ETH</h3>
              <div className="vault-input-row">
                <input
                  className="vault-input"
                  value={stakeEth}
                  onChange={(e) => setStakeEth(e.target.value)}
                  placeholder="0.01"
                  inputMode="decimal"
                />
                <button className="vault-btn vault-btn--primary" onClick={handleStake} disabled={!isConnected || txState === 'pending'}>
                  Stake
                </button>
              </div>
              <div className="vault-hint">Amount must be a multiple of 0.000001 ETH.</div>
            </div>

            <div className="vault-card">
              <h3 className="vault-card-title">Borrow cUSDT</h3>
              <div className="vault-input-row">
                <input
                  className="vault-input"
                  value={borrowUsdt}
                  onChange={(e) => setBorrowUsdt(e.target.value)}
                  placeholder="10"
                  inputMode="decimal"
                />
                <button
                  className="vault-btn vault-btn--primary"
                  onClick={handleBorrow}
                  disabled={!isConnected || !instance || txState === 'pending'}
                >
                  Borrow
                </button>
              </div>
              <div className="vault-hint">Borrow amount is encrypted before sending.</div>
            </div>

            <div className="vault-card">
              <h3 className="vault-card-title">Repay cUSDT</h3>
              <div className="vault-input-row">
                <input
                  className="vault-input"
                  value={repayUsdt}
                  onChange={(e) => setRepayUsdt(e.target.value)}
                  placeholder="5"
                  inputMode="decimal"
                />
                <button
                  className="vault-btn vault-btn--primary"
                  onClick={handleRepay}
                  disabled={!isConnected || !instance || txState === 'pending'}
                >
                  Repay
                </button>
              </div>
              <div className="vault-hint">Uses confidential transfer with callback to apply repayment.</div>
            </div>

            <div className="vault-card">
              <h3 className="vault-card-title">Withdraw ETH</h3>
              <div className="vault-input-row">
                <input
                  className="vault-input"
                  value={withdrawEth}
                  onChange={(e) => setWithdrawEth(e.target.value)}
                  placeholder="0.005"
                  inputMode="decimal"
                />
                <button
                  className="vault-btn vault-btn--primary"
                  onClick={handleWithdraw}
                  disabled={!isConnected || txState === 'pending'}
                >
                  Withdraw
                </button>
              </div>
              <div className="vault-hint">Amount must be a multiple of 0.000001 ETH.</div>
            </div>
          </section>

          <section className="vault-tx">
            <div className="vault-card">
              <h3 className="vault-card-title">Transaction</h3>
              <div className="vault-row">
                <span className="vault-label">State</span>
                <span className="vault-value">{txState}</span>
              </div>
              <div className="vault-row">
                <span className="vault-label">Hash</span>
                <span className="vault-value vault-mono">{txHash || '—'}</span>
              </div>
              {txError && <div className="vault-banner vault-banner--error vault-mono">{txError}</div>}
              <button className="vault-btn" onClick={resetTx} disabled={txState === 'pending'}>
                Clear
              </button>
            </div>
          </section>
        </div>
      </main>
    </div>
  );
}

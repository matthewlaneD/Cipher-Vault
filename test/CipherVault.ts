import { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/signers";
import { FhevmType } from "@fhevm/hardhat-plugin";
import { expect } from "chai";
import { ethers, fhevm } from "hardhat";
import { CipherVault, CipherVault__factory, ConfidentialUSDT, ConfidentialUSDT__factory } from "../types";

type Signers = {
  deployer: HardhatEthersSigner;
  alice: HardhatEthersSigner;
};

async function deployFixture(deployer: HardhatEthersSigner) {
  const tokenFactory = (await ethers.getContractFactory("ConfidentialUSDT")) as ConfidentialUSDT__factory;
  const token = (await tokenFactory.deploy(deployer.address, deployer.address)) as ConfidentialUSDT;
  const tokenAddress = await token.getAddress();

  const vaultFactory = (await ethers.getContractFactory("CipherVault")) as CipherVault__factory;
  const vault = (await vaultFactory.deploy(tokenAddress)) as CipherVault;
  const vaultAddress = await vault.getAddress();

  await (await token.connect(deployer).setMinter(vaultAddress)).wait();

  return { token, tokenAddress, vault, vaultAddress };
}

describe("CipherVault", function () {
  let signers: Signers;
  let token: ConfidentialUSDT;
  let tokenAddress: string;
  let vault: CipherVault;
  let vaultAddress: string;

  before(async function () {
    const ethSigners: HardhatEthersSigner[] = await ethers.getSigners();
    signers = { deployer: ethSigners[0], alice: ethSigners[1] };
  });

  beforeEach(async function () {
    if (!fhevm.isMock) {
      console.warn(`This hardhat test suite cannot run on Sepolia Testnet`);
      this.skip();
    }

    ({ token, tokenAddress, vault, vaultAddress } = await deployFixture(signers.deployer));
  });

  it("stake -> borrow -> repay -> withdraw", async function () {
    const stakeWei = 10_000_000_000_000_000n; // 0.01 ETH (multiple of 1e12 wei)
    const stakeMicroEth = stakeWei / 1_000_000_000_000n;

    await (await vault.connect(signers.alice).stake({ value: stakeWei })).wait();

    const encryptedCollateral = await vault.collateralMicroEthOf(signers.alice.address);
    const clearCollateral = await fhevm.userDecryptEuint(
      FhevmType.euint64,
      encryptedCollateral,
      vaultAddress,
      signers.alice,
    );
    expect(clearCollateral).to.eq(stakeMicroEth);

    const borrowMicroUsdt = 123_456n;
    const encryptedBorrow = await fhevm
      .createEncryptedInput(vaultAddress, signers.alice.address)
      .add64(borrowMicroUsdt)
      .encrypt();
    await (await vault.connect(signers.alice).borrow(encryptedBorrow.handles[0], encryptedBorrow.inputProof)).wait();

    const encryptedDebt = await vault.debtMicroUsdtOf(signers.alice.address);
    const clearDebt = await fhevm.userDecryptEuint(FhevmType.euint64, encryptedDebt, vaultAddress, signers.alice);
    expect(clearDebt).to.eq(borrowMicroUsdt);

    const encryptedBalance = await token.confidentialBalanceOf(signers.alice.address);
    const clearBalance = await fhevm.userDecryptEuint(
      FhevmType.euint64,
      encryptedBalance,
      tokenAddress,
      signers.alice,
    );
    expect(clearBalance).to.eq(borrowMicroUsdt);

    const repayMicroUsdt = 100_000n;
    const encryptedRepay = await fhevm
      .createEncryptedInput(tokenAddress, signers.alice.address)
      .add64(repayMicroUsdt)
      .encrypt();

    await (
      await token
        .connect(signers.alice)
        ["confidentialTransferAndCall(address,bytes32,bytes,bytes)"](
          vaultAddress,
          encryptedRepay.handles[0],
          encryptedRepay.inputProof,
          "0x",
        )
    ).wait();

    const encryptedDebtAfterRepay = await vault.debtMicroUsdtOf(signers.alice.address);
    const clearDebtAfterRepay = await fhevm.userDecryptEuint(
      FhevmType.euint64,
      encryptedDebtAfterRepay,
      vaultAddress,
      signers.alice,
    );
    expect(clearDebtAfterRepay).to.eq(borrowMicroUsdt - repayMicroUsdt);

    const encryptedBalanceAfterRepay = await token.confidentialBalanceOf(signers.alice.address);
    const clearBalanceAfterRepay = await fhevm.userDecryptEuint(
      FhevmType.euint64,
      encryptedBalanceAfterRepay,
      tokenAddress,
      signers.alice,
    );
    expect(clearBalanceAfterRepay).to.eq(borrowMicroUsdt - repayMicroUsdt);

    const withdrawWei = 5_000_000_000_000_000n; // 0.005 ETH
    const withdrawMicroEth = withdrawWei / 1_000_000_000_000n;

    await (await vault.connect(signers.alice).withdraw(withdrawWei)).wait();

    const collateralWeiAfter = await vault.collateralWeiOf(signers.alice.address);
    expect(collateralWeiAfter).to.eq(stakeWei - withdrawWei);

    const encryptedCollateralAfter = await vault.collateralMicroEthOf(signers.alice.address);
    const clearCollateralAfter = await fhevm.userDecryptEuint(
      FhevmType.euint64,
      encryptedCollateralAfter,
      vaultAddress,
      signers.alice,
    );
    expect(clearCollateralAfter).to.eq(stakeMicroEth - withdrawMicroEth);
  });

  it("caps borrow to collateral-based limit", async function () {
    const stakeWei = 10_000_000_000_000_000n; // 0.01 ETH (multiple of 1e12 wei)
    const stakeMicroEth = stakeWei / 1_000_000_000_000n;
    await (await vault.connect(signers.alice).stake({ value: stakeWei })).wait();

    const requestedBorrowMicroUsdt = 20_000_000n; // 20 USDT (6 decimals)
    const encryptedBorrow = await fhevm
      .createEncryptedInput(vaultAddress, signers.alice.address)
      .add64(requestedBorrowMicroUsdt)
      .encrypt();
    await (await vault.connect(signers.alice).borrow(encryptedBorrow.handles[0], encryptedBorrow.inputProof)).wait();

    const encryptedDebt = await vault.debtMicroUsdtOf(signers.alice.address);
    const clearDebt = await fhevm.userDecryptEuint(FhevmType.euint64, encryptedDebt, vaultAddress, signers.alice);

    const encryptedBalance = await token.confidentialBalanceOf(signers.alice.address);
    const clearBalance = await fhevm.userDecryptEuint(FhevmType.euint64, encryptedBalance, tokenAddress, signers.alice);

    const maxBorrowMicroUsdt = stakeMicroEth * 1000n;
    expect(clearDebt).to.eq(maxBorrowMicroUsdt);
    expect(clearBalance).to.eq(maxBorrowMicroUsdt);
  });
});

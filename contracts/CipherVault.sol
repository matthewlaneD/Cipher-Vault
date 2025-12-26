// SPDX-License-Identifier: BSD-3-Clause-Clear
pragma solidity ^0.8.27;

import {FHE, ebool, euint64, externalEuint64} from "@fhevm/solidity/lib/FHE.sol";
import {ZamaEthereumConfig} from "@fhevm/solidity/config/ZamaConfig.sol";
import {IERC7984Receiver} from "@openzeppelin/confidential-contracts/interfaces/IERC7984Receiver.sol";

import {FHESafeMath} from "@openzeppelin/confidential-contracts/utils/FHESafeMath.sol";

import {ConfidentialUSDT} from "./ConfidentialUSDT.sol";

contract CipherVault is ZamaEthereumConfig, IERC7984Receiver {
    uint256 public constant WEI_PER_MICRO_ETH = 1e12;
    uint64 public constant MAX_BORROW_MICRO_USDT_PER_MICRO_ETH = 1000;

    ConfidentialUSDT public immutable cusdt;

    mapping(address user => uint256) private _collateralWei;
    mapping(address user => euint64) private _collateralMicroEth;
    mapping(address user => euint64) private _debtMicroUsdt;

    event Stake(address indexed user, uint256 weiAmount, uint64 microEthAmount, euint64 encryptedCollateralMicroEth);
    event Withdraw(address indexed user, uint256 weiAmount, uint64 microEthAmount, euint64 encryptedCollateralMicroEth);
    event Borrow(address indexed user, euint64 requestedMicroUsdt, euint64 mintedMicroUsdt, euint64 encryptedDebtMicroUsdt);
    event Repay(address indexed user, euint64 paidMicroUsdt, euint64 appliedMicroUsdt, euint64 encryptedDebtMicroUsdt);

    error InvalidAmount();
    error UnsupportedToken(address token);
    error InsufficientCollateral();
    error EthTransferFailed();

    constructor(address cusdt_) {
        if (cusdt_ == address(0)) revert UnsupportedToken(address(0));
        cusdt = ConfidentialUSDT(cusdt_);
    }

    function collateralWeiOf(address user) external view returns (uint256) {
        return _collateralWei[user];
    }

    function collateralMicroEthOf(address user) external view returns (euint64) {
        return _collateralMicroEth[user];
    }

    function debtMicroUsdtOf(address user) external view returns (euint64) {
        return _debtMicroUsdt[user];
    }

    function stake() external payable {
        if (msg.value == 0) revert InvalidAmount();
        if (msg.value % WEI_PER_MICRO_ETH != 0) revert InvalidAmount();

        uint64 microEthAmount = uint64(msg.value / WEI_PER_MICRO_ETH);
        euint64 encryptedDelta = FHE.asEuint64(microEthAmount);

        _collateralWei[msg.sender] += msg.value;

        (, euint64 updatedCollateral) = FHESafeMath.tryIncrease(_collateralMicroEth[msg.sender], encryptedDelta);
        _collateralMicroEth[msg.sender] = updatedCollateral;

        FHE.allowThis(updatedCollateral);
        FHE.allow(updatedCollateral, msg.sender);

        emit Stake(msg.sender, msg.value, microEthAmount, updatedCollateral);
    }

    function withdraw(uint256 amountWei) external {
        if (amountWei == 0) revert InvalidAmount();
        if (amountWei % WEI_PER_MICRO_ETH != 0) revert InvalidAmount();

        uint256 current = _collateralWei[msg.sender];
        if (current < amountWei) revert InsufficientCollateral();
        unchecked {
            _collateralWei[msg.sender] = current - amountWei;
        }

        uint64 microEthAmount = uint64(amountWei / WEI_PER_MICRO_ETH);
        euint64 encryptedDelta = FHE.asEuint64(microEthAmount);

        (, euint64 updatedCollateral) = FHESafeMath.tryDecrease(_collateralMicroEth[msg.sender], encryptedDelta);
        _collateralMicroEth[msg.sender] = updatedCollateral;

        FHE.allowThis(updatedCollateral);
        FHE.allow(updatedCollateral, msg.sender);

        (bool sent, ) = msg.sender.call{value: amountWei}("");
        if (!sent) revert EthTransferFailed();

        emit Withdraw(msg.sender, amountWei, microEthAmount, updatedCollateral);
    }

    function borrow(externalEuint64 encryptedAmount, bytes calldata inputProof) external returns (euint64 minted) {
        if (_collateralWei[msg.sender] == 0) revert InsufficientCollateral();

        euint64 requested = FHE.fromExternal(encryptedAmount, inputProof);
        FHE.allowThis(requested);

        euint64 storedDebt = _debtMicroUsdt[msg.sender];
        euint64 currentDebt = storedDebt;
        if (euint64.unwrap(storedDebt) == bytes32(0)) {
            currentDebt = FHE.asEuint64(0);
        } else {
            FHE.allowThis(storedDebt);
        }

        euint64 maxDebt = FHE.mul(
            _collateralMicroEth[msg.sender],
            FHE.asEuint64(MAX_BORROW_MICRO_USDT_PER_MICRO_ETH)
        );
        FHE.allowThis(maxDebt);

        ebool hasHeadroom = FHE.ge(maxDebt, currentDebt);
        euint64 headroom = FHE.select(hasHeadroom, FHE.sub(maxDebt, currentDebt), FHE.asEuint64(0));
        minted = FHE.min(requested, headroom);

        (, euint64 updatedDebt) = FHESafeMath.tryIncrease(currentDebt, minted);
        _debtMicroUsdt[msg.sender] = updatedDebt;

        FHE.allowThis(updatedDebt);
        FHE.allow(updatedDebt, msg.sender);

        FHE.allowThis(minted);
        FHE.allow(minted, msg.sender);
        FHE.allow(minted, address(cusdt));
        cusdt.mintEncrypted(msg.sender, minted);

        emit Borrow(msg.sender, requested, minted, updatedDebt);
    }

    function onConfidentialTransferReceived(
        address,
        address from,
        euint64 amount,
        bytes calldata
    ) external returns (ebool) {
        if (msg.sender != address(cusdt)) revert UnsupportedToken(msg.sender);

        euint64 debt = _debtMicroUsdt[from];
        if (euint64.unwrap(debt) == bytes32(0)) {
            debt = FHE.asEuint64(0);
        } else {
            FHE.allowThis(debt);
        }

        ebool debtGeAmount = FHE.ge(debt, amount);
        euint64 applied = FHE.select(debtGeAmount, amount, debt);
        euint64 updatedDebt = FHE.sub(debt, applied);
        euint64 refund = FHE.sub(amount, applied);

        _debtMicroUsdt[from] = updatedDebt;

        FHE.allowThis(updatedDebt);
        FHE.allow(updatedDebt, from);

        FHE.allowThis(applied);
        FHE.allowThis(refund);
        FHE.allow(applied, address(cusdt));
        FHE.allow(refund, address(cusdt));

        cusdt.burnFrom(address(this), applied);
        cusdt.confidentialTransfer(from, refund);

        emit Repay(from, amount, applied, updatedDebt);

        ebool accepted = FHE.asEbool(true);
        FHE.allow(accepted, msg.sender);
        return accepted;
    }
}

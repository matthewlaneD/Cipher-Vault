// SPDX-License-Identifier: BSD-3-Clause-Clear
pragma solidity ^0.8.27;

import {ERC7984} from "@openzeppelin/confidential-contracts/token/ERC7984/ERC7984.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {ZamaEthereumConfig} from "@fhevm/solidity/config/ZamaConfig.sol";
import {FHE, euint64} from "@fhevm/solidity/lib/FHE.sol";

contract ConfidentialUSDT is ERC7984, Ownable, ZamaEthereumConfig {
    address public minter;

    error UnauthorizedMinter(address caller);

    constructor(address owner_, address minter_) ERC7984("cUSDT", "cUSDT", "") Ownable(owner_) {
        minter = minter_;
    }

    function setMinter(address newMinter) external onlyOwner {
        minter = newMinter;
    }

    function mintEncrypted(address to, euint64 encryptedAmount) external {
        if (msg.sender != minter) revert UnauthorizedMinter(msg.sender);
        _mint(to, encryptedAmount);
    }

    function mintClear(address to, uint64 amount) external {
        if (msg.sender != minter) revert UnauthorizedMinter(msg.sender);
        _mint(to, FHE.asEuint64(amount));
    }

    function burnFrom(address from, euint64 encryptedAmount) external {
        if (msg.sender != minter) revert UnauthorizedMinter(msg.sender);
        _burn(from, encryptedAmount);
    }
}

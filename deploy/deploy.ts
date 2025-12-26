import { DeployFunction } from "hardhat-deploy/types";
import { HardhatRuntimeEnvironment } from "hardhat/types";

const func: DeployFunction = async function (hre: HardhatRuntimeEnvironment) {
  const { deployer } = await hre.getNamedAccounts();
  const { deploy, execute } = hre.deployments;

  const deployedCUSDT = await deploy("ConfidentialUSDT", {
    from: deployer,
    args: [deployer, deployer],
    log: true,
  });

  console.log(`ConfidentialUSDT contract: `, deployedCUSDT.address);

  const deployedVault = await deploy("CipherVault", {
    from: deployer,
    args: [deployedCUSDT.address],
    log: true,
  });

  console.log(`CipherVault contract: `, deployedVault.address);

  await execute(
    "ConfidentialUSDT",
    {
      from: deployer,
      log: true,
    },
    "setMinter",
    deployedVault.address,
  );
};
export default func;
func.id = "deploy_cipher_vault"; // id required to prevent reexecution
func.tags = ["CipherVault", "ConfidentialUSDT"];

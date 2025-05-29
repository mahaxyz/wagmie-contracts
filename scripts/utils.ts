import { TransactionReceipt, TransactionResponse } from "ethers";
import { HardhatRuntimeEnvironment } from "hardhat/types";
import fs from "fs";
import path from "path";

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function waitForTx(
  tx: TransactionResponse,
  confirmations = 1
): Promise<TransactionReceipt | null> {
  console.log("waiting for tx", tx.hash);
  return await tx.wait(confirmations);
}

export async function verify(
  hre: HardhatRuntimeEnvironment,
  contractAddress: string,
  constructorArguments: any[] = []
) {
  try {
    console.log(`- Verifying ${contractAddress}`);

    await hre.run("verify:verify", {
      address: contractAddress,
      constructorArguments: constructorArguments,
    });
  } catch (error) {
    console.log("Verify Error: ", contractAddress);
    console.log(error);
  }
}

export async function deployProxy(
  hre: HardhatRuntimeEnvironment,
  implementation: string,
  args: any[],
  proxyAdmin: string,
  name: string,
  sender?: string,
  skipInit = false
) {
  const { deploy, save } = hre.deployments;
  const { deployer } = await hre.getNamedAccounts();

  const implementationD = await deploy(`${implementation}-Impl`, {
    from: deployer,
    contract: implementation,
    skipIfAlreadyDeployed: true,
  });

  const contract = await hre.ethers.getContractAt(
    implementation,
    implementationD.address
  );

  const argsInit = skipInit
    ? "0x"
    : contract.interface.encodeFunctionData("initialize", args);

  const proxy = await deploy(`${name}-Proxy`, {
    from: sender || deployer,
    contract: "MAHAProxy",
    skipIfAlreadyDeployed: true,
    args: [implementationD.address, proxyAdmin, argsInit],
    autoMine: true,
    log: true,
  });

  await save(name, {
    address: proxy.address,
    abi: implementationD.abi,
    args: args,
  });

  if (hre.network.name !== "hardhat") {
    console.log("verifying contracts");
    await hre.run("verify:verify", {
      address: implementationD.address,
      constructorArguments: [],
    });
    await hre.run("verify:verify", {
      address: proxy.address,
      constructorArguments: [implementationD.address, proxyAdmin, argsInit],
    });
  }

  return proxy;
}

export async function upgradeProxy(
  hre: HardhatRuntimeEnvironment,
  args: any[],
  proxyAddress: string,
  newImplementationName: string,
  verifyOnEtherscan = true
) {
  const { deploy, getArtifact } = hre.deployments;
  const { deployer } = await hre.getNamedAccounts();

  try {
    // Deploy the new implementation
    const newImpl = await deploy(`${newImplementationName}-Impl`, {
      from: deployer,
      contract: newImplementationName,
      skipIfAlreadyDeployed: false,
      log: true,
    });

    // Get the proxy contract with the correct interface
    const proxy = await hre.ethers.getContractAt("IMAHAProxy", proxyAddress);
    
    // Get the contract interface for encoding initialization data
    const contract = await hre.ethers.getContractAt(
      newImplementationName,
      proxyAddress
    );

    // Encode initialization data if args are provided
    const argsInit = args.length > 0 
      ? contract.interface.encodeFunctionData("initialize", args)
      : "0x";

    // Upgrade the proxy to the new implementation
    console.log(`Upgrading proxy to new implementation at ${newImpl.address}...`);
    const tx = await proxy.upgradeToAndCall(newImpl.address, argsInit);
    const receipt = await tx.wait();
    if (!receipt) {
      throw new Error("Transaction failed - no receipt received");
    }
    console.log(`Proxy upgraded successfully in tx ${receipt.hash}`);

    // Optionally verify on Etherscan
    if (verifyOnEtherscan && hre.network.name !== "hardhat") {
      console.log("Verifying new implementation on Etherscan...");
      await hre.run("verify:verify", {
        address: newImpl.address,
        constructorArguments: [],
      });
    }

    return {
      proxyAddress,
      newImplementation: newImpl.address,
    };
  } catch (error) {
    console.error("Error upgrading proxy:", error);
    throw error;
  }
}

export async function deployContract(
  hre: HardhatRuntimeEnvironment,
  implementation: string,
  args: any[],
  name: string,
  sender?: string
) {
  console.log("deploying contract", name);
  const { deploy } = hre.deployments;
  const { deployer } = await hre.getNamedAccounts();

  const contract = await deploy(name, {
    from: sender || deployer,
    contract: implementation,
    skipIfAlreadyDeployed: true,
    args: args,
    autoMine: true,
    log: true,
  });

  if (hre.network.name !== "hardhat") {
    console.log("verifying contracts");

    await hre.run("verify:verify", {
      address: contract.address,
      constructorArguments: args,
      // contract: implementation,
    });
  }

  return contract;
}

export const loadTasks = (taskFolders: string[]): void =>
  taskFolders.forEach((folder) => {
    const tasksPath = path.join(__dirname, "../tasks", folder);
    fs.readdirSync(tasksPath)
      .filter((pth) => pth.includes(".ts") || pth.includes(".js"))
      .forEach((task) => {
        require(`${tasksPath}/${task}`);
      });
  });

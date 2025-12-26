import { connectorsForWallets } from '@rainbow-me/rainbowkit';
import { injectedWallet, metaMaskWallet } from '@rainbow-me/rainbowkit/wallets';
import { createConfig, createStorage, http } from 'wagmi';
import { sepolia } from 'wagmi/chains';

const chains = [sepolia] as const;

const projectId = 'YOUR_PROJECT_ID';
const appName = 'Cipher Vault';

const connectors = connectorsForWallets(
  [
    {
      groupName: 'Wallet',
      wallets: [metaMaskWallet, injectedWallet],
    },
  ],
  { projectId, appName },
);

const memoryStorage = {
  getItem: (_key: string) => null,
  setItem: (_key: string, _value: string) => {},
  removeItem: (_key: string) => {},
};

export const config = createConfig({
  chains,
  connectors,
  transports: {
    [sepolia.id]: http('https://ethereum-sepolia-rpc.publicnode.com'),
  },
  ssr: false,
  storage: createStorage({ storage: memoryStorage }),
});

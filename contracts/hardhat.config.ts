import { HardhatUserConfig } from 'hardhat/config';
import '@nomicfoundation/hardhat-toolbox';
import * as dotenv from 'dotenv';

dotenv.config();

const PRIVATE_KEY = process.env.DEPLOYER_PRIVATE_KEY ?? '';
const CELOSCAN_API_KEY = process.env.CELOSCAN_API_KEY ?? '';

const config: HardhatUserConfig = {
  solidity: {
    version: '0.8.27',
    settings: {
      optimizer: { enabled: true, runs: 200 },
      viaIR: true,
      evmVersion: 'cancun',
    },
  },
  paths: {
    sources: './src',
    tests: './test',
  },
  networks: {
    hardhat: {
      chainId: 31337,
    },
    celoSepolia: {
      url: 'https://forno.celo-sepolia.celo-testnet.org',
      chainId: 11142220,
      accounts: PRIVATE_KEY ? [PRIVATE_KEY] : [],
    },
    celo: {
      url: 'https://forno.celo.org',
      chainId: 42220,
      accounts: PRIVATE_KEY ? [PRIVATE_KEY] : [],
    },
  },
  etherscan: {
    apiKey: {
      celoSepolia: CELOSCAN_API_KEY,
      celo: CELOSCAN_API_KEY,
    },
    customChains: [
      {
        network: 'celoSepolia',
        chainId: 11142220,
        urls: {
          apiURL: 'https://api-sepolia.celoscan.io/api',
          browserURL: 'https://celo-sepolia.blockscout.com',
        },
      },
      {
        network: 'celo',
        chainId: 42220,
        urls: {
          apiURL: 'https://api.celoscan.io/api',
          browserURL: 'https://celoscan.io',
        },
      },
    ],
  },
};

export default config;

import { createConfig, http } from 'wagmi'
import { baseSepolia, base } from 'wagmi/chains'
import { injected } from 'wagmi/connectors'

// Chronicle Yellowstone - Lit Protocol's testnet
const chronicleYellowstone = {
  id: 175188,
  name: 'Chronicle Yellowstone',
  network: 'chronicle-yellowstone',
  nativeCurrency: { 
    decimals: 18, 
    name: 'Test LPX', 
    symbol: 'tstLPX' 
  },
  rpcUrls: { 
    default: { http: ['https://yellowstone-rpc.litprotocol.com'] },
    public: { http: ['https://yellowstone-rpc.litprotocol.com'] }
  },
  blockExplorers: { 
    default: { 
      name: 'Explorer', 
      url: 'https://yellowstone-explorer.litprotocol.com' 
    } 
  },
} as const

export const config = createConfig({
  chains: [baseSepolia, base, chronicleYellowstone],
  connectors: [injected({ target: 'metaMask' })],
  multiInjectedProviderDiscovery: false,
  transports: {
    [baseSepolia.id]: http('https://base-sepolia.rpc.ithaca.xyz'),
    [base.id]: http('https://base-mainnet.rpc.ithaca.xyz'),
    [chronicleYellowstone.id]: http('https://yellowstone-rpc.litprotocol.com'),
  },
})

declare module 'wagmi' {
  interface Register {
    config: typeof config
  }
}

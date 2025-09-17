import { useState, useEffect } from 'react'
import { useAccount, useWalletClient, useSwitchChain } from 'wagmi'
import { createLitClient } from '@lit-protocol/lit-client'
import { nagaDev } from '@lit-protocol/networks'
import { createPublicClient, http, formatEther, Chain } from 'viem'
import { createAuthManager, storagePlugins, WalletClientAuthenticator } from "@lit-protocol/auth";

const authManager = createAuthManager({
  storage: storagePlugins.localStorage({
    appName: "my-app",
    networkName: "naga-dev",
  }),
});

type MintWithAuthResult = Awaited<ReturnType<Awaited<ReturnType<typeof createLitClient>>['authService']['mintWithAuth']>> | Awaited<ReturnType<Awaited<ReturnType<typeof createLitClient>>['mintWithEoa']>>;
type LitClientInstance = Awaited<ReturnType<typeof createLitClient>>;

export function LitActionTest() {
  const { address } = useAccount()
  const { data: walletClient } = useWalletClient()
  const { switchChain } = useSwitchChain()
  const [isLoading, setIsLoading] = useState(false)
  const [result, setResult] = useState<string>('')
  const [error, setError] = useState<string>('')
  const [pkpInfo, setPkpInfo] = useState<MintWithAuthResult | null>(null); 
  const [isMinting, setIsMinting] = useState(false)
  const [tstLPXBalance, setTstLPXBalance] = useState<string>('0')
  const [authData, setAuthData] = useState<Awaited<ReturnType<typeof WalletClientAuthenticator.authenticate>> | null>(null)

  // Chronicle Yellowstone config
  const chronicleYellowstone = nagaDev.getChainConfig() as Chain;

  // Balance check
  const checkYellowstoneBalance = async () => {
    if (!address) return
    try {
      const publicClient = createPublicClient({ 
        chain: chronicleYellowstone, 
        transport: http() 
      })
      const balance = await publicClient.getBalance({ 
        address: address as `0x${string}` 
      })
      setTstLPXBalance(formatEther(balance))
      console.log('Chronicle Yellowstone balance:', formatEther(balance), 'tstLPX')
    } catch (err) {
      console.error('Error checking Yellowstone balance:', err)
    }
  }

  useEffect(() => { 
    if (address) checkYellowstoneBalance() 
  }, [address])


  const mintPKP = async () => {
    if (!address || !walletClient) { 
      setError('Wallet not connected')
      return 
    }
    if (parseFloat(tstLPXBalance) === 0) { 
      setError('No tstLPX balance. Get from https://chronicle-yellowstone-faucet.getlit.dev/')
      return 
    }

    setIsMinting(true)
    setError('')
    let litClient: LitClientInstance | null = null

    try {
      console.log('Switching to Chronicle Yellowstone...')
      try { 
        await switchChain({ chainId: 175188 })
        console.log('Chain switched') 
      } catch (switchErr) { 
        console.warn('Switch failed:', switchErr) 
      }

      console.log('Creating Lit Client...')
      litClient = await createLitClient({ network: nagaDev })
      console.log('Lit client ready');

      const authDataResult = await WalletClientAuthenticator.authenticate(walletClient);

      console.log('Auth data:', authDataResult)
      setAuthData(authDataResult)

      // Mint with auth service
      let mintResult: MintWithAuthResult;    
      
      try {
        mintResult = await litClient.authService.mintWithAuth({
          authData: authDataResult,
          authServiceBaseUrl: 'https://naga-auth-service.onrender.com',
          scopes: ['sign-anything'],
        });
        console.log('Auth service mint response:', mintResult)
        setPkpInfo(mintResult);
      } catch (mintErr: any) {
        console.error('Auth service failed:', mintErr)
        console.log('Trying direct mintWithEoa as fallback...')
        mintResult = await litClient.mintWithEoa({ account: walletClient });

        setPkpInfo(mintResult);
      }

      console.log('PKP minted:', mintResult)
      
      localStorage.setItem('litPKPInfo', JSON.stringify(mintResult))
      localStorage.setItem('litAuthData', JSON.stringify(authDataResult))
      setError('')

    } catch (err: any) {
      console.error('Mint error:', err)
      if (err.message?.includes('insufficient funds')) {
        setError(`Insufficient tstLPX for ${address}. Faucet: https://chronicle-yellowstone-faucet.getlit.dev/`)
      } else if (err.message?.includes('switchChain')) {
        setError('Chain switch failed. Check wagmi config.')
      } else if (err.message?.includes('User rejected')) {
        setError('Rejected by user')
      } else {
        setError(`Mint failed: ${err.message}`)
      }
    } finally {
      if (litClient) await litClient.disconnect()
      setIsMinting(false)
    }
  }

  const loadExistingPKP = () => {
    const storedPKP = localStorage.getItem('litPKPInfo')
    const storedAuth = localStorage.getItem('litAuthData')
    if (storedPKP) { 
      const pkp = JSON.parse(storedPKP)
      setPkpInfo(pkp)
      console.log('Loaded PKP:', pkp) 
    }
    if (storedAuth) { 
      const auth = JSON.parse(storedAuth)
      setAuthData(auth)
      console.log('Loaded auth:', auth) 
    }
  }

  const executeLitAction = async () => {
    if (!address || !walletClient || !pkpInfo || !authData) { 
      setError('Missing PKP or authData - mint PKP first.')
      console.log(`Address: ${address} Wallet Client: ${walletClient} PKP Info: ${pkpInfo} Auth Data: ${authData}`)
      return 
    }

    setIsLoading(true)
    setError('')
    setResult('')
    let litClient: Awaited<ReturnType<typeof createLitClient>> | null = null

    try {
      console.log('Creating Lit Client...')
      litClient = await createLitClient({ network: nagaDev })
      console.log('Client ready')

      // Simple test Lit Action that just returns a greeting
      // Replace with your own IPFS hash after uploading simple-lit-action.js
      const litActionIpfsId = 'QmUSu2DGUpFVoLjYqiYpxgDaTKtokQj2Lw3GrLDsAsn8mv' // Placeholder - upload simple-lit-action.js to IPFS
      console.log('PKP pubkey:', pkpInfo.data?.pubkey)
      
      const authContext = await authManager.createPkpAuthContext({
        authData: authData, 
        pkpPublicKey: pkpInfo.data?.pubkey,
        authConfig: {
          resources: [
            ["pkp-signing", "*"],
            ["lit-action-execution", "*"],
          ],
          expiration: new Date(Date.now() + 1000 * 60 * 60 * 24).toISOString(),
          statement:  'Execute Genius Search Lit Action',
          domain: window.location.origin,
        },
        litClient: litClient,
      });

      console.log('AuthContext created with shorthand resources')

      console.log('Executing Lit Action...')

      const litActionResponse = await litClient.executeJs({
        ipfsId: litActionIpfsId,
        authContext,
        jsParams: {
          userAddress: address,
          pkpPublicKey: pkpInfo.data?.pubkey,
        },
      })

      console.log('Response:', litActionResponse)

      if (litActionResponse?.response) {
        const data = typeof litActionResponse.response === 'string' 
          ? JSON.parse(litActionResponse.response) 
          : litActionResponse.response
        setResult(JSON.stringify(data, null, 2))
        console.log('Lit Action executed successfully:', data)
      } else if (litActionResponse?.logs) {
        setResult(JSON.stringify(litActionResponse.logs, null, 2))
      } else {
        setError('No response')
      }

    } catch (err: any) {
      console.error('Execution error:', err)
      if (err.message?.includes('NodeResourceIdNotFound')) {
        setError('Resource not found - IPFS may not be pinned on Naga')
      } else {
        setError(err.message || 'Execution failed')
      }
    } finally {
      if (litClient) await litClient.disconnect()
      setIsLoading(false)
    }
  }

  useEffect(() => { 
    loadExistingPKP() 
  }, [])

  return (
    <div>
      <h2>Lit Protocol v8 Bug Reproduction</h2>
      <div style={{ 
        marginBottom: '15px', 
        padding: '10px', 
        backgroundColor: '#ffebee', 
        border: '1px solid #f44336', 
        borderRadius: '5px', 
        fontSize: '12px' 
      }}>
        <strong>Bug:</strong> SDK generates <code>lit-litaction://[ipfsId]</code> in ReCaps, but nodes expect <code>lit-action://[ipfsId]</code><br/>
        <strong>Result:</strong> NodeSIWECapabilityInvalid error - "Resource id not found in auth_sig capabilities"
      </div>
      
      {/* Balance Display */}
      <div style={{ 
        marginBottom: '10px', 
        padding: '10px', 
        backgroundColor: parseFloat(tstLPXBalance) > 0 ? '#e8f5e9' : '#ffebee', 
        border: `1px solid ${parseFloat(tstLPXBalance) > 0 ? '#4caf50' : '#f44336'}`, 
        borderRadius: '5px', 
        display: 'flex', 
        justifyContent: 'space-between', 
        alignItems: 'center' 
      }}>
        <div>
          <strong>Chronicle Balance:</strong> {tstLPXBalance} tstLPX
          {parseFloat(tstLPXBalance) === 0 && (
            <span style={{ color: '#f44336', fontSize: '12px', display: 'block', marginTop: '5px' }}>
              ⚠️ Get from <a href="https://chronicle-yellowstone-faucet.getlit.dev/" target="_blank" rel="noopener noreferrer">Faucet</a> for {address}
            </span>
          )}
        </div>
        <button 
          onClick={checkYellowstoneBalance} 
          style={{ 
            padding: '6px 12px', 
            backgroundColor: '#2196F3', 
            color: 'white', 
            border: 'none', 
            borderRadius: '3px', 
            cursor: 'pointer', 
            fontSize: '12px' 
          }}
        >
          Refresh
        </button>
      </div>

      <div style={{ 
        marginBottom: '10px', 
        padding: '10px', 
        backgroundColor: '#f0f8ff', 
        border: '1px solid #0066cc', 
        borderRadius: '5px', 
        fontSize: '12px' 
      }}>
        <strong>v8 Flow:</strong> EOA auth (MetaMask SIWE) → Mint PKP → Session delegation (ReCaps for lit-action://IPFS) → Execute.
      </div>

      {/* PKP Section */}
      <div style={{ 
        marginBottom: '15px', 
        padding: '10px', 
        backgroundColor: pkpInfo ? '#e8f5e9' : '#fff3e0', 
        border: `1px solid ${pkpInfo ? '#4caf50' : '#ff9800'}`, 
        borderRadius: '5px' 
      }}>
        <h3 style={{ margin: '0 0 10px 0', fontSize: '16px' }}>
          Step 1: PKP Setup {pkpInfo && '✅'}
        </h3>
        
        {!pkpInfo ? (
          <div>
            <p style={{ fontSize: '12px', margin: '5px 0' }}>
              No PKP found. Mint one (needs tstLPX):
            </p>
            <button 
              onClick={mintPKP} 
              disabled={isMinting || !address || parseFloat(tstLPXBalance) === 0} 
              style={{ 
                padding: '8px 16px', 
                backgroundColor: isMinting ? '#ccc' : '#ff9800', 
                color: 'white', 
                border: 'none', 
                borderRadius: '5px', 
                cursor: (isMinting || !address || parseFloat(tstLPXBalance) === 0) ? 'not-allowed' : 'pointer', 
                marginRight: '10px' 
              }}
            >
              {isMinting ? 'Minting...' : 'Mint PKP with MetaMask'}
            </button>
            <button 
              onClick={loadExistingPKP} 
              style={{ 
                padding: '8px 16px', 
                backgroundColor: '#2196F3', 
                color: 'white', 
                border: 'none', 
                borderRadius: '5px', 
                cursor: 'pointer' 
              }}
            >
              Load Existing PKP
            </button>
          </div>
        ) : (
          <div>
            <p style={{ fontSize: '12px', margin: '5px 0', color: '#4caf50' }}>
              PKP Ready! Public Key: {(pkpInfo.data?.pubkey)?.substring(0, 20)}...
            </p>
            <button 
              onClick={() => { 
                setPkpInfo(null)
                setAuthData(null)
                localStorage.removeItem('litPKPInfo')
                localStorage.removeItem('litAuthData')
              }} 
              style={{ 
                padding: '6px 12px', 
                backgroundColor: '#f44336', 
                color: 'white', 
                border: 'none', 
                borderRadius: '3px', 
                cursor: 'pointer', 
                fontSize: '12px' 
              }}
            >
              Clear PKP
            </button>
          </div>
        )}
      </div>



      {/* Execute Button */}
      <button 
        onClick={executeLitAction} 
        disabled={isLoading || !address || !pkpInfo} 
        style={{ 
          padding: '10px 20px', 
          backgroundColor: (isLoading || !pkpInfo) ? '#ccc' : '#007bff', 
          color: 'white', 
          border: 'none', 
          borderRadius: '5px', 
          cursor: (isLoading || !address || !pkpInfo) ? 'not-allowed' : 'pointer' 
        }}
      >
        {isLoading ? 'Executing...' : 'Step 2: Test Lit Action (Demonstrates v8 Bug)'}
      </button>


      {/* Error Display */}
      {error && (
        <div style={{ 
          marginTop: '10px', 
          padding: '10px', 
          backgroundColor: '#ffebee', 
          border: '1px solid #f44336', 
          borderRadius: '5px', 
          color: '#c62828' 
        }}>
          Error: {error}
        </div>
      )}

      {/* Result Display */}
      {result && (
        <div style={{ marginTop: '10px' }}>
          <h3>Lit Action Result:</h3>
          <pre style={{ 
            backgroundColor: '#f5f5f5', 
            padding: '10px', 
            borderRadius: '5px', 
            overflow: 'auto', 
            maxHeight: '400px', 
            fontSize: '12px' 
          }}>
            {result}
          </pre>
        </div>
      )}
    </div>
  )
}
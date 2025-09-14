import { useState, useEffect } from 'react'
import { useAccount, useWalletClient, useSwitchChain } from 'wagmi'
import { createLitClient } from '@lit-protocol/lit-client'
import { nagaDev } from '@lit-protocol/networks'
import { createPublicClient, http, formatEther } from 'viem'

export function LitActionTest() {
  const { address } = useAccount()
  const { data: walletClient } = useWalletClient()
  const { switchChain } = useSwitchChain()
  const [isLoading, setIsLoading] = useState(false)
  const [result, setResult] = useState<string>('')
  const [searchQuery, setSearchQuery] = useState('Drake')
  const [error, setError] = useState<string>('')
  const [keys, setKeys] = useState<string>('')
  const [pkpInfo, setPkpInfo] = useState<any>(null)
  const [isMinting, setIsMinting] = useState(false)
  const [tstLPXBalance, setTstLPXBalance] = useState<string>('0')
  const [authData, setAuthData] = useState<any>(null)

  // Chronicle Yellowstone network config
  const chronicleYellowstone = {
    id: 175188,
    name: 'Chronicle Yellowstone - Lit Protocol Testnet',
    network: 'chronicle-yellowstone',
    nativeCurrency: {
      decimals: 18,
      name: 'Test LPX',
      symbol: 'tstLPX',
    },
    rpcUrls: {
      default: { http: ['https://yellowstone-rpc.litprotocol.com'] },
      public: { http: ['https://yellowstone-rpc.litprotocol.com'] },
    },
    blockExplorers: {
      default: { name: 'Explorer', url: 'https://yellowstone-explorer.litprotocol.com' },
    },
  }

  // Check Chronicle Yellowstone balance
  const checkYellowstoneBalance = async () => {
    if (!address) return

    try {
      const publicClient = createPublicClient({
        chain: chronicleYellowstone,
        transport: http(),
      })

      const balance = await publicClient.getBalance({
        address: address as `0x${string}`,
      })

      setTstLPXBalance(formatEther(balance))
      console.log('Chronicle Yellowstone balance:', formatEther(balance), 'tstLPX')
    } catch (err) {
      console.error('Error checking Yellowstone balance:', err)
    }
  }

  // Check balance on component mount and when address changes
  useEffect(() => {
    if (address) {
      checkYellowstoneBalance()
    }
  }, [address])

  const checkPortoKeys = async () => {
    if (!address || !walletClient) {
      setError('Wallet not connected')
      return
    }

    try {
      // Check what keys are available in the Porto account
      const keysResult = await (walletClient as any).request({
        method: 'wallet_getKeys',
        params: [{ address, chainId: '0x14a34' }] // Base Sepolia chain ID
      })
      
      console.log('Porto keys:', keysResult)
      setKeys(JSON.stringify(keysResult, null, 2))
    } catch (err: any) {
      console.error('Error getting Porto keys:', err)
      setError(`Failed to get keys: ${err.message}`)
    }
  }

  const mintPKP = async () => {
    if (!address || !walletClient) {
      setError('Wallet not connected')
      return
    }

    if (parseFloat(tstLPXBalance) === 0) {
      setError('No tstLPX balance. Please get test tokens from https://chronicle-yellowstone-faucet.getlit.dev/')
      return
    }

    setIsMinting(true)
    setError('')

    let litClient: any = null

    try {
      // Try to switch to Chronicle Yellowstone
      console.log('Switching to Chronicle Yellowstone chain...')
      try {
        await switchChain({ chainId: 175188 })
        console.log('Chain switched successfully')
      } catch (switchErr: any) {
        console.warn('Chain switch failed, continuing anyway:', switchErr)
      }

      console.log('Creating Lit Client for PKP minting...')
      litClient = await createLitClient({
        network: nagaDev,
      })

      console.log('Lit client created')

      // Step 1: Generate SIWE message and have Porto sign it
      console.log('Creating SIWE message for authentication...')
      const domain = window.location.host
      const uri = window.location.origin
      const statement = 'Sign in to mint a PKP'
      const nonce = Math.random().toString(36).substring(2, 15)
      const issuedAt = new Date().toISOString()
      const expirationTime = new Date(Date.now() + 1000 * 60 * 10).toISOString()
      const chainId = chronicleYellowstone.id
      
      const siweMessage = `${domain} wants you to sign in with your Ethereum account:
${address}

${statement}

URI: ${uri}
Version: 1
Chain ID: ${chainId}
Nonce: ${nonce}
Issued At: ${issuedAt}
Expiration Time: ${expirationTime}`

      console.log('Requesting Porto signature...')
      const signature = await walletClient.signMessage({ 
        message: siweMessage 
      })
      console.log('Porto signed message successfully')

      // Create authData for EthWallet authentication
      const authDataResult = {
        authMethodType: 1, // EthWallet type
        authMethodId: address!.toLowerCase(),
        accessToken: JSON.stringify({
          sig: signature,
          derivedVia: 'web3.eth.personal.sign',
          signedMessage: siweMessage,
          address: address!.toLowerCase(),
        }),
      }
      
      console.log('Auth data generated:', authDataResult)
      setAuthData(authDataResult) // Store for later use in execution

      // Step 2: Use authService to mint PKP (avoids popup issues)
      console.log('Minting PKP via auth service...')
      let mintResult
      try {
        // Use authService.mintWithAuth directly to avoid popup
        mintResult = await litClient.authService.mintWithAuth({
          authData: authDataResult,
          authServiceBaseUrl: 'https://naga-auth-service.onrender.com',
          scopes: ['sign-anything'],
        })
        console.log('Auth service mint response:', mintResult)
        
        // If authService returns a transaction to sign, handle it
        if (mintResult?.txParams) {
          console.log('Signing PKP mint transaction...')
          // Switch back to Chronicle if needed
          await switchChain({ chainId: chronicleYellowstone.id })
          
          // Send the transaction using Porto
          const txHash = await walletClient.sendTransaction({
            ...mintResult.txParams,
            chain: chronicleYellowstone,
          })
          console.log('Transaction sent:', txHash)
          
          // Wait for transaction confirmation
          const publicClient = createPublicClient({
            chain: chronicleYellowstone,
            transport: http(),
          })
          const receipt = await publicClient.waitForTransactionReceipt({ hash: txHash })
          console.log('Transaction confirmed:', receipt)
          
          // Extract PKP info from receipt or response
          mintResult = {
            ...mintResult,
            transactionHash: txHash,
            receipt,
          }
        }
      } catch (mintErr: any) {
        console.error('Auth service mint failed:', mintErr)
        
        // Fallback: Try direct mintWithEoa if auth service fails
        console.log('Trying direct mintWithEoa as last resort...')
        try {
          mintResult = await litClient.mintWithEoa({
            account: walletClient,
          })
        } catch (eoaErr: any) {
          console.error('mintWithEoa also failed:', eoaErr)
          throw mintErr // Re-throw original error
        }
      }

      console.log('PKP minted successfully:', mintResult)
      setPkpInfo(mintResult)
      setError('')

      // Store PKP info for later use
      localStorage.setItem('litPKPInfo', JSON.stringify(mintResult))
      localStorage.setItem('litAuthData', JSON.stringify(authDataResult))

    } catch (err: any) {
      console.error('PKP minting error:', err)
      if (err.message?.includes('insufficient funds')) {
        setError(`Insufficient tstLPX. Get tokens from https://chronicle-yellowstone-faucet.getlit.dev/ for ${address}`)
      } else if (err.message?.includes('switchChain')) {
        setError('Failed to switch to Chronicle Yellowstone. The chain has been added to wagmi config.')
      } else if (err.message?.includes('User rejected')) {
        setError('Transaction rejected by user')
      } else {
        setError(`Failed to mint PKP: ${err.message}`)
      }
    } finally {
      if (litClient) {
        await litClient.disconnect()
      }
      setIsMinting(false)
    }
  }

  const loadExistingPKP = () => {
    const storedPKP = localStorage.getItem('litPKPInfo')
    const storedAuth = localStorage.getItem('litAuthData')
    if (storedPKP) {
      const pkp = JSON.parse(storedPKP)
      setPkpInfo(pkp)
      console.log('Loaded existing PKP:', pkp)
    }
    if (storedAuth) {
      const auth = JSON.parse(storedAuth)
      setAuthData(auth)
      console.log('Loaded existing auth data:', auth)
    }
  }

  const executeLitAction = async () => {
    if (!address || !walletClient) {
      setError('Wallet not connected')
      return
    }

    if (!pkpInfo || !authData) {
      setError('Please mint a PKP first or load an existing one')
      return
    }

    setIsLoading(true)
    setError('')
    setResult('')

    let litClient: any = null

    try {
      console.log('Creating Lit Client for Lit Action execution...')
      litClient = await createLitClient({
        network: nagaDev,
      })

      console.log('Lit client created successfully')

      // Define the Lit Action IPFS ID
      const litActionIpfsId = 'QmUSu2DGUpFVoLjYqiYpxgDaTKtokQj2Lw3GrLDsAsn8mv'

      // Create a simplified authContext for execution
      // Since we don't have AuthManager, we'll use a callback-based approach
      console.log('Creating authContext for execution...')
      const authContext = {
        pkpPublicKey: pkpInfo.publicKey || pkpInfo.pkpPublicKey || pkpInfo.pubkey,
        authData: authData,
        chain: 'baseSepolia',
      }

      console.log('AuthContext created:', authContext)

      console.log('Executing Lit Action with proper authContext...')

      // Execute the Lit Action with PKP-based authContext
      const litActionResponse = await litClient.executeJs({
        ipfsId: litActionIpfsId,
        authContext,
        jsParams: {
          query: searchQuery,
          limit: 5,
          userAddress: address,
          language: navigator.language,
          userAgent: navigator.userAgent,
          sessionId: `web-${address}-${Date.now()}`,
          pkpPublicKey: pkpInfo.publicKey || pkpInfo.pkpPublicKey || pkpInfo.pubkey,
        },
      })

      console.log('Lit Action response:', litActionResponse)

      if (litActionResponse?.response) {
        const responseData = typeof litActionResponse.response === 'string' 
          ? JSON.parse(litActionResponse.response)
          : litActionResponse.response
        setResult(JSON.stringify(responseData, null, 2))
        console.log('Lit Action executed successfully:', responseData)
      } else if (litActionResponse?.logs) {
        setResult(JSON.stringify(litActionResponse.logs, null, 2))
      } else {
        setError('No response from Lit Action')
      }

    } catch (err: any) {
      console.error('Lit Action execution error:', err)
      
      if (err.name === 'ZodError') {
        try {
          const zodErrors = JSON.parse(err.message)
          setError(`Validation error: ${zodErrors[0]?.message || 'Invalid parameters at ' + zodErrors[0]?.path?.join('.')}`)
        } catch {
          setError('Parameter validation failed. Check the authContext structure.')
        }
      } else {
        setError(err.message || 'Failed to execute Lit Action')
      }
    } finally {
      if (litClient) {
        await litClient.disconnect()
      }
      setIsLoading(false)
    }
  }

  // Try to load existing PKP on component mount
  useEffect(() => {
    loadExistingPKP()
  }, [])

  return (
    <div>
      <h2>Genius Search Lit Action Test</h2>
      
      {/* Chronicle Yellowstone Balance Display */}
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
          <strong>Chronicle Yellowstone Balance:</strong> {tstLPXBalance} tstLPX
          {parseFloat(tstLPXBalance) === 0 && (
            <span style={{ color: '#f44336', fontSize: '12px', display: 'block', marginTop: '5px' }}>
              ⚠️ You need test tokens to mint a PKP. Get them from the faucet below.
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
          Refresh Balance
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
        <strong>Lit Protocol v8 Setup:</strong>
        <ol style={{ margin: '5px 0', paddingLeft: '20px' }}>
          <li>First, get test tokens from the <a href="https://chronicle-yellowstone-faucet.getlit.dev/" target="_blank" rel="noopener noreferrer">Chronicle Yellowstone Faucet</a> for your Porto address: <code>{address}</code></li>
          <li>Authenticate with Porto wallet (signs SIWE message)</li>
          <li>Mint a PKP using authenticated data (requires test tokens on Chronicle Yellowstone)</li>
          <li>Execute the Lit Action using the PKP with proper authContext</li>
        </ol>
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
              No PKP found. Please mint a new one:
            </p>
            <button 
              onClick={mintPKP}
              disabled={isMinting || !address}
              style={{ 
                padding: '8px 16px', 
                backgroundColor: isMinting ? '#ccc' : '#ff9800',
                color: 'white',
                border: 'none',
                borderRadius: '5px',
                cursor: (isMinting || !address) ? 'not-allowed' : 'pointer',
                marginRight: '10px'
              }}
            >
              {isMinting ? 'Minting PKP...' : 'Mint New PKP'}
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
              PKP Ready! Public Key: {(pkpInfo.publicKey || pkpInfo.pkpPublicKey)?.substring(0, 20)}...
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
      
      <div style={{ marginBottom: '10px' }}>
        <button 
          onClick={checkPortoKeys}
          disabled={!address}
          style={{ 
            padding: '8px 16px', 
            backgroundColor: '#6f42c1',
            color: 'white',
            border: 'none',
            borderRadius: '5px',
            cursor: !address ? 'not-allowed' : 'pointer',
            marginRight: '10px'
          }}
        >
          Check Porto Keys
        </button>
        <span style={{ fontSize: '12px', color: '#666' }}>
          (Check if admin keys are set up)
        </span>
      </div>

      <div style={{ marginBottom: '10px' }}>
        <label>
          Search Query: 
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            style={{ marginLeft: '10px', padding: '5px' }}
            placeholder="Enter artist or song name"
          />
        </label>
      </div>
      
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
        {isLoading ? 'Executing...' : 'Step 2: Test Genius Search Lit Action'}
      </button>
      
      {keys && (
        <div style={{ marginTop: '10px' }}>
          <h3>Porto Account Keys:</h3>
          <pre style={{ 
            backgroundColor: '#f0f8ff', 
            padding: '10px', 
            borderRadius: '5px',
            overflow: 'auto',
            maxHeight: '300px',
            fontSize: '12px',
            border: '1px solid #0066cc'
          }}>
            {keys}
          </pre>
        </div>
      )}

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
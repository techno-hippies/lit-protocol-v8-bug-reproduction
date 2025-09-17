import { useState, useEffect } from 'react'
import { createLitClient } from '@lit-protocol/lit-client'
import { nagaDev } from '@lit-protocol/networks'
import { createAuthManager, storagePlugins } from "@lit-protocol/auth"
import { utils as litUtils } from '@lit-protocol/lit-client'
import { ethers } from 'ethers'
import { createWalletClient, http, createPublicClient } from 'viem'
import { privateKeyToAccount } from 'viem/accounts'

// Mock registry contract ABI (minimal)
const REGISTRY_ABI = [
  {
    "inputs": [
      { "name": "handles", "type": "string[]" },
      { "name": "pkpPublicKeys", "type": "string[]" }
    ],
    "name": "batchRegisterCreators",
    "outputs": [],
    "type": "function"
  },
  {
    "inputs": [{ "name": "handle", "type": "string" }],
    "name": "getPkp",
    "outputs": [{ "name": "", "type": "string" }],
    "type": "function"
  },
  {
    "inputs": [{ "name": "handle", "type": "string" }],
    "name": "isRegistered",
    "outputs": [{ "name": "", "type": "bool" }],
    "type": "function"
  }
]

// Replace with your deployed registry address
const REGISTRY_ADDRESS = "0x0000000000000000000000000000000000000000" // Deploy and update!

const authManager = createAuthManager({
  storage: storagePlugins.localStorage({
    appName: "tiktok-pkp",
    networkName: "naga-dev",
  }),
})

export function TikTokPKPTest() {
  const [phase, setPhase] = useState<'setup' | 'user'>('setup')
  const [adminKey, setAdminKey] = useState('')
  const [validationCid, setValidationCid] = useState('')
  const [mintedPkps, setMintedPkps] = useState<Record<string, any>>({})
  const [selectedHandle, setSelectedHandle] = useState('')
  const [oauthToken, setOauthToken] = useState('')
  const [authContext, setAuthContext] = useState<any>(null)
  const [signedMessage, setSignedMessage] = useState('')
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState('')
  const [logs, setLogs] = useState<string[]>([])

  // Generate auth method type for TikTok dApp
  const authMethodConfig = litUtils.generateUniqueAuthMethodType({
    uniqueDappName: 'tiktok-decentral-v1'
  })

  const addLog = (message: string) => {
    setLogs(prev => [...prev, `[${new Date().toLocaleTimeString()}] ${message}`])
    console.log(message)
  }

  // STEP 1: Admin mints PKPs for handles
  const mintPKPsForHandles = async () => {
    if (!adminKey) {
      setError('Please enter admin private key')
      return
    }

    setIsLoading(true)
    setError('')
    let litClient: any = null

    try {
      addLog('Creating Lit Client...')
      litClient = await createLitClient({ network: nagaDev })

      // Create wallet from private key
      const account = privateKeyToAccount(`0x${adminKey.replace('0x', '')}` as `0x${string}`)
      const walletClient = createWalletClient({
        account,
        chain: nagaDev.getChainConfig() as any,
        transport: http()
      })

      // Handles to mint PKPs for
      const handles = ['@drake', '@taylorswift', '@mrbeast']
      const pkps: Record<string, any> = {}

      for (const handle of handles) {
        addLog(`Minting PKP for ${handle}...`)
        
        // Generate auth data for this handle
        const authData = litUtils.generateAuthData({
          uniqueDappName: 'tiktok-decentral-v1',
          uniqueAuthMethodType: authMethodConfig.bigint,
          userId: handle
        })

        // Mint PKP
        const { pkpData } = await litClient.mintWithCustomAuth({
          account: walletClient,
          authData: authData,
          scope: 'sign-anything',
          validationIpfsCid: validationCid || 'QmYourValidationCidHere', // Use actual CID
        })

        pkps[handle] = {
          pubkey: pkpData.data.pubkey,
          tokenId: pkpData.data.tokenId,
          authData: authData
        }

        addLog(`✅ Minted PKP for ${handle}: ${pkpData.data.pubkey.substring(0, 20)}...`)
      }

      setMintedPkps(pkps)
      
      // Store in localStorage (simulating registry)
      localStorage.setItem('tiktok-pkps', JSON.stringify(pkps))
      
      addLog('All PKPs minted successfully!')
      
      // TODO: Call registry contract to store on-chain
      // const registryContract = new ethers.Contract(REGISTRY_ADDRESS, REGISTRY_ABI, walletClient)
      // await registryContract.batchRegisterCreators(handles, Object.values(pkps).map(p => p.pubkey))

    } catch (err: any) {
      console.error('Minting error:', err)
      setError(err.message)
    } finally {
      if (litClient) await litClient.disconnect()
      setIsLoading(false)
    }
  }

  // STEP 2: Create validation Lit Action
  const getValidationCode = () => {
    return `
(async () => {
  const dAppUniqueAuthMethodType = "${authMethodConfig.hex}";
  const { pkpPublicKey, handle, oauthToken, authMethodId } = jsParams;
  
  // Simulate OAuth validation (in real app, call TikTok API)
  // For testing: token must be "valid-token-{handle}"
  const expectedToken = "valid-token-" + handle.replace('@', '');
  const tokenIsValid = oauthToken === expectedToken;
  
  // Check PKP permissions
  const tokenId = await Lit.Actions.pubkeyToTokenId({ publicKey: pkpPublicKey });
  const permittedAuthMethods = await Lit.Actions.getPermittedAuthMethods({ tokenId });
  
  const isPermitted = permittedAuthMethods.some((permittedAuthMethod) => {
    return permittedAuthMethod["auth_method_type"] === dAppUniqueAuthMethodType && 
           permittedAuthMethod["id"] === authMethodId;
  });
  
  const isValid = isPermitted && tokenIsValid;
  
  console.log('Validation result:', {
    handle,
    tokenIsValid,
    isPermitted,
    isValid
  });
  
  LitActions.setResponse({ response: isValid ? "true" : "false" });
})();`
  }

  // STEP 3: User claims PKP with OAuth
  const claimPKPWithOAuth = async () => {
    if (!selectedHandle || !oauthToken) {
      setError('Please select handle and enter OAuth token')
      return
    }

    setIsLoading(true)
    setError('')
    let litClient: any = null

    try {
      addLog(`User claiming PKP for ${selectedHandle}...`)
      
      // Load PKPs from storage (simulating registry query)
      const storedPkps = JSON.parse(localStorage.getItem('tiktok-pkps') || '{}')
      const pkpInfo = storedPkps[selectedHandle]
      
      if (!pkpInfo) {
        throw new Error(`No PKP found for ${selectedHandle}`)
      }

      litClient = await createLitClient({ network: nagaDev })
      
      addLog('Creating auth context with OAuth validation...')
      
      // Create custom auth context
      const customAuthContext = await authManager.createCustomAuthContext({
        pkpPublicKey: pkpInfo.pubkey,
        authConfig: {
          resources: [
            ["pkp-signing", "*"],
            ["lit-action-execution", "*"]
          ],
          expiration: new Date(Date.now() + 1000 * 60 * 15).toISOString(),
        },
        litClient: litClient,
        customAuthParams: {
          litActionIpfsId: validationCid || 'QmYourValidationCidHere',
          jsParams: {
            pkpPublicKey: pkpInfo.pubkey,
            handle: selectedHandle,
            oauthToken: oauthToken,
            authMethodId: pkpInfo.authData.authMethodId,
          },
        },
      })
      
      setAuthContext(customAuthContext)
      addLog(`✅ PKP claimed successfully for ${selectedHandle}!`)
      
    } catch (err: any) {
      console.error('Claim error:', err)
      setError(err.message)
    } finally {
      if (litClient) await litClient.disconnect()
      setIsLoading(false)
    }
  }

  // STEP 4: Sign with claimed PKP
  const signWithPKP = async () => {
    if (!authContext || !selectedHandle) {
      setError('Please claim PKP first')
      return
    }

    setIsLoading(true)
    setError('')
    let litClient: any = null

    try {
      addLog('Signing message with PKP...')
      
      const storedPkps = JSON.parse(localStorage.getItem('tiktok-pkps') || '{}')
      const pkpInfo = storedPkps[selectedHandle]
      
      litClient = await createLitClient({ network: nagaDev })
      
      const message = `Hello from ${selectedHandle}'s PKP!`
      const messageBytes = new TextEncoder().encode(message)
      
      const signatures = await litClient.chain.raw.pkpSign({
        chain: "ethereum",
        signingScheme: "EcdsaK256Sha256",
        pubKey: pkpInfo.pubkey,
        authContext: authContext,
        toSign: messageBytes,
      })
      
      setSignedMessage(JSON.stringify(signatures, null, 2))
      addLog('✅ Message signed successfully!')
      
    } catch (err: any) {
      console.error('Signing error:', err)
      setError(err.message)
    } finally {
      if (litClient) await litClient.disconnect()
      setIsLoading(false)
    }
  }

  // Load existing PKPs on mount
  useEffect(() => {
    const stored = localStorage.getItem('tiktok-pkps')
    if (stored) {
      setMintedPkps(JSON.parse(stored))
      addLog('Loaded existing PKPs from storage')
    }
  }, [])

  return (
    <div style={{ padding: '20px', maxWidth: '1200px', margin: '0 auto' }}>
      <h1>TikTok PKP Test - Custom Auth Flow</h1>
      
      {/* Phase Toggle */}
      <div style={{ marginBottom: '20px' }}>
        <button 
          onClick={() => setPhase('setup')}
          style={{
            padding: '10px 20px',
            backgroundColor: phase === 'setup' ? '#2196f3' : '#ddd',
            color: phase === 'setup' ? 'white' : 'black',
            border: 'none',
            borderRadius: '5px 0 0 5px',
            cursor: 'pointer'
          }}
        >
          🏢 Admin Setup
        </button>
        <button 
          onClick={() => setPhase('user')}
          style={{
            padding: '10px 20px',
            backgroundColor: phase === 'user' ? '#4caf50' : '#ddd',
            color: phase === 'user' ? 'white' : 'black',
            border: 'none',
            borderRadius: '0 5px 5px 0',
            cursor: 'pointer'
          }}
        >
          👤 User Flow
        </button>
      </div>

      {phase === 'setup' ? (
        <>
          {/* Admin Setup Flow */}
          <div style={{ 
            border: '2px solid #2196f3', 
            padding: '20px', 
            borderRadius: '8px',
            marginBottom: '20px' 
          }}>
            <h2>🏢 Admin Setup (Cold Wallet)</h2>
            
            {/* Step 1: Set Admin Key */}
            <div style={{ marginBottom: '20px' }}>
              <h3>Step 1: Enter Admin Private Key</h3>
              <input
                type="password"
                placeholder="Private key (will mint PKPs)"
                value={adminKey}
                onChange={(e) => setAdminKey(e.target.value)}
                style={{ 
                  width: '100%', 
                  padding: '10px', 
                  marginBottom: '10px',
                  borderRadius: '5px',
                  border: '1px solid #ddd'
                }}
              />
            </div>

            {/* Step 2: Set Validation CID */}
            <div style={{ marginBottom: '20px' }}>
              <h3>Step 2: Validation Lit Action</h3>
              <textarea
                value={getValidationCode()}
                readOnly
                style={{ 
                  width: '100%', 
                  height: '200px', 
                  padding: '10px',
                  fontFamily: 'monospace',
                  fontSize: '12px',
                  backgroundColor: '#f5f5f5',
                  borderRadius: '5px',
                  border: '1px solid #ddd'
                }}
              />
              <input
                type="text"
                placeholder="IPFS CID (pin above code to IPFS)"
                value={validationCid}
                onChange={(e) => setValidationCid(e.target.value)}
                style={{ 
                  width: '100%', 
                  padding: '10px', 
                  marginTop: '10px',
                  borderRadius: '5px',
                  border: '1px solid #ddd'
                }}
              />
              <p style={{ fontSize: '12px', color: '#666', marginTop: '5px' }}>
                Pin the validation code to IPFS and enter the CID. For testing, use any CID.
              </p>
            </div>

            {/* Step 3: Mint PKPs */}
            <div style={{ marginBottom: '20px' }}>
              <h3>Step 3: Batch Mint PKPs</h3>
              <button
                onClick={mintPKPsForHandles}
                disabled={isLoading || !adminKey}
                style={{
                  padding: '10px 20px',
                  backgroundColor: '#2196f3',
                  color: 'white',
                  border: 'none',
                  borderRadius: '5px',
                  cursor: isLoading || !adminKey ? 'not-allowed' : 'pointer'
                }}
              >
                {isLoading ? 'Minting...' : 'Mint PKPs for @drake, @taylorswift, @mrbeast'}
              </button>
              
              {Object.keys(mintedPkps).length > 0 && (
                <div style={{ marginTop: '10px' }}>
                  <h4>Minted PKPs:</h4>
                  {Object.entries(mintedPkps).map(([handle, pkp]: [string, any]) => (
                    <div key={handle} style={{ 
                      padding: '5px 10px', 
                      backgroundColor: '#e3f2fd',
                      marginBottom: '5px',
                      borderRadius: '3px',
                      fontSize: '12px'
                    }}>
                      <strong>{handle}:</strong> {pkp.pubkey?.substring(0, 30)}...
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </>
      ) : (
        <>
          {/* User Flow */}
          <div style={{ 
            border: '2px solid #4caf50', 
            padding: '20px', 
            borderRadius: '8px',
            marginBottom: '20px' 
          }}>
            <h2>👤 User Flow (TikTok Creator)</h2>
            
            {/* Step 1: Select Handle */}
            <div style={{ marginBottom: '20px' }}>
              <h3>Step 1: Select Your Handle</h3>
              <select
                value={selectedHandle}
                onChange={(e) => setSelectedHandle(e.target.value)}
                style={{ 
                  width: '100%', 
                  padding: '10px',
                  borderRadius: '5px',
                  border: '1px solid #ddd'
                }}
              >
                <option value="">Select handle...</option>
                {Object.keys(mintedPkps).map(handle => (
                  <option key={handle} value={handle}>{handle}</option>
                ))}
              </select>
            </div>

            {/* Step 2: OAuth */}
            <div style={{ marginBottom: '20px' }}>
              <h3>Step 2: Enter OAuth Token</h3>
              <input
                type="text"
                placeholder={`For testing: valid-token-${selectedHandle?.replace('@', '')}`}
                value={oauthToken}
                onChange={(e) => setOauthToken(e.target.value)}
                style={{ 
                  width: '100%', 
                  padding: '10px',
                  borderRadius: '5px',
                  border: '1px solid #ddd'
                }}
              />
              <p style={{ fontSize: '12px', color: '#666', marginTop: '5px' }}>
                In production: This would be from TikTok OAuth flow. 
                For testing: Use "valid-token-{selectedHandle?.replace('@', '')}"
              </p>
            </div>

            {/* Step 3: Claim PKP */}
            <div style={{ marginBottom: '20px' }}>
              <h3>Step 3: Claim Your PKP</h3>
              <button
                onClick={claimPKPWithOAuth}
                disabled={isLoading || !selectedHandle || !oauthToken}
                style={{
                  padding: '10px 20px',
                  backgroundColor: authContext ? '#4caf50' : '#ff9800',
                  color: 'white',
                  border: 'none',
                  borderRadius: '5px',
                  cursor: (isLoading || !selectedHandle || !oauthToken) ? 'not-allowed' : 'pointer'
                }}
              >
                {authContext ? '✅ PKP Claimed' : 'Claim PKP with OAuth'}
              </button>
            </div>

            {/* Step 4: Sign */}
            <div style={{ marginBottom: '20px' }}>
              <h3>Step 4: Sign with Your PKP</h3>
              <button
                onClick={signWithPKP}
                disabled={isLoading || !authContext}
                style={{
                  padding: '10px 20px',
                  backgroundColor: '#9c27b0',
                  color: 'white',
                  border: 'none',
                  borderRadius: '5px',
                  cursor: (isLoading || !authContext) ? 'not-allowed' : 'pointer'
                }}
              >
                Sign Message with PKP
              </button>
              
              {signedMessage && (
                <pre style={{ 
                  marginTop: '10px', 
                  padding: '10px', 
                  backgroundColor: '#f5f5f5',
                  borderRadius: '5px',
                  fontSize: '12px',
                  overflow: 'auto'
                }}>
                  {signedMessage}
                </pre>
              )}
            </div>
          </div>
        </>
      )}

      {/* Logs */}
      <div style={{ 
        border: '1px solid #ddd', 
        padding: '15px', 
        borderRadius: '8px',
        marginBottom: '20px',
        backgroundColor: '#f9f9f9'
      }}>
        <h3>📋 Logs</h3>
        <div style={{ 
          maxHeight: '200px', 
          overflow: 'auto',
          fontFamily: 'monospace',
          fontSize: '12px'
        }}>
          {logs.map((log, i) => (
            <div key={i}>{log}</div>
          ))}
        </div>
      </div>

      {/* Error Display */}
      {error && (
        <div style={{ 
          padding: '10px', 
          backgroundColor: '#ffebee', 
          border: '1px solid #f44336',
          borderRadius: '5px',
          color: '#c62828' 
        }}>
          Error: {error}
        </div>
      )}

      {/* Flow Explanation */}
      <div style={{ 
        backgroundColor: '#fff3e0', 
        padding: '15px', 
        borderRadius: '8px',
        marginTop: '20px' 
      }}>
        <h3>🔄 Complete Flow:</h3>
        <ol>
          <li><strong>Admin Setup:</strong> Private key mints PKPs for TikTok handles</li>
          <li><strong>Registry:</strong> PKPs stored on-chain (contract mapping)</li>
          <li><strong>User OAuth:</strong> TikTok creators authenticate</li>
          <li><strong>Validation:</strong> Lit Action validates OAuth token</li>
          <li><strong>Claim:</strong> User gets control of their PKP</li>
          <li><strong>Usage:</strong> Sign messages, upload videos, mint NFTs</li>
        </ol>
        
        <h4>Key Points:</h4>
        <ul>
          <li>✅ No seed phrases - OAuth only</li>
          <li>✅ Pre-minted PKPs - instant onboarding</li>
          <li>✅ Serverless validation - Lit Actions</li>
          <li>✅ On-chain registry - discoverable PKPs</li>
          <li>✅ User ownership - sign after claim</li>
        </ul>
      </div>
    </div>
  )
}
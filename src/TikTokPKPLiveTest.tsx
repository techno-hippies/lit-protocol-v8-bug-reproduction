import { useState, useEffect } from 'react'
import { createLitClient } from '@lit-protocol/lit-client'
import { nagaDev } from '@lit-protocol/networks'
import { createAuthManager, storagePlugins } from "@lit-protocol/auth"
import { utils as litUtils } from '@lit-protocol/lit-client'
import { createPublicClient, http } from 'viem'
import { baseSepolia } from 'viem/chains'

// Registry contract on Base Sepolia
const REGISTRY_ADDRESS = "0xe6003fE64523070f01eC87f7f1C5C2BBeAAaE6f6"

const REGISTRY_ABI = [
  {
    "inputs": [{ "name": "handle", "type": "string" }],
    "name": "getPkp",
    "outputs": [{ "name": "", "type": "string" }],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [{ "name": "handle", "type": "string" }],
    "name": "getCreator",
    "outputs": [
      {
        "components": [
          { "name": "pkpPublicKey", "type": "string" },
          { "name": "uploadTxIds", "type": "string[]" },
          { "name": "videoCount", "type": "uint256" },
          { "name": "registeredAt", "type": "uint256" },
          { "name": "registeredBy", "type": "address" }
        ],
        "name": "",
        "type": "tuple"
      }
    ],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [],
    "name": "getAllHandles",
    "outputs": [{ "name": "", "type": "string[]" }],
    "stateMutability": "view",
    "type": "function"
  }
] as const

const authManager = createAuthManager({
  storage: storagePlugins.localStorage({
    appName: "tiktok-pkp-live",
    networkName: "naga-dev",
  }),
})

// Known handles from the contract
const REGISTERED_HANDLES = [
  "@alice_test", "@charlie_v2", "@.notlara73", "@_.6hr1st1n4._", 
  "@_li22y_", "@aa.xchx", "@alexa.horvth1", "@anabela2271",
  "@anastasiailiadi7", "@art_by_addyraemiller77", "@briggiebriggiee",
  "@bus_stop_955", "@carmel.qx", "@dee.16x", "@deffn0taideli",
  "@dwuby_26p63", "@ellen_v", "@emilie_h6", "@17d34", "@1800sushiluver",
  "@abby_was_bored", "@ad1yn22", "@addisonre"
]

export function TikTokPKPLiveTest() {
  const [selectedHandle, setSelectedHandle] = useState('')
  const [pkpInfo, setPkpInfo] = useState<any>(null)
  const [oauthToken, setOauthToken] = useState('')
  const [validationCid, setValidationCid] = useState('QmYourValidationCidHere')
  const [authContext, setAuthContext] = useState<any>(null)
  const [signedMessage, setSignedMessage] = useState('')
  const [litActionResult, setLitActionResult] = useState('')
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

  // Query PKP from registry contract
  const queryPKPFromRegistry = async () => {
    if (!selectedHandle) {
      setError('Please select a handle')
      return
    }

    setIsLoading(true)
    setError('')

    try {
      addLog(`Querying registry for ${selectedHandle}...`)
      
      // Create public client for Base Sepolia
      const publicClient = createPublicClient({
        chain: baseSepolia,
        transport: http()
      })

      // Get PKP from registry
      const pkpPublicKey = await publicClient.readContract({
        address: REGISTRY_ADDRESS,
        abi: REGISTRY_ABI,
        functionName: 'getPkp',
        args: [selectedHandle]
      })

      // Get full creator data
      const creatorData = await publicClient.readContract({
        address: REGISTRY_ADDRESS,
        abi: REGISTRY_ABI,
        functionName: 'getCreator',
        args: [selectedHandle]
      })

      addLog(`✅ Found PKP: ${pkpPublicKey.substring(0, 30)}...`)
      
      const authData = litUtils.generateAuthData({
        uniqueDappName: 'tiktok-decentral-v1',
        uniqueAuthMethodType: authMethodConfig.bigint,
        userId: selectedHandle
      })

      setPkpInfo({
        pubkey: pkpPublicKey,
        handle: selectedHandle,
        creatorData: creatorData,
        authData: authData
      })

      addLog(`Videos uploaded: ${creatorData.videoCount}`)
      addLog(`Registered at: ${new Date(Number(creatorData.registeredAt) * 1000).toLocaleString()}`)
      
    } catch (err: any) {
      console.error('Query error:', err)
      setError(err.message)
    } finally {
      setIsLoading(false)
    }
  }

  // Create validation Lit Action code
  const getValidationCode = () => {
    return `
(async () => {
  const dAppUniqueAuthMethodType = "${authMethodConfig.hex}";
  const { pkpPublicKey, handle, oauthToken, authMethodId } = jsParams;
  
  // OAuth validation
  // In production: Call TikTok API to validate token
  // For testing: Accept token format "test-{handle}"
  const expectedToken = "test-" + handle.replace('@', '');
  const tokenIsValid = oauthToken === expectedToken;
  
  // Check PKP permissions
  const tokenId = await Lit.Actions.pubkeyToTokenId({ publicKey: pkpPublicKey });
  const permittedAuthMethods = await Lit.Actions.getPermittedAuthMethods({ tokenId });
  
  const isPermitted = permittedAuthMethods.some((permittedAuthMethod) => {
    return permittedAuthMethod["auth_method_type"] === dAppUniqueAuthMethodType && 
           permittedAuthMethod["id"] === authMethodId;
  });
  
  const isValid = isPermitted && tokenIsValid;
  
  console.log('Validation:', {
    handle,
    tokenIsValid,
    isPermitted,
    result: isValid
  });
  
  LitActions.setResponse({ response: isValid ? "true" : "false" });
})();`
  }

  // Claim PKP with OAuth
  const claimPKPWithOAuth = async () => {
    if (!pkpInfo || !oauthToken) {
      setError('Please query PKP and enter OAuth token')
      return
    }

    setIsLoading(true)
    setError('')
    let litClient: any = null

    try {
      addLog(`Claiming PKP for ${selectedHandle}...`)
      
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
          litActionIpfsId: validationCid,
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

  // Sign with claimed PKP
  const signWithPKP = async () => {
    if (!authContext || !pkpInfo) {
      setError('Please claim PKP first')
      return
    }

    setIsLoading(true)
    setError('')
    let litClient: any = null

    try {
      addLog('Signing message with PKP...')
      
      litClient = await createLitClient({ network: nagaDev })
      
      const message = `Hello from ${selectedHandle}'s PKP! Powered by TikTok Decentral.`
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

  // Execute Lit Action
  const executeLitAction = async () => {
    if (!authContext || !pkpInfo) {
      setError('Please claim PKP first')
      return
    }

    setIsLoading(true)
    setError('')
    let litClient: any = null

    try {
      addLog('Executing Lit Action...')
      
      litClient = await createLitClient({ network: nagaDev })
      
      // Example Lit Action that could fetch TikTok data
      const litActionCode = `
        const go = async () => {
          const { handle, pkpPublicKey } = jsParams;
          
          // In production: Fetch TikTok data via API
          // For demo: Return mock data
          const result = {
            handle: handle,
            pkpPublicKey: pkpPublicKey,
            message: "TikTok creator authenticated!",
            capabilities: [
              "Sign transactions",
              "Upload videos to Irys",
              "Mint NFTs",
              "Control smart contracts"
            ],
            timestamp: new Date().toISOString()
          };
          
          Lit.Actions.setResponse({ 
            response: JSON.stringify(result)
          });
        };
        go();
      `;
      
      const result = await litClient.executeJs({
        code: litActionCode,
        authContext: authContext,
        jsParams: {
          handle: selectedHandle,
          pkpPublicKey: pkpInfo.pubkey,
        },
      })
      
      if (result?.response) {
        const data = typeof result.response === 'string' 
          ? JSON.parse(result.response) 
          : result.response
        setLitActionResult(JSON.stringify(data, null, 2))
        addLog('✅ Lit Action executed successfully!')
      }
      
    } catch (err: any) {
      console.error('Lit Action error:', err)
      setError(err.message)
    } finally {
      if (litClient) await litClient.disconnect()
      setIsLoading(false)
    }
  }

  return (
    <div style={{ padding: '20px', maxWidth: '1200px', margin: '0 auto' }}>
      <h1>🔴 LIVE TikTok PKP Test - Base Sepolia Registry</h1>
      
      {/* Contract Info */}
      <div style={{ 
        backgroundColor: '#e8f5e9', 
        padding: '15px', 
        borderRadius: '8px',
        marginBottom: '20px' 
      }}>
        <h3>📍 Registry Contract</h3>
        <p style={{ fontFamily: 'monospace', fontSize: '12px' }}>
          <strong>Address:</strong> {REGISTRY_ADDRESS}<br/>
          <strong>Network:</strong> Base Sepolia<br/>
          <strong>Registered Creators:</strong> {REGISTERED_HANDLES.length}
        </p>
      </div>

      {/* Step 1: Select Handle */}
      <div style={{ 
        border: '1px solid #ddd', 
        padding: '15px', 
        borderRadius: '8px',
        marginBottom: '20px' 
      }}>
        <h3>Step 1: Select TikTok Handle</h3>
        <select
          value={selectedHandle}
          onChange={(e) => setSelectedHandle(e.target.value)}
          style={{ 
            width: '100%', 
            padding: '10px',
            borderRadius: '5px',
            border: '1px solid #ddd',
            marginBottom: '10px'
          }}
        >
          <option value="">Select a registered handle...</option>
          {REGISTERED_HANDLES.map(handle => (
            <option key={handle} value={handle}>{handle}</option>
          ))}
        </select>
        
        <button
          onClick={queryPKPFromRegistry}
          disabled={isLoading || !selectedHandle}
          style={{
            padding: '10px 20px',
            backgroundColor: '#2196f3',
            color: 'white',
            border: 'none',
            borderRadius: '5px',
            cursor: (isLoading || !selectedHandle) ? 'not-allowed' : 'pointer'
          }}
        >
          {isLoading ? 'Querying...' : 'Query PKP from Registry'}
        </button>
        
        {pkpInfo && (
          <div style={{ 
            marginTop: '10px', 
            padding: '10px', 
            backgroundColor: '#f5f5f5',
            borderRadius: '5px',
            fontSize: '12px'
          }}>
            <strong>PKP Found:</strong><br/>
            {pkpInfo.pubkey.substring(0, 66)}...
            {pkpInfo.creatorData.videoCount > 0 && (
              <div>
                <strong>Videos:</strong> {pkpInfo.creatorData.videoCount}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Step 2: OAuth Token */}
      <div style={{ 
        border: '1px solid #ddd', 
        padding: '15px', 
        borderRadius: '8px',
        marginBottom: '20px' 
      }}>
        <h3>Step 2: Enter OAuth Token</h3>
        <input
          type="text"
          placeholder={`For testing: test-${selectedHandle?.replace('@', '')}`}
          value={oauthToken}
          onChange={(e) => setOauthToken(e.target.value)}
          style={{ 
            width: '100%', 
            padding: '10px',
            borderRadius: '5px',
            border: '1px solid #ddd',
            marginBottom: '10px'
          }}
        />
        <p style={{ fontSize: '12px', color: '#666' }}>
          💡 For testing, use: <code>test-{selectedHandle?.replace('@', '')}</code><br/>
          In production: This would be from TikTok OAuth flow
        </p>
      </div>

      {/* Step 3: Validation Code */}
      <div style={{ 
        border: '1px solid #ddd', 
        padding: '15px', 
        borderRadius: '8px',
        marginBottom: '20px' 
      }}>
        <h3>Step 3: Validation Lit Action</h3>
        <details>
          <summary style={{ cursor: 'pointer', marginBottom: '10px' }}>
            View Validation Code (click to expand)
          </summary>
          <textarea
            value={getValidationCode()}
            readOnly
            style={{ 
              width: '100%', 
              height: '200px', 
              padding: '10px',
              fontFamily: 'monospace',
              fontSize: '11px',
              backgroundColor: '#f5f5f5',
              borderRadius: '5px',
              border: '1px solid #ddd'
            }}
          />
        </details>
        <input
          type="text"
          placeholder="IPFS CID for validation code"
          value={validationCid}
          onChange={(e) => setValidationCid(e.target.value)}
          style={{ 
            width: '100%', 
            padding: '10px',
            borderRadius: '5px',
            border: '1px solid #ddd'
          }}
        />
        <p style={{ fontSize: '12px', color: '#666', marginTop: '5px' }}>
          Pin validation code to IPFS or use placeholder for testing
        </p>
      </div>

      {/* Step 4: Claim PKP */}
      <div style={{ 
        border: '1px solid #ddd', 
        padding: '15px', 
        borderRadius: '8px',
        marginBottom: '20px' 
      }}>
        <h3>Step 4: Claim PKP with OAuth</h3>
        <button
          onClick={claimPKPWithOAuth}
          disabled={isLoading || !pkpInfo || !oauthToken}
          style={{
            padding: '10px 20px',
            backgroundColor: authContext ? '#4caf50' : '#ff9800',
            color: 'white',
            border: 'none',
            borderRadius: '5px',
            cursor: (isLoading || !pkpInfo || !oauthToken) ? 'not-allowed' : 'pointer'
          }}
        >
          {authContext ? '✅ PKP Claimed' : 'Claim PKP'}
        </button>
      </div>

      {/* Step 5: Use PKP */}
      <div style={{ 
        border: '1px solid #ddd', 
        padding: '15px', 
        borderRadius: '8px',
        marginBottom: '20px' 
      }}>
        <h3>Step 5: Use Your PKP</h3>
        
        <button
          onClick={signWithPKP}
          disabled={isLoading || !authContext}
          style={{
            padding: '10px 20px',
            backgroundColor: '#9c27b0',
            color: 'white',
            border: 'none',
            borderRadius: '5px',
            cursor: (isLoading || !authContext) ? 'not-allowed' : 'pointer',
            marginRight: '10px'
          }}
        >
          Sign Message
        </button>
        
        <button
          onClick={executeLitAction}
          disabled={isLoading || !authContext}
          style={{
            padding: '10px 20px',
            backgroundColor: '#ff5722',
            color: 'white',
            border: 'none',
            borderRadius: '5px',
            cursor: (isLoading || !authContext) ? 'not-allowed' : 'pointer'
          }}
        >
          Execute Lit Action
        </button>
        
        {signedMessage && (
          <div style={{ marginTop: '10px' }}>
            <h4>Signed Message:</h4>
            <pre style={{ 
              padding: '10px', 
              backgroundColor: '#f5f5f5',
              borderRadius: '5px',
              fontSize: '11px',
              overflow: 'auto',
              maxHeight: '200px'
            }}>
              {signedMessage}
            </pre>
          </div>
        )}
        
        {litActionResult && (
          <div style={{ marginTop: '10px' }}>
            <h4>Lit Action Result:</h4>
            <pre style={{ 
              padding: '10px', 
              backgroundColor: '#f5f5f5',
              borderRadius: '5px',
              fontSize: '11px',
              overflow: 'auto',
              maxHeight: '200px'
            }}>
              {litActionResult}
            </pre>
          </div>
        )}
      </div>

      {/* Logs */}
      <div style={{ 
        border: '1px solid #ddd', 
        padding: '15px', 
        borderRadius: '8px',
        marginBottom: '20px',
        backgroundColor: '#f9f9f9'
      }}>
        <h3>📋 Activity Log</h3>
        <div style={{ 
          maxHeight: '150px', 
          overflow: 'auto',
          fontFamily: 'monospace',
          fontSize: '11px'
        }}>
          {logs.length === 0 ? (
            <div style={{ color: '#999' }}>No activity yet...</div>
          ) : (
            logs.map((log, i) => (
              <div key={i}>{log}</div>
            ))
          )}
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

      {/* Instructions */}
      <div style={{ 
        backgroundColor: '#fff3e0', 
        padding: '15px', 
        borderRadius: '8px',
        marginTop: '20px' 
      }}>
        <h3>📖 Complete Flow Instructions:</h3>
        <ol>
          <li><strong>Select Handle:</strong> Choose from 23 pre-registered TikTok creators</li>
          <li><strong>Query PKP:</strong> Fetches the PKP from Base Sepolia registry</li>
          <li><strong>Enter OAuth Token:</strong> Use test format: <code>test-handlename</code></li>
          <li><strong>Claim PKP:</strong> Creates auth context with custom validation</li>
          <li><strong>Use PKP:</strong> Sign messages or execute Lit Actions</li>
        </ol>
        
        <h4>🔑 Key Points:</h4>
        <ul>
          <li>PKPs are already minted and stored in the registry</li>
          <li>OAuth validation happens in Lit Action (serverless)</li>
          <li>Once claimed, users can sign and execute actions</li>
          <li>In production, OAuth would redirect to TikTok</li>
        </ul>
      </div>
    </div>
  )
}
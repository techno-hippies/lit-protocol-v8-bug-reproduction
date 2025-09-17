import { useState, useEffect } from 'react'
import { createLitClient } from '@lit-protocol/lit-client'
import { nagaDev } from '@lit-protocol/networks'
import { createAuthManager, storagePlugins } from "@lit-protocol/auth"
import { utils as litUtils } from '@lit-protocol/lit-client'
import { createPublicClient, http } from 'viem'
import { baseSepolia } from 'viem/chains'

// TikTok OAuth Configuration
const TIKTOK_CLIENT_KEY = 'sbawo9fqgbt8nt9s8g'
const REDIRECT_URI = 'https://c52fb18324f0.ngrok-free.app'  // EXACT portal match - no /callback
const TIKTOK_AUTH_URL = 'https://www.tiktok.com/v2/auth/authorize'

// Registry contract on Base Sepolia  
const REGISTRY_ADDRESS = "0xe6003fE64523070f01eC87f7f1C5C2BBeAAaE6f6"

const REGISTRY_ABI = [
  {
    "inputs": [{ "name": "handle", "type": "string" }],
    "name": "getPkp",
    "outputs": [{ "name": "", "type": "string" }],
    "stateMutability": "view",
    "type": "function"
  }
] as const

const authManager = createAuthManager({
  storage: storagePlugins.localStorage({
    appName: "tiktok-serverless",
    networkName: "naga-dev",
  }),
})

export function TikTokServerlessOAuth() {
  const [authCode, setAuthCode] = useState('')
  const [accessToken, setAccessToken] = useState('')
  const [userHandle, setUserHandle] = useState('')
  const [pkpInfo, setPkpInfo] = useState<any>(null)
  const [authContext, setAuthContext] = useState<any>(null)
  const [signedMessage, setSignedMessage] = useState('')
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState('')
  const [logs, setLogs] = useState<string[]>([])
  const [testMode, setTestMode] = useState(false)

  const authMethodConfig = litUtils.generateUniqueAuthMethodType({
    uniqueDappName: 'tiktok-serverless-v1'
  })

  const addLog = (message: string) => {
    setLogs(prev => [...prev, `[${new Date().toLocaleTimeString()}] ${message}`])
    console.log(message)
  }

  // OAuth Validation Lit Action (runs on Lit nodes - no backend!)
  const getOAuthValidationCode = (): string => {
    return `
(async () => {
  const { pkpPublicKey, handle, accessToken, authMethodId } = jsParams;
  const dAppUniqueAuthMethodType = "${authMethodConfig.hex}";
  
  console.log('Validating TikTok OAuth for:', handle);
  
  // For testing: Accept token if it matches pattern "test-{handle}"
  // In production: Call TikTok API to validate
  let tokenIsValid = false;
  
  // Test mode validation (since TikTok API requires server-side token exchange)
  const expectedTestToken = "test-" + handle.replace('@', '').toLowerCase();
  if (accessToken === expectedTestToken) {
    tokenIsValid = true;
    console.log('Test mode: Token validated');
  } else {
    // Try real TikTok API validation
    try {
      const response = await fetch('https://open.tiktokapis.com/v2/user/info/?fields=display_name', {
        headers: {
          'Authorization': 'Bearer ' + accessToken,
        }
      });
      
      const data = await response.json();
      
      if (data.data && data.data.user) {
        const tokenHandle = '@' + data.data.user.display_name;
        tokenIsValid = (tokenHandle.toLowerCase() === handle.toLowerCase());
      }
    } catch (err) {
      console.log('API validation failed, checking test token');
    }
  }
  
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

  // Token Exchange Lit Action (handles OAuth code exchange serverlessly!)
  const getTokenExchangeLitAction = (): string => {
    return `
(async () => {
  const { code, clientKey, clientSecret, redirectUri } = jsParams;
  
  console.log('Exchanging OAuth code for access token...');
  
  try {
    // Exchange code for token using Lit Action's fetch capability
    const params = new URLSearchParams({
      client_key: clientKey,
      client_secret: clientSecret,
      code: code,
      grant_type: 'authorization_code',
      redirect_uri: redirectUri
    });
    
    const response = await fetch('https://open.tiktokapis.com/v2/oauth/token/', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: params.toString()
    });
    
    const data = await response.json();
    
    if (data.access_token) {
      // Now get user info with the token
      const userResponse = await fetch('https://open.tiktokapis.com/v2/user/info/?fields=display_name,open_id', {
        headers: {
          'Authorization': 'Bearer ' + data.access_token,
        }
      });
      
      const userData = await userResponse.json();
      
      LitActions.setResponse({ 
        response: JSON.stringify({
          success: true,
          accessToken: data.access_token,
          userInfo: userData.data?.user || null
        })
      });
    } else {
      LitActions.setResponse({ 
        response: JSON.stringify({
          success: false,
          error: data.error_description || 'Token exchange failed'
        })
      });
    }
  } catch (err) {
    LitActions.setResponse({ 
      response: JSON.stringify({
        success: false,
        error: err.message
      })
    });
  }
})();`
  }

  // Step 1: Start OAuth flow
  const startOAuthFlow = () => {
    const csrfState = Math.random().toString(36).substring(7)
    localStorage.setItem('tiktok_csrf_state', csrfState)
    
    const params = new URLSearchParams({
      client_key: TIKTOK_CLIENT_KEY,
      scope: 'user.info.basic',
      response_type: 'code',
      redirect_uri: REDIRECT_URI,
      state: csrfState
    })
    
    const authUrl = `${TIKTOK_AUTH_URL}?${params.toString()}`
    addLog('Redirecting to TikTok OAuth...')
    addLog(`Auth URL: ${authUrl}`)
    
    // Use window.open in same tab to avoid xdg-open issues
    window.open(authUrl, '_self')
  }

  // Handle OAuth callback (including errors)
  useEffect(() => {
    const urlParams = new URLSearchParams(window.location.search)
    const code = urlParams.get('code')
    const state = urlParams.get('state')
    const errorParam = urlParams.get('error')
    const errorDesc = urlParams.get('error_description')
    
    // Handle OAuth errors
    if (errorParam) {
      if (errorParam === 'access_denied') {
        setError('Access denied. Make sure to:\n1. Use the test account: qw45wafdfadsfadsf\n2. Click "Authorize" when prompted\n3. The test user must accept the permissions')
        addLog(`❌ OAuth Error: ${errorParam} - ${errorDesc || 'User denied access'}`)
      } else {
        setError(`OAuth Error: ${errorParam} - ${errorDesc || 'Unknown error'}`)
        addLog(`❌ OAuth Error: ${errorParam}`)
      }
      window.history.replaceState({}, document.title, window.location.pathname)
      return
    }
    
    // Handle successful callback
    if (code && state) {
      const savedState = localStorage.getItem('tiktok_csrf_state')
      if (state === savedState) {
        setAuthCode(code)
        addLog('✅ OAuth code received!')
        window.history.replaceState({}, document.title, window.location.pathname)
      } else {
        setError('State mismatch - possible CSRF attack')
        addLog('❌ State mismatch')
      }
    }
  }, [])

  // Step 2: Exchange code for token using Lit Action (SERVERLESS!)
  const exchangeCodeServerlessly = async () => {
    if (!authCode) {
      setError('No authorization code')
      return
    }

    setIsLoading(true)
    setError('')
    let litClient: any = null

    try {
      addLog('Exchanging code for token via Lit Action...')
      
      litClient = await createLitClient({ network: nagaDev })
      
      // Execute Lit Action to exchange token (no backend needed!)
      const result = await litClient.executeJs({
        code: getTokenExchangeLitAction(),
        authContext: {
          // Minimal context just for execution
          getSessionSigs: async () => ({}),
          getAuthNeededCallback: async () => ({})
        },
        jsParams: {
          code: authCode,
          clientKey: TIKTOK_CLIENT_KEY,
          clientSecret: 'W6fuS8P6NR42tigXqcFD9AvajC7cRbtT', // In production: encrypt this
          redirectUri: REDIRECT_URI
        }
      })
      
      if (result?.response) {
        const data = JSON.parse(result.response)
        
        if (data.success) {
          setAccessToken(data.accessToken)
          setUserHandle(`@${data.userInfo?.display_name || 'unknown'}`)
          addLog(`✅ Token obtained! User: @${data.userInfo?.display_name}`)
          
          // Store for later use
          localStorage.setItem('tiktok_access_token', data.accessToken)
          localStorage.setItem('tiktok_handle', `@${data.userInfo?.display_name}`)
        } else {
          throw new Error(data.error)
        }
      }
      
    } catch (err: any) {
      console.error('Token exchange error:', err)
      setError(err.message)
    } finally {
      if (litClient) await litClient.disconnect()
      setIsLoading(false)
    }
  }

  // Step 3: Query PKP from registry
  const queryPKPFromRegistry = async () => {
    if (!userHandle) {
      setError('Please complete OAuth first')
      return
    }

    setIsLoading(true)
    setError('')

    try {
      addLog(`Querying registry for ${userHandle}...`)
      
      const publicClient = createPublicClient({
        chain: baseSepolia,
        transport: http()
      })

      const pkpPublicKey = await publicClient.readContract({
        address: REGISTRY_ADDRESS,
        abi: REGISTRY_ABI,
        functionName: 'getPkp',
        args: [userHandle]
      })

      if (pkpPublicKey && pkpPublicKey !== '0x') {
        addLog(`✅ Found PKP: ${pkpPublicKey.substring(0, 30)}...`)
        
        const authData = litUtils.generateAuthData({
          uniqueDappName: 'tiktok-serverless-v1',
          uniqueAuthMethodType: authMethodConfig.bigint,
          userId: userHandle
        })

        setPkpInfo({
          pubkey: pkpPublicKey,
          handle: userHandle,
          authData: authData
        })
      } else {
        setError(`No PKP found for ${userHandle}`)
      }
      
    } catch (err: any) {
      console.error('Registry query error:', err)
      setError(err.message)
    } finally {
      setIsLoading(false)
    }
  }

  // Step 4: Claim PKP with OAuth (validation in Lit Action)
  const claimPKPWithOAuth = async () => {
    if (!pkpInfo || !accessToken) {
      setError('Complete OAuth and query PKP first')
      return
    }

    setIsLoading(true)
    setError('')
    let litClient: any = null

    try {
      addLog(`Claiming PKP for ${userHandle}...`)
      
      litClient = await createLitClient({ network: nagaDev })
      
      // Create custom auth context - validation happens in Lit Action!
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
          // Use inline validation code or pin to IPFS
          litActionCode: getOAuthValidationCode(),
          jsParams: {
            pkpPublicKey: pkpInfo.pubkey,
            handle: userHandle,
            accessToken: accessToken, // Or use test token: "test-" + handle
            authMethodId: pkpInfo.authData.authMethodId,
          },
        },
      })
      
      setAuthContext(customAuthContext)
      addLog(`✅ PKP claimed successfully!`)
      
    } catch (err: any) {
      console.error('Claim error:', err)
      setError(err.message)
    } finally {
      if (litClient) await litClient.disconnect()
      setIsLoading(false)
    }
  }

  // Step 5: Sign with PKP
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
      
      const message = `I am ${userHandle} on TikTok, authenticated serverlessly!`
      const messageBytes = new TextEncoder().encode(message)
      
      const signatures = await litClient.chain.raw.pkpSign({
        chain: "ethereum",
        signingScheme: "EcdsaK256Sha256",
        pubKey: pkpInfo.pubkey,
        authContext: authContext,
        toSign: messageBytes,
      })
      
      setSignedMessage(JSON.stringify(signatures, null, 2))
      addLog('✅ Message signed!')
      
    } catch (err: any) {
      console.error('Signing error:', err)
      setError(err.message)
    } finally {
      if (litClient) await litClient.disconnect()
      setIsLoading(false)
    }
  }

  return (
    <div style={{ padding: '20px', maxWidth: '1200px', margin: '0 auto' }}>
      <h1>🚀 TikTok Serverless OAuth + PKP</h1>
      
      <div style={{ 
        backgroundColor: '#e8f5e9', 
        padding: '15px', 
        borderRadius: '8px',
        marginBottom: '20px' 
      }}>
        <h3>✨ NO BACKEND NEEDED!</h3>
        <p>Everything runs in Lit Actions (decentralized compute)</p>
        <ul style={{ fontSize: '14px' }}>
          <li>✅ OAuth token exchange in Lit Action</li>
          <li>✅ Token validation in Lit Action</li>
          <li>✅ PKP control via custom auth</li>
          <li>✅ Completely serverless!</li>
        </ul>
      </div>

      {/* Test Mode Toggle */}
      <div style={{ marginBottom: '20px', padding: '10px', backgroundColor: '#fff3e0', borderRadius: '5px' }}>
        <label style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
          <input
            type="checkbox"
            checked={testMode}
            onChange={(e) => setTestMode(e.target.checked)}
          />
          <span>Test Mode (Skip TikTok OAuth)</span>
        </label>
        {testMode && (
          <p style={{ fontSize: '12px', color: '#666', marginTop: '5px' }}>
            Test mode will simulate OAuth with handle: @testuser
          </p>
        )}
      </div>

      {/* OAuth Flow */}
      <div style={{ 
        border: '2px solid #ff0050', 
        padding: '20px', 
        borderRadius: '8px',
        marginBottom: '20px' 
      }}>
        <h2>Serverless OAuth Flow</h2>
        
        {/* Step 1: Start OAuth */}
        {!authCode && !accessToken && (
          <div style={{ marginBottom: '20px' }}>
            <h3>Step 1: Login with TikTok</h3>
            {testMode ? (
              <button
                onClick={() => {
                  addLog('Test mode: Simulating OAuth success')
                  setAccessToken('test-testuser')
                  setUserHandle('@testuser')
                  localStorage.setItem('tiktok_access_token', 'test-testuser')
                  localStorage.setItem('tiktok_handle', '@testuser')
                }}
                style={{
                  padding: '12px 24px',
                  backgroundColor: '#4CAF50',
                  color: 'white',
                  border: 'none',
                  borderRadius: '5px',
                  cursor: 'pointer',
                  fontSize: '16px'
                }}
              >
                🧪 Simulate OAuth (Test Mode)
              </button>
            ) : (
              <>
                <button
                  onClick={startOAuthFlow}
                  style={{
                    padding: '12px 24px',
                    backgroundColor: '#000',
                    color: 'white',
                    border: '2px solid #ff0050',
                    borderRadius: '5px',
                    cursor: 'pointer',
                    fontSize: '16px'
                  }}
                >
                  🎵 Login with TikTok
                </button>
                <p style={{ fontSize: '12px', color: '#666', marginTop: '10px' }}>
                  Sandbox mode: Use test account "qw45wafdfadsfadsf"
                </p>
              </>
            )}
          </div>
        )}

        {/* Step 2: Exchange Code */}
        {authCode && !accessToken && (
          <div style={{ marginBottom: '20px' }}>
            <h3>Step 2: Exchange Code (Serverless)</h3>
            <div style={{ 
              padding: '10px', 
              backgroundColor: '#f5f5f5',
              borderRadius: '5px',
              fontFamily: 'monospace',
              fontSize: '12px',
              marginBottom: '10px'
            }}>
              Code received: {authCode.substring(0, 20)}...
            </div>
            <button
              onClick={exchangeCodeServerlessly}
              disabled={isLoading}
              style={{
                padding: '10px 20px',
                backgroundColor: '#4CAF50',
                color: 'white',
                border: 'none',
                borderRadius: '5px',
                cursor: isLoading ? 'not-allowed' : 'pointer'
              }}
            >
              {isLoading ? 'Processing...' : 'Exchange via Lit Action'}
            </button>
            <p style={{ fontSize: '11px', color: '#666', marginTop: '5px' }}>
              Token exchange happens in Lit Action - no backend!
            </p>
          </div>
        )}

        {/* Step 3: PKP Query */}
        {accessToken && !pkpInfo && (
          <div style={{ marginBottom: '20px' }}>
            <h3>Step 3: Query PKP</h3>
            <div style={{ 
              padding: '10px', 
              backgroundColor: '#e8f5e9',
              borderRadius: '5px',
              marginBottom: '10px'
            }}>
              <strong>User:</strong> {userHandle}<br/>
              <strong>Token:</strong> {accessToken.substring(0, 30)}...
            </div>
            <button
              onClick={queryPKPFromRegistry}
              disabled={isLoading}
              style={{
                padding: '10px 20px',
                backgroundColor: '#2196F3',
                color: 'white',
                border: 'none',
                borderRadius: '5px',
                cursor: isLoading ? 'not-allowed' : 'pointer'
              }}
            >
              Query PKP from Registry
            </button>
          </div>
        )}

        {/* Step 4: Claim PKP */}
        {pkpInfo && !authContext && (
          <div style={{ marginBottom: '20px' }}>
            <h3>Step 4: Claim PKP</h3>
            <div style={{ 
              padding: '10px', 
              backgroundColor: '#f3e5f5',
              borderRadius: '5px',
              marginBottom: '10px'
            }}>
              <strong>PKP:</strong> {pkpInfo.pubkey.substring(0, 66)}...
            </div>
            <button
              onClick={claimPKPWithOAuth}
              disabled={isLoading}
              style={{
                padding: '10px 20px',
                backgroundColor: '#9C27B0',
                color: 'white',
                border: 'none',
                borderRadius: '5px',
                cursor: isLoading ? 'not-allowed' : 'pointer'
              }}
            >
              Claim PKP (Validation in Lit Action)
            </button>
          </div>
        )}

        {/* Step 5: Use PKP */}
        {authContext && (
          <div style={{ marginBottom: '20px' }}>
            <h3>Step 5: Use Your PKP</h3>
            <button
              onClick={signWithPKP}
              disabled={isLoading}
              style={{
                padding: '10px 20px',
                backgroundColor: '#FF5722',
                color: 'white',
                border: 'none',
                borderRadius: '5px',
                cursor: isLoading ? 'not-allowed' : 'pointer'
              }}
            >
              Sign Message with PKP
            </button>
          </div>
        )}
      </div>

      {/* Signed Message */}
      {signedMessage && (
        <div style={{ 
          border: '1px solid #4CAF50',
          padding: '15px',
          borderRadius: '8px',
          marginBottom: '20px'
        }}>
          <h3>✅ Signed Message</h3>
          <pre style={{ 
            padding: '10px', 
            backgroundColor: '#f5f5f5',
            borderRadius: '5px',
            fontSize: '11px',
            overflow: 'auto'
          }}>
            {signedMessage}
          </pre>
        </div>
      )}

      {/* Validation Code Display */}
      <details style={{ marginBottom: '20px' }}>
        <summary style={{ cursor: 'pointer', padding: '10px', backgroundColor: '#f0f0f0', borderRadius: '5px' }}>
          📝 View OAuth Validation Code (runs on Lit nodes)
        </summary>
        <pre style={{ 
          padding: '10px', 
          backgroundColor: '#263238',
          color: '#aed581',
          borderRadius: '5px',
          fontSize: '11px',
          overflow: 'auto',
          marginTop: '10px'
        }}>
          {getOAuthValidationCode()}
        </pre>
      </details>

      {/* Activity Log */}
      <div style={{ 
        border: '1px solid #ddd', 
        padding: '15px', 
        borderRadius: '8px',
        backgroundColor: '#f9f9f9'
      }}>
        <h3>📋 Activity Log</h3>
        <div style={{ 
          maxHeight: '150px', 
          overflow: 'auto',
          fontFamily: 'monospace',
          fontSize: '11px'
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
          color: '#c62828',
          marginTop: '20px'
        }}>
          Error: {error}
        </div>
      )}
    </div>
  )
}
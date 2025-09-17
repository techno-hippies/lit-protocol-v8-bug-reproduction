import { useState, useEffect } from 'react'
import { createLitClient } from '@lit-protocol/lit-client'
import { nagaDev } from '@lit-protocol/networks'
import { createAuthManager, storagePlugins } from "@lit-protocol/auth"
import { utils as litUtils } from '@lit-protocol/lit-client'
import { createPublicClient, http } from 'viem'
import { baseSepolia } from 'viem/chains'

// TikTok OAuth Configuration
const TIKTOK_CLIENT_KEY = 'sbawo9fqgbt8nt9s8g'
const REDIRECT_URI = 'https://c52fb18324f0.ngrok-free.app' // EXACT portal match - no /callback
const TIKTOK_AUTH_URL = 'https://www.tiktok.com/v2/auth/authorize'
const TIKTOK_TOKEN_URL = 'https://open.tiktokapis.com/v2/oauth/token/'
const TIKTOK_USER_INFO_URL = 'https://open.tiktokapis.com/v2/user/info/'

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
    "inputs": [
      { "name": "handle", "type": "string" },
      { "name": "pkpPublicKey", "type": "string" }
    ],
    "name": "registerCreator",
    "outputs": [],
    "stateMutability": "nonpayable",
    "type": "function"
  }
] as const

const authManager = createAuthManager({
  storage: storagePlugins.localStorage({
    appName: "tiktok-oauth-pkp",
    networkName: "naga-dev",
  }),
})

export function TikTokOAuthConfig() {
  const [authCode, setAuthCode] = useState('')
  const [accessToken, setAccessToken] = useState('')
  const [userInfo, setUserInfo] = useState<any>(null)
  const [pkpInfo, setPkpInfo] = useState<any>(null)
  const [authContext, setAuthContext] = useState<any>(null)
  const [signedMessage, setSignedMessage] = useState('')
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState('')
  const [logs, setLogs] = useState<string[]>([])

  const authMethodConfig = litUtils.generateUniqueAuthMethodType({
    uniqueDappName: 'tiktok-oauth-v1'
  })

  const addLog = (message: string) => {
    setLogs(prev => [...prev, `[${new Date().toLocaleTimeString()}] ${message}`])
    console.log(message)
  }

  // Step 1: Initiate OAuth flow
  const startOAuthFlow = () => {
    const csrfState = Math.random().toString(36).substring(7)
    localStorage.setItem('tiktok_csrf_state', csrfState)
    
    const params = new URLSearchParams({
      client_key: TIKTOK_CLIENT_KEY,
      scope: 'user.info.basic,user.info.profile,user.info.stats',
      response_type: 'code',
      redirect_uri: REDIRECT_URI,
      state: csrfState
    })
    
    const authUrl = `${TIKTOK_AUTH_URL}?${params.toString()}`
    addLog('Redirecting to TikTok OAuth...')
    window.location.href = authUrl
  }

  // Step 2: Handle OAuth callback
  useEffect(() => {
    const urlParams = new URLSearchParams(window.location.search)
    const code = urlParams.get('code')
    const state = urlParams.get('state')
    const errorParam = urlParams.get('error')
    const errorDesc = urlParams.get('error_description')
    
    // Handle OAuth errors
    if (errorParam) {
      if (errorParam === 'access_denied') {
        setError('Access denied. Did you click "Cancel" instead of "Authorize"? Make sure to use test account: qw45wafdfadsfadsf and click Authorize.')
        addLog(`❌ OAuth Error: User denied access`)
      } else {
        setError(`OAuth Error: ${errorParam} - ${errorDesc || 'Unknown error'}`)
        addLog(`❌ OAuth Error: ${errorParam}`)
      }
      // Clear URL params
      window.history.replaceState({}, document.title, window.location.pathname)
      return
    }
    
    // Handle successful callback
    if (code && state) {
      const savedState = localStorage.getItem('tiktok_csrf_state')
      if (state === savedState) {
        setAuthCode(code)
        addLog('OAuth code received: ' + code.substring(0, 10) + '...')
        // Clear URL params
        window.history.replaceState({}, document.title, window.location.pathname)
      } else {
        setError('Invalid state parameter - possible CSRF attack')
      }
    }
  }, [])

  // Step 3: Exchange code for access token
  const exchangeCodeForToken = async () => {
    if (!authCode) {
      setError('No authorization code available')
      return
    }

    setIsLoading(true)
    setError('')

    try {
      addLog('Exchanging code for access token...')
      
      // NOTE: This needs to be done server-side in production
      // TikTok requires client_secret which can't be exposed in frontend
      const params = new URLSearchParams({
        client_key: TIKTOK_CLIENT_KEY,
        client_secret: 'W6fuS8P6NR42tigXqcFD9AvajC7cRbtT', // ONLY FOR TESTING - move to backend!
        code: authCode,
        grant_type: 'authorization_code',
        redirect_uri: REDIRECT_URI
      })

      // In production, call your backend endpoint instead
      const response = await fetch(TIKTOK_TOKEN_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: params.toString()
      })

      const data = await response.json()
      
      if (data.access_token) {
        setAccessToken(data.access_token)
        localStorage.setItem('tiktok_access_token', data.access_token)
        addLog('✅ Access token obtained!')
      } else {
        throw new Error(data.error_description || 'Failed to get access token')
      }
      
    } catch (err: any) {
      console.error('Token exchange error:', err)
      setError(err.message)
    } finally {
      setIsLoading(false)
    }
  }

  // Step 4: Get user info
  const getUserInfo = async () => {
    if (!accessToken) {
      setError('No access token available')
      return
    }

    setIsLoading(true)
    setError('')

    try {
      addLog('Fetching TikTok user info...')
      
      const response = await fetch(TIKTOK_USER_INFO_URL + '?fields=open_id,union_id,avatar_url,display_name', {
        headers: {
          'Authorization': `Bearer ${accessToken}`,
        }
      })

      const data = await response.json()
      
      if (data.data && data.data.user) {
        setUserInfo(data.data.user)
        addLog(`✅ User info obtained: @${data.data.user.display_name}`)
      } else {
        throw new Error('Failed to get user info')
      }
      
    } catch (err: any) {
      console.error('User info error:', err)
      setError(err.message)
    } finally {
      setIsLoading(false)
    }
  }

  // Step 5: Query PKP from registry
  const queryPKPFromRegistry = async () => {
    if (!userInfo?.display_name) {
      setError('Please get user info first')
      return
    }

    setIsLoading(true)
    setError('')

    try {
      const handle = `@${userInfo.display_name}`
      addLog(`Querying registry for ${handle}...`)
      
      const publicClient = createPublicClient({
        chain: baseSepolia,
        transport: http()
      })

      const pkpPublicKey = await publicClient.readContract({
        address: REGISTRY_ADDRESS,
        abi: REGISTRY_ABI,
        functionName: 'getPkp',
        args: [handle]
      })

      if (pkpPublicKey && pkpPublicKey !== '0x') {
        addLog(`✅ Found PKP: ${pkpPublicKey.substring(0, 30)}...`)
        
        const authData = litUtils.generateAuthData({
          uniqueDappName: 'tiktok-oauth-v1',
          uniqueAuthMethodType: authMethodConfig.bigint,
          userId: handle
        })

        setPkpInfo({
          pubkey: pkpPublicKey,
          handle: handle,
          authData: authData
        })
      } else {
        setError(`No PKP found for ${handle}. Admin needs to mint one first.`)
      }
      
    } catch (err: any) {
      console.error('Registry query error:', err)
      setError(err.message)
    } finally {
      setIsLoading(false)
    }
  }

  // Step 6: Create validation Lit Action for OAuth
  const getOAuthValidationCode = () => {
    return `
(async () => {
  const dAppUniqueAuthMethodType = "${authMethodConfig.hex}";
  const { pkpPublicKey, handle, accessToken, authMethodId } = jsParams;
  
  // Validate OAuth token by calling TikTok API
  let tokenIsValid = false;
  
  try {
    const response = await fetch('https://open.tiktokapis.com/v2/user/info/?fields=display_name', {
      headers: {
        'Authorization': 'Bearer ' + accessToken,
      }
    });
    
    const data = await response.json();
    
    // Check if the display_name matches the handle
    if (data.data && data.data.user) {
      const tokenHandle = '@' + data.data.user.display_name;
      tokenIsValid = (tokenHandle === handle);
    }
  } catch (err) {
    console.log('OAuth validation error:', err);
    tokenIsValid = false;
  }
  
  // Check PKP permissions
  const tokenId = await Lit.Actions.pubkeyToTokenId({ publicKey: pkpPublicKey });
  const permittedAuthMethods = await Lit.Actions.getPermittedAuthMethods({ tokenId });
  
  const isPermitted = permittedAuthMethods.some((permittedAuthMethod) => {
    return permittedAuthMethod["auth_method_type"] === dAppUniqueAuthMethodType && 
           permittedAuthMethod["id"] === authMethodId;
  });
  
  const isValid = isPermitted && tokenIsValid;
  
  console.log('OAuth Validation:', {
    handle,
    tokenIsValid,
    isPermitted,
    result: isValid
  });
  
  LitActions.setResponse({ response: isValid ? "true" : "false" });
})();`
  }

  // Step 7: Claim PKP with OAuth token
  const claimPKPWithOAuth = async () => {
    if (!pkpInfo || !accessToken) {
      setError('Please complete OAuth flow and query PKP first')
      return
    }

    setIsLoading(true)
    setError('')
    let litClient: any = null

    try {
      addLog(`Claiming PKP for ${pkpInfo.handle}...`)
      
      litClient = await createLitClient({ network: nagaDev })
      
      // Create custom auth context with real OAuth token
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
          litActionIpfsId: 'QmYourOAuthValidationCid', // Pin the OAuth validation code
          jsParams: {
            pkpPublicKey: pkpInfo.pubkey,
            handle: pkpInfo.handle,
            accessToken: accessToken,
            authMethodId: pkpInfo.authData.authMethodId,
          },
        },
      })
      
      setAuthContext(customAuthContext)
      addLog(`✅ PKP claimed successfully for ${pkpInfo.handle}!`)
      
    } catch (err: any) {
      console.error('Claim error:', err)
      setError(err.message)
    } finally {
      if (litClient) await litClient.disconnect()
      setIsLoading(false)
    }
  }

  // Step 8: Sign with claimed PKP
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
      
      const message = `I am ${userInfo.display_name} on TikTok, authenticated via OAuth!`
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

  return (
    <div style={{ padding: '20px', maxWidth: '1200px', margin: '0 auto' }}>
      <h1>🎵 TikTok OAuth + PKP Integration</h1>
      
      {/* TikTok App Info */}
      <div style={{ 
        backgroundColor: '#000', 
        color: '#fff',
        padding: '15px', 
        borderRadius: '8px',
        marginBottom: '20px' 
      }}>
        <h3>📱 TikTok App Configuration</h3>
        <p style={{ fontFamily: 'monospace', fontSize: '12px' }}>
          <strong>App Name:</strong> KSchool<br/>
          <strong>Client Key:</strong> {TIKTOK_CLIENT_KEY}<br/>
          <strong>Mode:</strong> Sandbox (Test Users Only)<br/>
          <strong>Redirect URI:</strong> {REDIRECT_URI}
        </p>
      </div>

      {/* OAuth Flow */}
      <div style={{ 
        border: '2px solid #ff0050', 
        padding: '20px', 
        borderRadius: '8px',
        marginBottom: '20px' 
      }}>
        <h2>OAuth Flow</h2>
        
        {/* Step 1: Start OAuth */}
        <div style={{ marginBottom: '20px' }}>
          <h3>Step 1: Authenticate with TikTok</h3>
          <button
            onClick={startOAuthFlow}
            style={{
              padding: '10px 20px',
              backgroundColor: '#ff0050',
              color: 'white',
              border: 'none',
              borderRadius: '5px',
              cursor: 'pointer'
            }}
          >
            🎵 Login with TikTok
          </button>
          <p style={{ fontSize: '12px', color: '#666', marginTop: '10px' }}>
            Note: Sandbox mode only works with authorized test accounts
          </p>
        </div>

        {/* Step 2: Auth Code */}
        {authCode && (
          <div style={{ marginBottom: '20px' }}>
            <h3>Step 2: Authorization Code</h3>
            <div style={{ 
              padding: '10px', 
              backgroundColor: '#f5f5f5',
              borderRadius: '5px',
              fontFamily: 'monospace',
              fontSize: '12px'
            }}>
              Code: {authCode.substring(0, 20)}...
            </div>
            <button
              onClick={exchangeCodeForToken}
              disabled={isLoading}
              style={{
                marginTop: '10px',
                padding: '10px 20px',
                backgroundColor: '#4CAF50',
                color: 'white',
                border: 'none',
                borderRadius: '5px',
                cursor: isLoading ? 'not-allowed' : 'pointer'
              }}
            >
              Exchange for Access Token
            </button>
            <p style={{ fontSize: '11px', color: '#ff9800', marginTop: '5px' }}>
              ⚠️ In production, this must be done server-side to protect client_secret
            </p>
          </div>
        )}

        {/* Step 3: Access Token */}
        {accessToken && (
          <div style={{ marginBottom: '20px' }}>
            <h3>Step 3: Access Token</h3>
            <div style={{ 
              padding: '10px', 
              backgroundColor: '#e8f5e9',
              borderRadius: '5px',
              fontFamily: 'monospace',
              fontSize: '12px'
            }}>
              Token: {accessToken.substring(0, 30)}...
            </div>
            <button
              onClick={getUserInfo}
              disabled={isLoading}
              style={{
                marginTop: '10px',
                padding: '10px 20px',
                backgroundColor: '#2196F3',
                color: 'white',
                border: 'none',
                borderRadius: '5px',
                cursor: isLoading ? 'not-allowed' : 'pointer'
              }}
            >
              Get User Info
            </button>
          </div>
        )}

        {/* Step 4: User Info */}
        {userInfo && (
          <div style={{ marginBottom: '20px' }}>
            <h3>Step 4: TikTok User Info</h3>
            <div style={{ 
              padding: '10px', 
              backgroundColor: '#f5f5f5',
              borderRadius: '5px'
            }}>
              <strong>Display Name:</strong> @{userInfo.display_name}<br/>
              <strong>Open ID:</strong> {userInfo.open_id}<br/>
              {userInfo.avatar_url && (
                <img 
                  src={userInfo.avatar_url} 
                  alt="Avatar" 
                  style={{ width: '50px', height: '50px', borderRadius: '25px', marginTop: '10px' }}
                />
              )}
            </div>
            <button
              onClick={queryPKPFromRegistry}
              disabled={isLoading}
              style={{
                marginTop: '10px',
                padding: '10px 20px',
                backgroundColor: '#FF9800',
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
      </div>

      {/* PKP Management */}
      {pkpInfo && (
        <div style={{ 
          border: '2px solid #9C27B0', 
          padding: '20px', 
          borderRadius: '8px',
          marginBottom: '20px' 
        }}>
          <h2>PKP Management</h2>
          
          <div style={{ marginBottom: '20px' }}>
            <h3>PKP Info</h3>
            <div style={{ 
              padding: '10px', 
              backgroundColor: '#f5f5f5',
              borderRadius: '5px',
              fontSize: '12px'
            }}>
              <strong>Handle:</strong> {pkpInfo.handle}<br/>
              <strong>PKP Public Key:</strong> {pkpInfo.pubkey.substring(0, 66)}...
            </div>
          </div>

          <div style={{ marginBottom: '20px' }}>
            <h3>OAuth Validation Code</h3>
            <details>
              <summary style={{ cursor: 'pointer' }}>View Validation Code</summary>
              <textarea
                value={getOAuthValidationCode()}
                readOnly
                style={{ 
                  width: '100%', 
                  height: '200px', 
                  padding: '10px',
                  fontFamily: 'monospace',
                  fontSize: '11px',
                  backgroundColor: '#f5f5f5',
                  borderRadius: '5px',
                  border: '1px solid #ddd',
                  marginTop: '10px'
                }}
              />
            </details>
            <p style={{ fontSize: '11px', color: '#666', marginTop: '5px' }}>
              This validation code checks the OAuth token against TikTok API
            </p>
          </div>

          <button
            onClick={claimPKPWithOAuth}
            disabled={isLoading || authContext}
            style={{
              padding: '10px 20px',
              backgroundColor: authContext ? '#4CAF50' : '#9C27B0',
              color: 'white',
              border: 'none',
              borderRadius: '5px',
              cursor: (isLoading || authContext) ? 'not-allowed' : 'pointer',
              marginRight: '10px'
            }}
          >
            {authContext ? '✅ PKP Claimed' : 'Claim PKP with OAuth'}
          </button>

          {authContext && (
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
          )}
        </div>
      )}

      {/* Signed Message */}
      {signedMessage && (
        <div style={{ marginBottom: '20px' }}>
          <h3>Signed Message</h3>
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

      {/* Logs */}
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

      {/* Important Notes */}
      <div style={{ 
        backgroundColor: '#fff3e0', 
        padding: '15px', 
        borderRadius: '8px',
        marginTop: '20px' 
      }}>
        <h3>⚠️ Important Setup Notes:</h3>
        <ol>
          <li><strong>Sandbox Mode:</strong> Add test users in TikTok app settings</li>
          <li><strong>Redirect URI:</strong> Must match exactly: {REDIRECT_URI}</li>
          <li><strong>Client Secret:</strong> Must be kept server-side in production</li>
          <li><strong>Scopes Needed:</strong>
            <ul>
              <li>user.info.basic - Get display name</li>
              <li>user.info.profile - Get avatar</li>
              <li>user.info.stats - Get follower count (optional)</li>
            </ul>
          </li>
          <li><strong>PKP Registry:</strong> Admin must pre-mint PKP for TikTok handle</li>
        </ol>
      </div>
    </div>
  )
}
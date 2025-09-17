import { useState } from 'react'
import { createLitClient } from '@lit-protocol/lit-client'
import { nagaDev } from '@lit-protocol/networks'
import { createAuthManager, storagePlugins, WebAuthnAuthenticator } from "@lit-protocol/auth"
import { ethers } from 'ethers'

const authManager = createAuthManager({
  storage: storagePlugins.localStorage({
    appName: "my-dapp",
    networkName: "naga-dev",
  }),
});

export function WebAuthnPKPDemo() {
  const [pkpInfo, setPkpInfo] = useState<any>(null)
  const [authData, setAuthData] = useState<any>(null)
  const [signedMessage, setSignedMessage] = useState<string>('')
  const [litActionResult, setLitActionResult] = useState<string>('')
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string>('')

  // Step 1: Register WebAuthn and mint PKP
  const registerAndMint = async () => {
    setIsLoading(true)
    setError('')
    
    try {
      // Register WebAuthn credential and mint PKP in one step
      const { pkpInfo: mintedPkp, webAuthnPublicKey } = await WebAuthnAuthenticator.registerAndMintPKP({
        authServiceBaseUrl: "https://naga-auth-service.onrender.com",
        scopes: ["sign-anything"],
      })
      
      console.log('PKP minted with WebAuthn:', mintedPkp)
      setPkpInfo(mintedPkp)
      
      // Store for future use
      localStorage.setItem('webauthn-pkp', JSON.stringify(mintedPkp))
      
    } catch (err: any) {
      console.error('Registration failed:', err)
      setError(err.message)
    } finally {
      setIsLoading(false)
    }
  }

  // Step 1b: Authenticate with existing WebAuthn
  const authenticateExisting = async () => {
    setIsLoading(true)
    setError('')
    
    try {
      const authDataResult = await WebAuthnAuthenticator.authenticate({
        authServiceBaseUrl: "https://naga-auth-service.onrender.com",
      })
      
      console.log('Authenticated with WebAuthn:', authDataResult)
      setAuthData(authDataResult)
      
      // Fetch associated PKPs
      const litClient = await createLitClient({ network: nagaDev })
      const result = await litClient.viewPKPsByAuthData({
        authData: {
          authMethodType: authDataResult.authMethodType,
          authMethodId: authDataResult.authMethodId,
        },
        pagination: { limit: 1, offset: 0 }
      })
      
      if (result.pkps.length > 0) {
        setPkpInfo(result.pkps[0])
      }
      
      await litClient.disconnect()
      
    } catch (err: any) {
      console.error('Authentication failed:', err)
      setError(err.message)
    } finally {
      setIsLoading(false)
    }
  }

  // Step 2: Sign a message with PKP
  const signWithPKP = async () => {
    if (!pkpInfo || !authData) {
      setError('Please register or authenticate first')
      return
    }
    
    setIsLoading(true)
    setError('')
    
    try {
      const litClient = await createLitClient({ network: nagaDev })
      
      // Create auth context
      const authContext = await authManager.createPkpAuthContext({
        authData: authData,
        pkpPublicKey: pkpInfo.pubkey || pkpInfo.publicKey,
        authConfig: {
          resources: [
            ["pkp-signing", "*"],
            ["lit-action-execution", "*"],
          ],
          capabilityAuthSigs: [],
          expiration: new Date(Date.now() + 1000 * 60 * 60 * 24).toISOString(),
          statement: "",
          domain: window.location.origin,
        },
        litClient: litClient,
      })
      
      // Sign message
      const message = "Hello from WebAuthn PKP!"
      const messageBytes = new TextEncoder().encode(message)
      
      const signatures = await litClient.chain.raw.pkpSign({
        chain: "ethereum",
        signingScheme: "EcdsaK256Sha256",
        pubKey: pkpInfo.pubkey || pkpInfo.publicKey,
        authContext: authContext,
        toSign: messageBytes,
      })
      
      console.log('Signed message:', signatures)
      setSignedMessage(JSON.stringify(signatures, null, 2))
      
      await litClient.disconnect()
      
    } catch (err: any) {
      console.error('Signing failed:', err)
      setError(err.message)
    } finally {
      setIsLoading(false)
    }
  }

  // Step 3: Execute Lit Action
  const executeLitAction = async () => {
    if (!pkpInfo || !authData) {
      setError('Please register or authenticate first')
      return
    }
    
    setIsLoading(true)
    setError('')
    
    try {
      const litClient = await createLitClient({ network: nagaDev })
      
      // Create auth context
      const authContext = await authManager.createPkpAuthContext({
        authData: authData,
        pkpPublicKey: pkpInfo.pubkey || pkpInfo.publicKey,
        authConfig: {
          resources: [
            ["pkp-signing", "*"],
            ["lit-action-execution", "*"],
          ],
          capabilityAuthSigs: [],
          expiration: new Date(Date.now() + 1000 * 60 * 60 * 24).toISOString(),
          statement: "",
          domain: window.location.origin,
        },
        litClient: litClient,
      })
      
      // Execute Lit Action
      const litActionCode = `
        const go = async () => {
          // Access to PKP for signing
          const pkpPublicKey = Lit.Actions.params.pkpPublicKey;
          
          // Can make HTTP requests
          const response = await fetch('https://api.coingecko.com/api/v3/simple/price?ids=ethereum&vs_currencies=usd');
          const data = await response.json();
          
          // Return result
          Lit.Actions.setResponse({ 
            response: JSON.stringify({
              message: "Hello from WebAuthn PKP Lit Action!",
              pkpPublicKey: pkpPublicKey,
              ethPrice: data.ethereum.usd,
              timestamp: new Date().toISOString()
            })
          });
        };
        go();
      `;
      
      const result = await litClient.executeJs({
        code: litActionCode,
        authContext: authContext,
        jsParams: {
          pkpPublicKey: pkpInfo.pubkey || pkpInfo.publicKey,
        },
      })
      
      console.log('Lit Action result:', result)
      if (result?.response) {
        const data = typeof result.response === 'string' 
          ? JSON.parse(result.response) 
          : result.response
        setLitActionResult(JSON.stringify(data, null, 2))
      }
      
      await litClient.disconnect()
      
    } catch (err: any) {
      console.error('Lit Action failed:', err)
      setError(err.message)
    } finally {
      setIsLoading(false)
    }
  }

  return (
    <div style={{ padding: '20px', maxWidth: '800px', margin: '0 auto' }}>
      <h1>WebAuthn + PKP Demo</h1>
      
      <div style={{ 
        backgroundColor: '#e3f2fd', 
        padding: '15px', 
        borderRadius: '8px',
        marginBottom: '20px' 
      }}>
        <h3>Why This is Perfect for dApps:</h3>
        <ul>
          <li>✅ No seed phrases - just Touch ID/Face ID</li>
          <li>✅ Works on any device with biometrics</li>
          <li>✅ Full blockchain capabilities (sign, transact, etc.)</li>
          <li>✅ Seamless Web2-like user experience</li>
          <li>✅ Hardware-backed security</li>
        </ul>
      </div>

      {/* Step 1: Register/Authenticate */}
      <div style={{ 
        border: '1px solid #ddd', 
        padding: '15px', 
        borderRadius: '8px',
        marginBottom: '20px' 
      }}>
        <h3>Step 1: WebAuthn Registration</h3>
        
        <button
          onClick={registerAndMint}
          disabled={isLoading || pkpInfo}
          style={{
            padding: '10px 20px',
            backgroundColor: pkpInfo ? '#4caf50' : '#2196f3',
            color: 'white',
            border: 'none',
            borderRadius: '5px',
            marginRight: '10px',
            cursor: isLoading || pkpInfo ? 'not-allowed' : 'pointer'
          }}
        >
          {pkpInfo ? '✅ PKP Registered' : 'Register with Touch/Face ID'}
        </button>
        
        <button
          onClick={authenticateExisting}
          disabled={isLoading || pkpInfo}
          style={{
            padding: '10px 20px',
            backgroundColor: '#9c27b0',
            color: 'white',
            border: 'none',
            borderRadius: '5px',
            cursor: isLoading || pkpInfo ? 'not-allowed' : 'pointer'
          }}
        >
          Authenticate Existing
        </button>
        
        {pkpInfo && (
          <div style={{ marginTop: '10px', fontSize: '12px', color: '#666' }}>
            PKP: {pkpInfo.pubkey?.substring(0, 20) || pkpInfo.publicKey?.substring(0, 20)}...
          </div>
        )}
      </div>

      {/* Step 2: Sign Message */}
      <div style={{ 
        border: '1px solid #ddd', 
        padding: '15px', 
        borderRadius: '8px',
        marginBottom: '20px' 
      }}>
        <h3>Step 2: Sign with PKP</h3>
        
        <button
          onClick={signWithPKP}
          disabled={isLoading || !pkpInfo}
          style={{
            padding: '10px 20px',
            backgroundColor: '#ff9800',
            color: 'white',
            border: 'none',
            borderRadius: '5px',
            cursor: isLoading || !pkpInfo ? 'not-allowed' : 'pointer'
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

      {/* Step 3: Execute Lit Action */}
      <div style={{ 
        border: '1px solid #ddd', 
        padding: '15px', 
        borderRadius: '8px',
        marginBottom: '20px' 
      }}>
        <h3>Step 3: Execute Lit Action</h3>
        
        <button
          onClick={executeLitAction}
          disabled={isLoading || !pkpInfo}
          style={{
            padding: '10px 20px',
            backgroundColor: '#4caf50',
            color: 'white',
            border: 'none',
            borderRadius: '5px',
            cursor: isLoading || !pkpInfo ? 'not-allowed' : 'pointer'
          }}
        >
          Execute Lit Action (Fetch ETH Price)
        </button>
        
        {litActionResult && (
          <pre style={{ 
            marginTop: '10px', 
            padding: '10px', 
            backgroundColor: '#f5f5f5',
            borderRadius: '5px',
            fontSize: '12px',
            overflow: 'auto'
          }}>
            {litActionResult}
          </pre>
        )}
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

      {/* Use Cases */}
      <div style={{ 
        backgroundColor: '#f0f4c3', 
        padding: '15px', 
        borderRadius: '8px',
        marginTop: '20px' 
      }}>
        <h3>Real dApp Use Cases:</h3>
        <ul>
          <li><strong>DeFi:</strong> Trade with Face ID confirmation</li>
          <li><strong>Gaming:</strong> In-game purchases with Touch ID</li>
          <li><strong>Social:</strong> Sign posts/messages with biometrics</li>
          <li><strong>NFTs:</strong> Mint & trade with hardware security</li>
          <li><strong>DAOs:</strong> Vote with fingerprint authentication</li>
        </ul>
      </div>
    </div>
  )
}
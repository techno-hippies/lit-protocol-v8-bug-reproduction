import { formatEther, parseEther } from 'viem'
import {
  type BaseError,
  useAccount,
  useConnect,
  useDisconnect,
  useReadContract,
  useSendCalls,
  useWaitForCallsStatus,
} from 'wagmi'
import { exp1Address, exp1Config } from './contracts'
import { useState, lazy, Suspense, useEffect } from 'react'

// Lazy load the Lit Action component to avoid loading Lit SDK until needed
const LitActionTest = lazy(() => import('./LitActionTest').then(module => ({ default: module.LitActionTest })))
const TikTokPKPLiveTest = lazy(() => import('./TikTokPKPLiveTest').then(module => ({ default: module.TikTokPKPLiveTest })))
const TikTokOAuthConfig = lazy(() => import('./TikTokOAuthConfig').then(module => ({ default: module.TikTokOAuthConfig })))

export function App() {
  const { isConnected } = useAccount()
  const [showLitAction, setShowLitAction] = useState(false)
  const [showTikTokTest, setShowTikTokTest] = useState(false)
  const [showTikTokOAuth, setShowTikTokOAuth] = useState(false)
  
  // Handle OAuth callback by checking URL
  useEffect(() => {
    const urlParams = new URLSearchParams(window.location.search)
    if (urlParams.has('code') || urlParams.has('error')) {
      // OAuth callback detected, show TikTok OAuth component
      setShowTikTokOAuth(true)
    }
  }, [])
  
  return (
    <>
      <Account />
      {isConnected ? (
        <>
          <Balance />
          <Mint />
          <div style={{ marginTop: '20px' }}>
            <button 
              onClick={() => setShowLitAction(!showLitAction)}
              style={{ 
                padding: '10px 20px', 
                backgroundColor: '#28a745',
                color: 'white',
                border: 'none',
                borderRadius: '5px',
                cursor: 'pointer'
              }}
            >
              {showLitAction ? 'Hide Lit v8 Bug Demo' : 'Show Lit v8 Bug Demo'}
            </button>
            {showLitAction && (
              <Suspense fallback={<div>Loading Lit Action...</div>}>
                <div style={{ marginTop: '20px' }}>
                  <LitActionTest />
                </div>
              </Suspense>
            )}
          </div>
          <div style={{ marginTop: '20px' }}>
            <button 
              onClick={() => setShowTikTokTest(!showTikTokTest)}
              style={{ 
                padding: '10px 20px', 
                backgroundColor: '#ff1744',
                color: 'white',
                border: 'none',
                borderRadius: '5px',
                cursor: 'pointer'
              }}
            >
              {showTikTokTest ? 'Hide TikTok PKP Test' : '🔴 Show TikTok PKP Live Test'}
            </button>
            {showTikTokTest && (
              <Suspense fallback={<div>Loading TikTok Test...</div>}>
                <div style={{ marginTop: '20px' }}>
                  <TikTokPKPLiveTest />
                </div>
              </Suspense>
            )}
          </div>
          <div style={{ marginTop: '20px' }}>
            <button 
              onClick={() => setShowTikTokOAuth(!showTikTokOAuth)}
              style={{ 
                padding: '10px 20px', 
                backgroundColor: '#000',
                color: 'white',
                border: '2px solid #ff0050',
                borderRadius: '5px',
                cursor: 'pointer'
              }}
            >
              {showTikTokOAuth ? 'Hide TikTok OAuth' : '🎵 Real TikTok OAuth Login'}
            </button>
            {showTikTokOAuth && (
              <Suspense fallback={<div>Loading TikTok OAuth...</div>}>
                <div style={{ marginTop: '20px' }}>
                  <TikTokOAuthConfig />
                </div>
              </Suspense>
            )}
          </div>
        </>
      ) : (
        <Connect />
      )}
    </>
  )
}

function Account() {
  const account = useAccount()
  const disconnect = useDisconnect()

  return (
    <div>
      <h2>Account</h2>

      <div>
        account: {account.address}
        <br />
        chainId: {account.chainId}
        <br />
        status: {account.status}
      </div>

      {account.status !== 'disconnected' && (
        <button onClick={() => disconnect.disconnect()} type="button">
          Sign out
        </button>
      )}
    </div>
  )
}

function Connect() {
  const connect = useConnect()
  const [connector] = connect.connectors

  return (
    <div>
      <h2>Connect MetaMask</h2>
      <p style={{ fontSize: '12px', color: '#666', marginBottom: '10px' }}>
        Connect your MetaMask wallet to test Lit Protocol v8 bug reproduction
      </p>
      <button
        onClick={() =>
          connect.connect({
            connector,
          })
        }
        type="button"
      >
        Connect MetaMask
      </button>
      <div>{connect.status}</div>
      <div>{connect.error?.message}</div>
    </div>
  )
}

function Balance() {
  const { address } = useAccount()
  const { data: balance } = useReadContract({
    ...exp1Config,
    args: [address!],
    functionName: 'balanceOf',
    query: {
      enabled: !!address,
      refetchInterval: 2_000,
    },
  })

  return (
    <div>
      <h2>Balance</h2>
      <div>Balance: {formatEther(balance ?? 0n)} EXP</div>
    </div>
  )
}

function Mint() {
  const { address } = useAccount()
  const { data, error, isPending, sendCalls } = useSendCalls()

  const { isLoading: isConfirming, isSuccess: isConfirmed } =
    useWaitForCallsStatus({
      id: data?.id,
    })

  return (
    <div>
      <h2>Mint EXP</h2>
      <form
        onSubmit={(e) => {
          e.preventDefault()
          sendCalls({
            calls: [
              {
                ...exp1Config,
                args: [address!, parseEther('100')],
                functionName: 'mint',
                to: exp1Address,
              },
            ],
          })
        }}
      >
        <button disabled={isPending} type="submit">
          {isPending ? 'Confirming...' : 'Mint 100 EXP'}
        </button>
      </form>
      {data?.id && <div>Transaction Hash: {data.id}</div>}
      {isConfirming && 'Waiting for confirmation...'}
      {isConfirmed && 'Transaction confirmed.'}
      {error && (
        <div>Error: {(error as BaseError).shortMessage || error.message}</div>
      )}
    </div>
  )
}


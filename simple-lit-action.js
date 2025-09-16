// Simple Lit Action for testing v8 bug reproduction
// This action just returns a greeting message

const go = async () => {
  const userAddress = Lit.Actions.params.userAddress || 'unknown';
  const pkpPublicKey = Lit.Actions.params.pkpPublicKey || 'unknown';
  
  const result = {
    success: true,
    message: `Hello from Lit Action! Called by ${userAddress}`,
    pkpPublicKey: pkpPublicKey,
    timestamp: new Date().toISOString(),
    network: 'Naga Dev',
    sdk: 'v8.0.0-beta.15'
  };

  Lit.Actions.setResponse({ response: JSON.stringify(result) });
};

go();
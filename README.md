# Lit Protocol v8 SDK Bug Reproduction

## Bug Summary

**Issue**: Lit Actions fail to execute in v8 SDK due to resource prefix mismatch in ReCaps (Resource Capabilities)

**Impact**: Complete blocker for PKP delegation with ReCaps when executing Lit Actions

## Technical Details

### Root Cause
- **SDK generates**: `lit-litaction://[ipfsId]` in ReCaps
- **Lit nodes expect**: `lit-action://[ipfsId]`
- **Result**: `NodeSIWECapabilityInvalid` error - "Resource id not found in auth_sig capabilities"

### Specific Issues Identified

1. **Import Issue**: ✅ **CONFIRMED** - `LitAbility.LitActionExecution` is undefined (import broken)
   - Error: `TypeError: Cannot read properties of undefined (reading 'LitActionExecution')`
   - Workaround: Use string `'lit-action-execution'` instead
2. **Zod Validation**: Blocks custom prefix override attempts  
3. **Constants Error**: `LIT_RESOURCE_PREFIX.LitAction = 'lit-litaction'` in constants (should be `'lit-action'`)

### Environment
- **SDK Version**: `@lit-protocol/lit-client@8.0.0-beta.15`
- **Network**: Naga Dev
- **Auth Method**: Standard EOA (MetaMask) with SIWE
- **Flow**: EOA auth → Mint PKP → Session delegation (ReCaps) → Execute Lit Action

## Reproduction Steps

1. **Install Dependencies**:
   ```bash
   bun install
   ```

2. **Run Development Server**:
   ```bash
   bun run dev
   ```

3. **Connect MetaMask**: Connect to any supported network

4. **Get tstLPX**: Visit [Chronicle Yellowstone Faucet](https://chronicle-yellowstone-faucet.getlit.dev/) to get test tokens

5. **Mint PKP**: Click "Mint PKP with MetaMask" (requires tstLPX)

6. **Execute Lit Action**: Click "Test Lit Action (Demonstrates v8 Bug)"

7. **Observe Error**: You should see the `NodeSIWECapabilityInvalid` error

## Expected vs Actual Behavior

### Expected
- Lit Action executes successfully
- Returns response from the simple test action

### Actual
```
NodeSIWECapabilityInvalid error - "Resource id not found in auth_sig capabilities"
```

## Workaround Attempted

The code includes a workaround attempt using wildcard resources:
```typescript
// Create resource using wildcard to avoid prefix issues
const litActionResource = new LitActionResource('*')
```

However, this workaround does not resolve the underlying prefix mismatch issue.

## Fix Needed

Update `LIT_RESOURCE_PREFIX.LitAction` from `'lit-litaction'` to `'lit-action'` in the SDK constants to match what Lit nodes expect.

## Code Structure

- `src/LitActionTest.tsx` - Main component demonstrating the bug
- `src/config.ts` - MetaMask + wagmi configuration  
- `simple-lit-action.js` - Minimal Lit Action for testing
- `package.json` - Dependencies (Lit Protocol v8 beta.15)

## Previous State

This reproduction case was simplified from a Porto wallet (EIP-1271) integration to use standard MetaMask to isolate the issue. The bug occurs regardless of wallet type.

## Files Modified

1. Removed Porto wallet dependency
2. Updated wagmi config to use MetaMask (`injected` connector)
3. Simplified Lit Action test component
4. Created minimal test Lit Action
5. Updated UI to focus on bug reproduction

## Contact

Please use this minimal reproduction case to investigate and fix the resource prefix mismatch in Lit Protocol v8 SDK.

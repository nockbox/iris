# Iris - Nockchain Wallet Extension

Chrome extension wallet for Nockchain. Manage accounts, sign transactions, and interact with Nockchain dApps.

## Quick Start

### Prerequisites

- Node.js 18+
- Chrome browser

### Setup

```bash
# Clone
git clone <repo-url>
cd fort-nock

# Install dependencies
npm install

# Build extension
npm run build
```

### Load in Chrome

1. Open Chrome → `chrome://extensions`
2. Enable "Developer mode" (top right)
3. Click "Load unpacked"
4. Select the `dist/` folder

The extension icon should appear in your toolbar.

## Development

### Watch mode (rebuilds on changes)

```bash
npm run dev
```

After changes, click the refresh icon in `chrome://extensions` to reload.

### Build for production

```bash
npm run build
```

## WASM Modules

WASM binaries are **pre-built and included** in `extension/lib/`. No build required.

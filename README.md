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
cd <project-folder>

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

## Local development: publishing `@nockbox/iris-wasm` / `@nockbox/iris-sdk` to a local npm registry

When you make changes to `@nockbox/iris-wasm`, **do not use** `file:` dependencies for Iris. Instead, publish to a **local npm registry** and consume via normal semver versions (so the repo can be checked in using npm-style deps).

### One-time setup (Verdaccio)

Start a local registry:

```bash
npm i -g verdaccio
verdaccio --listen 4873
```

Point only the `@nockbox` scope at Verdaccio:

```bash
npm config set @nockbox:registry http://localhost:4873
```

Create a local registry user and login:

```bash
npm adduser --registry http://localhost:4873
npm login --registry http://localhost:4873
```

### Publish workflow

1. **Publish `@nockbox/iris-wasm`** from your local `iris-wasm` repo checkout:

```bash
# in the iris-wasm package directory
npm version 0.1.3 --no-git-tag-version
npm publish --registry http://localhost:4873
```

2. **Bump + publish `@nockbox/iris-sdk`** (this repo’s `sdk/`):

```bash
cd sdk
# update sdk/package.json:
# - "version": "0.1.2"
# - "@nockbox/iris-wasm": "0.1.3"
npm run build
npm publish --registry http://localhost:4873
```

3. **Consume in Iris** using normal npm deps (no `file:`):

```bash
cd ..
# update package.json:
# - "@nockbox/iris-sdk": "0.1.2"
npm install
```

### Verify what you’re using

```bash
npm view @nockbox/iris-wasm version --registry http://localhost:4873
npm view @nockbox/iris-sdk version --registry http://localhost:4873
npm ls @nockbox/iris-sdk @nockbox/iris-wasm
```

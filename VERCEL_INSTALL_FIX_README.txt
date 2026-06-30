IMPORTANT VERCEL FIX

This package intentionally does NOT include package-lock.json.

Replace the included files, then DELETE package-lock.json from your GitHub repo if it exists.

In Vercel Project Settings > Build & Development Settings:
- Remove the custom Install Command: npm ci --no-audit --no-fund
- Either leave Install Command empty, or set it to:
  npm install --no-audit --no-fund --package-lock=false
- Build Command:
  npm run build
- Node.js Version:
  22.x

Why this fixes it:
- npm ci fails if package-lock.json is missing, stale, or points to a registry Vercel cannot use.
- npm install with package-lock=false ignores the bad lockfile path and installs from public npm.

# ES6 Module Conversion Fix

## Issue
After converting to React with electron-vite, the app failed to start with error:
```
Error: Cannot find module './ocr-manager'
```

## Root Cause
The main process files were using CommonJS syntax (`require`/`module.exports`) but electron-vite expects ES6 modules (`import`/`export`).

## Solution
Converted all main process files from CommonJS to ES6 modules:

### Files Converted:

1. **src/main/index.js**
   - `require('electron')` → `import { ... } from 'electron'`
   - `require('./ocr-manager')` → `import OCRManager from './ocr-manager.js'`
   - Added `.js` extensions to all local imports
   - Added `__dirname` polyfill for ESM

2. **src/main/ocr-manager.js**
   - `const screenshot = require(...)` → `import screenshot from ...`
   - `module.exports = OCRManager` → `export default OCRManager`

3. **src/main/websocket-manager.js**
   - `const { io } = require(...)` → `import { io } from ...`
   - `module.exports` → `export default`

4. **src/main/app-tracker.js**
   - ⚠️ **Special case**: Uses `createRequire` for CommonJS module
   - `const ActiveWindow = require(...).default` → Uses createRequire pattern:
     ```js
     import { createRequire } from 'module'
     const require = createRequire(import.meta.url)
     const ActiveWindow = require('@paymoapp/active-window').default
     ```
   - `module.exports` → `export default`

5. **src/main/activity-tracker.js**
   - `const { globalShortcut } = require(...)` → `import { ... } from ...`
   - `const activeWin = require(...)` → `import activeWin from ...`
   - `module.exports` → `export default`

6. **src/main/ai-assistant.js**
   - `module.exports` → `export default`

7. **src/main/keystroke-collector.js**
   - `const { GlobalKeyboardListener } = require(...)` → `import { ... } from ...`
   - `module.exports` → `export default`

8. **src/main/vision-scheduler.js**
   - `const { desktopCapturer } = require(...)` → `import { ... } from ...`
   - `module.exports` → `export default`

### electron.vite.config.js Updates:

```js
main: {
  plugins: [externalizeDepsPlugin()],
  build: {
    lib: {
      entry: resolve(__dirname, 'src/main/index.js')
    },
    rollupOptions: {
      external: [
        'electron',
        'path',
        'fs',
        'screenshot-desktop',
        'active-win',
        '@paymoapp/active-window',
        'node-global-key-listener',
        'node-mac-permissions',
        'socket.io-client',
        'form-data'
      ]
    }
  }
}
```

## Key Changes:

1. **Import syntax**:
   - CommonJS: `const X = require('Y')`
   - ES6: `import X from 'Y'`

2. **Export syntax**:
   - CommonJS: `module.exports = X`
   - ES6: `export default X`

3. **File extensions**:
   - Local imports must include `.js` extension
   - External packages don't need extension

4. **__dirname polyfill**:
   ```js
   import { fileURLToPath } from 'url'
   const __dirname = path.dirname(fileURLToPath(import.meta.url))
   ```

## Build Result

✅ Build succeeded with all modules bundled:
```
out/main/index.js  98.56 kB
```

The app now starts correctly with all React windows working!

## Special Case: CommonJS Modules in ES6

Some npm packages (like `@paymoapp/active-window`) are pure CommonJS and don't work well with ES6 imports. For these, use `createRequire`:

```js
import { createRequire } from 'module'
const require = createRequire(import.meta.url)
const Module = require('commonjs-package').default
```

This creates a `require` function in the ES6 module context, allowing you to import CommonJS packages that don't have proper ES6 support.

## Running the App

```bash
# Development
npm run dev

# Build
npm run build

# Preview production build
npm run preview
```

## Success! ✅

The app now starts successfully with all React windows working:
- Suggestions window
- Debug window
- Settings window

No module errors, everything bundled correctly!

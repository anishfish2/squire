import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import react from '@vitejs/plugin-react'
import { resolve } from 'path'

export default defineConfig({
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
  },
  renderer: {
    resolve: {
      alias: {
        '@renderer': resolve('src/renderer'),
        '@': resolve(__dirname)
      }
    },
    plugins: [react()],
    css: {
      postcss: './postcss.config.js'
    },
    build: {
      rollupOptions: {
        input: {
          suggestions: resolve(__dirname, 'src/renderer/suggestions/index.html'),
          debug: resolve(__dirname, 'src/renderer/debug/index.html'),
          settings: resolve(__dirname, 'src/renderer/settings/index.html')
        }
      }
    },
    publicDir: resolve(__dirname, 'public')
  }
})

import { resolve } from 'node:path'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { defineConfig } from 'electron-vite'

export default defineConfig({
  main: {
    build: {
      rollupOptions: {
        external: ['electron', 'node-pty', 'electron-updater'],
        input: resolve('src/main/index.ts'),
        // Avoid the ESM shim path that emits an empty entry with Vite 8.
        output: { format: 'cjs', entryFileNames: 'index.cjs' },
      },
    },
  },
  preload: {
    build: {
      rollupOptions: {
        external: ['electron'],
        input: resolve('src/preload/index.ts'),
        output: {
          entryFileNames: 'index.cjs',
          format: 'cjs',
        },
      },
    },
  },
  renderer: {
    root: resolve('src/renderer'),
    build: {
      rollupOptions: {
        input: {
          index: resolve('src/renderer/index.html'),
          tray: resolve('src/renderer/tray.html'),
        },
      },
    },
    resolve: {
      alias: {
        '@renderer': resolve('src/renderer/src'),
        '@shared': resolve('src/shared'),
      },
    },
    plugins: [tailwindcss(), react()],
  },
})

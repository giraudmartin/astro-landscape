import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

const rootDir = dirname(fileURLToPath(import.meta.url))
const rootPkg = JSON.parse(
  readFileSync(resolve(rootDir, 'package.json'), 'utf8'),
) as { version: string }

// Photo Sightline uses 5173–5175 (web) and 3000 (api) — keep clear of those.
export default defineConfig({
  define: {
    __APP_VERSION__: JSON.stringify(rootPkg.version),
  },
  plugins: [react()],
  server: {
    port: 5180,
    strictPort: true,
  },
  preview: {
    port: 4180,
    strictPort: true,
  },
})

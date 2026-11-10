import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// Photo Sightline uses 5173–5175 (web) and 3000 (api) — keep clear of those.
export default defineConfig({
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

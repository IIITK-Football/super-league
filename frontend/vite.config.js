import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { privateViteVars } from './src/lib/env.js'

// https://vite.dev/config/
export default defineConfig(({ mode }) => {
  // Vite inlines every VITE_ value into the browser bundle. Refuse to start or build if any VITE_ name
  // looks private (for example a Supabase secret key), so an elevated key can never reach the bundle.
  const leaked = privateViteVars(loadEnv(mode, process.cwd(), 'VITE_'))
  if (leaked.length) {
    throw new Error(
      `Private values must not use the VITE_ prefix (they ship to the browser): ${leaked.join(', ')}. ` +
        'Remove them from the frontend environment; server-only keys belong in the backend or host settings.',
    )
  }

  return {
    plugins: [
      react(),
      tailwindcss(),
    ],
  }
})

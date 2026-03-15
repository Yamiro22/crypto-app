import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// Frontend calls the backend directly via VITE_API_BASE.
// No Vite proxy is required now.

export default defineConfig({
  plugins: [react()],
})

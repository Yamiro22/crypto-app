import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// ─── BABYDOGE BTC ORACLE — Vite Config ───────────────────────────────────────
// Every external API is proxied here so the browser never hits a CORS wall.
//
// How it works:
//   Your code calls  →  /binance/api/v3/klines?...
//   Vite forwards to →  https://api.binance.com/api/v3/klines?...  (server-side, no CORS)
//
// ⚠️  After changing this file always restart Vite: Ctrl+C → npm run dev

export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {

      // ── Binance REST API ───────────────────────────────────────────────────
      // Fixes: "Unexpected token '<'" errors — was returning HTML instead of JSON
      // binanceApi.js should use /binance/api/v3/... (not https://api.binance.com/...)
      '/binance': {
        target: 'https://api.binance.com',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/binance/, ''),
        secure: true,
        configure: (proxy) => {
          proxy.on('error', (err) => console.warn('[Proxy/Binance]', err.message));
        },
      },

      // ── Binance WebSocket streams ──────────────────────────────────────────
      // Fixes: "WebSocket is closed before the connection is established"
      // binanceWS.js should connect to ws://localhost:5173/binance-ws/stream?streams=...
      // instead of wss://stream.binance.com:9443/stream?streams=...
      '/binance-ws': {
        target: 'wss://stream.binance.com:9443',
        changeOrigin: true,
        ws: true,    // ← critical: enables WebSocket proxy mode
        rewrite: (path) => path.replace(/^\/binance-ws/, ''),
        secure: true,
        configure: (proxy) => {
          proxy.on('error', (err) => console.warn('[Proxy/BinanceWS]', err.message));
        },
      },

      // ── Polymarket CLOB API — live prices, orderbook, spread, history ──────
      '/polymarket-clob': {
        target: 'https://clob.polymarket.com',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/polymarket-clob/, ''),
        secure: true,
        configure: (proxy) => {
          proxy.on('error', (err) => console.warn('[Proxy/CLOB]', err.message));
        },
      },

      // ── Polymarket Gamma API — market discovery, token IDs, metadata ───────
      '/polymarket': {
        target: 'https://gamma-api.polymarket.com',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/polymarket/, ''),
        secure: true,
        configure: (proxy) => {
          proxy.on('error', (err) => console.warn('[Proxy/Gamma]', err.message));
        },
      },

      // ── Polymarket Data API — builder analytics, positions (future) ─────────
      '/polymarket-data': {
        target: 'https://data-api.polymarket.com',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/polymarket-data/, ''),
        secure: true,
        configure: (proxy) => {
          proxy.on('error', (err) => console.warn('[Proxy/Data]', err.message));
        },
      },

    },
  },
})
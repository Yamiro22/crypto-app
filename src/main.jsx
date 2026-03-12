import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App.jsx'
import './index.css'

// StrictMode removed — it double-invokes effects in dev which breaks
// long-lived WebSocket connections (closes them mid-handshake).
ReactDOM.createRoot(document.getElementById('root')).render(
  <App />
)
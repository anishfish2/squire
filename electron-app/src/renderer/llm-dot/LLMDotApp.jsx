import React, { useState, useEffect, useRef } from 'react'
import { createRoot } from 'react-dom/client'
import '@/styles.css'

const { ipcRenderer } = window.require('electron')

function LLMDotApp() {
  const [isHovered, setIsHovered] = useState(false)
  const dotRef = useRef(null)

  // Enable click-through on mount
  useEffect(() => {
    ipcRenderer.send('set-llm-dot-click-through', true)
  }, [])

  const dotStyle = {
    width: '40px',
    height: '40px',
    borderRadius: '50%',
    cursor: 'pointer',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    border: '2px solid rgba(255, 255, 255, 0.3)',
    background: 'rgba(71, 85, 105, 0.9)',
    boxShadow: isHovered
      ? '0 8px 24px rgba(71, 85, 105, 0.3)'
      : '0 4px 12px rgba(0, 0, 0, 0.15)',
    transform: isHovered ? 'scale(1.1)' : 'scale(1)',
    transition: 'all 0.2s ease',
    WebkitAppRegion: 'no-drag',
  }

  return (
    <div
      style={{
        width: '150px',
        height: '150px',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: 'transparent'
      }}
    >
      <div
        ref={dotRef}
        style={dotStyle}
        onClick={(e) => {
          e.stopPropagation()
          ipcRenderer.send('toggle-llm-chat', true)
        }}
        onMouseEnter={() => {
          setIsHovered(true)
          ipcRenderer.send('set-llm-dot-click-through', false)
        }}
        onMouseLeave={() => {
          setIsHovered(false)
          ipcRenderer.send('set-llm-dot-click-through', true)
        }}
      >
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ opacity: 0.9 }}>
          <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"></path>
          <path d="M8 10h.01"></path>
          <path d="M12 10h.01"></path>
          <path d="M16 10h.01"></path>
        </svg>
      </div>
    </div>
  )
}

const container = document.getElementById('root')

const root = createRoot(container)
root.render(<LLMDotApp />)

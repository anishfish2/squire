import React, { useState, useEffect, useRef } from 'react'
import { createRoot } from 'react-dom/client'
import '@/styles.css'

const { ipcRenderer } = window.require('electron')

function DotApp() {
  const [hasSuggestions, setHasSuggestions] = useState(false)
  const [isHovered, setIsHovered] = useState(false)
  const dotRef = useRef(null)

  // Listen for AI suggestions
  useEffect(() => {
    const handleAISuggestions = (event, data) => {
      console.log('Dot received AI suggestions:', data)
      if (data.aiSuggestions && data.aiSuggestions.length > 0) {
        setHasSuggestions(true)
      }
    }

    ipcRenderer.on('ai-suggestions', handleAISuggestions)

    return () => {
      ipcRenderer.removeListener('ai-suggestions', handleAISuggestions)
    }
  }, [])

  // Enable click-through on mount, will be disabled when hovering over dot
  useEffect(() => {
    ipcRenderer.send('set-dot-click-through', true)
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
          if (hasSuggestions) {
            ipcRenderer.send('toggle-suggestions-box', true)
          }
        }}
        onMouseEnter={() => {
          setIsHovered(true)
          ipcRenderer.send('set-dot-click-through', false)
        }}
        onMouseLeave={() => {
          setIsHovered(false)
          ipcRenderer.send('set-dot-click-through', true)
        }}
      >
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ opacity: 0.9 }}>
          <circle cx="11" cy="11" r="8"></circle>
          <path d="m21 21-4.35-4.35"></path>
        </svg>
      </div>
    </div>
  )
}

const container = document.getElementById('root')

const root = createRoot(container)
root.render(<DotApp />)

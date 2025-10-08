import React, { useState, useEffect } from 'react'
import { createRoot } from 'react-dom/client'

const { ipcRenderer } = window.require('electron')

const HubDotApp = () => {
  const [isExpanded, setIsExpanded] = useState(false)
  const [isHovered, setIsHovered] = useState(false)

  useEffect(() => {
    // Enable click-through on mount
    ipcRenderer.send('set-hub-dot-click-through', true)

    // Listen for expansion state updates from main process
    ipcRenderer.on('hub-expansion-changed', (_, expanded) => {
      setIsExpanded(expanded)
    })
  }, [])

  const handleClick = () => {
    const newState = !isExpanded
    setIsExpanded(newState)
    ipcRenderer.send('toggle-hub-expansion', newState)
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
        style={{
          width: '40px',
          height: '40px',
          borderRadius: '50%',
          background: isExpanded
            ? 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)'
            : 'linear-gradient(135deg, #6366f1 0%, #8b5cf6 100%)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          boxShadow: isHovered
            ? '0 8px 24px rgba(99, 102, 241, 0.4), 0 0 20px rgba(139, 92, 246, 0.3)'
            : '0 4px 12px rgba(0, 0, 0, 0.15)',
          transform: isHovered ? 'scale(1.1)' : 'scale(1)',
          transition: 'all 0.2s ease',
          position: 'relative',
          cursor: 'pointer'
        }}
        onClick={handleClick}
        onMouseEnter={() => {
          setIsHovered(true)
          ipcRenderer.send('set-hub-dot-click-through', false)
        }}
        onMouseLeave={() => {
          setIsHovered(false)
          ipcRenderer.send('set-hub-dot-click-through', true)
        }}
      >
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ opacity: 0.9, transform: isExpanded ? 'rotate(90deg)' : 'rotate(0deg)', transition: 'transform 0.3s ease' }}>
          <circle cx="12" cy="5" r="1" fill="white"></circle>
          <circle cx="12" cy="12" r="1" fill="white"></circle>
          <circle cx="12" cy="19" r="1" fill="white"></circle>
        </svg>
      </div>
    </div>
  )
}

const root = createRoot(document.getElementById('root'))
root.render(<HubDotApp />)

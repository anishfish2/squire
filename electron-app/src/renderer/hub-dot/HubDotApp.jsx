import React, { useState, useEffect } from 'react'
import { createRoot } from 'react-dom/client'

const { ipcRenderer } = window.require('electron')

const HubDotApp = () => {
  const [isExpanded, setIsExpanded] = useState(false)
  const [isHovered, setIsHovered] = useState(false)

  useEffect(() => {
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
        width: '100%',
        height: '100%',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        cursor: 'pointer'
      }}
      onClick={handleClick}
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
    >
      <div
        style={{
          width: '56px',
          height: '56px',
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
          transition: 'all 0.3s cubic-bezier(0.4, 0, 0.2, 1)',
          position: 'relative'
        }}
      >
        {/* Menu icon - three dots arranged vertically */}
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            gap: '4px',
            alignItems: 'center',
            transform: isExpanded ? 'rotate(90deg)' : 'rotate(0deg)',
            transition: 'transform 0.3s cubic-bezier(0.4, 0, 0.2, 1)'
          }}
        >
          <div
            style={{
              width: '6px',
              height: '6px',
              borderRadius: '50%',
              background: 'white',
              opacity: 0.9
            }}
          />
          <div
            style={{
              width: '6px',
              height: '6px',
              borderRadius: '50%',
              background: 'white',
              opacity: 0.9
            }}
          />
          <div
            style={{
              width: '6px',
              height: '6px',
              borderRadius: '50%',
              background: 'white',
              opacity: 0.9
            }}
          />
        </div>
      </div>
    </div>
  )
}

const root = createRoot(document.getElementById('root'))
root.render(<HubDotApp />)

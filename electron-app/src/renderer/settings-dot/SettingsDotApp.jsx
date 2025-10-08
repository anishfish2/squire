import React, { useState, useEffect, useRef } from 'react'
import { createRoot } from 'react-dom/client'
import '@/styles.css'

const { ipcRenderer } = window.require('electron')

// Tooltip component
const Tooltip = ({ text, hotkey, show }) => (
  show && (
    <div style={{
      position: 'absolute',
      bottom: '-38px',
      left: '50%',
      transform: 'translateX(-50%)',
      padding: '6px 12px',
      background: 'rgba(0, 0, 0, 0.95)',
      color: 'white',
      fontSize: '11px',
      fontWeight: '500',
      borderRadius: '8px',
      whiteSpace: 'nowrap',
      pointerEvents: 'none',
      zIndex: 10000,
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      gap: '3px'
    }}>
      <span>{text}</span>
      {hotkey && (
        <span style={{
          fontSize: '9px',
          opacity: 0.6,
          fontFamily: 'monospace'
        }}>{hotkey}</span>
      )}
      <div style={{
        position: 'absolute',
        top: '-4px',
        left: '50%',
        transform: 'translateX(-50%)',
        width: 0,
        height: 0,
        borderLeft: '5px solid transparent',
        borderRight: '5px solid transparent',
        borderBottom: '5px solid rgba(0, 0, 0, 0.95)'
      }} />
    </div>
  )
)

function SettingsDotApp() {
  const [isHovered, setIsHovered] = useState(false)
  const dotRef = useRef(null)

  // Enable click-through on mount
  useEffect(() => {
    ipcRenderer.send('set-settings-dot-click-through', true)
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
      <div style={{ position: 'relative' }}>
        <div
          ref={dotRef}
          style={dotStyle}
          onClick={(e) => {
            e.stopPropagation()
            ipcRenderer.send('toggle-settings', true)
          }}
          onMouseEnter={() => {
            setIsHovered(true)
            ipcRenderer.send('set-settings-dot-click-through', false)
          }}
          onMouseLeave={() => {
            setIsHovered(false)
            ipcRenderer.send('set-settings-dot-click-through', true)
          }}
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ opacity: 0.9 }}>
            <path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z"></path>
            <circle cx="12" cy="12" r="3"></circle>
          </svg>
        </div>
        <Tooltip text="Settings" hotkey="⌘⌥S" show={isHovered} />
      </div>
    </div>
  )
}

const container = document.getElementById('root')

const root = createRoot(container)
root.render(<SettingsDotApp />)

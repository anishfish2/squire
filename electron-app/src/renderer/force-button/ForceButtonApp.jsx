import React, { useEffect, useState } from 'react'
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

function ForceButtonApp() {
  const [isHovered, setIsHovered] = useState(false)

  const handleForceSuggestion = async (e) => {
    e.stopPropagation()
    const button = e.currentTarget
    button.disabled = true
    button.style.opacity = '0.4'

    try {
      const result = await ipcRenderer.invoke('force-suggestion-request')

      if (result.status === 'success') {
        button.style.backgroundColor = 'rgba(34, 197, 94, 0.2)'
        setTimeout(() => {
          button.style.backgroundColor = ''
        }, 1500)
      } else if (result.status === 'empty') {
        button.style.backgroundColor = 'rgba(251, 191, 36, 0.2)'
        setTimeout(() => {
          button.style.backgroundColor = ''
        }, 2000)
      } else if (result.status === 'busy') {
        button.style.backgroundColor = 'rgba(96, 165, 250, 0.2)'
        setTimeout(() => {
          button.style.backgroundColor = ''
        }, 1500)
      } else if (result.status === 'error') {
        button.style.backgroundColor = 'rgba(239, 68, 68, 0.2)'
        setTimeout(() => {
          button.style.backgroundColor = ''
        }, 2000)
      }
    } catch (error) {
      console.error('Force suggestion failed:', error)
      button.style.backgroundColor = 'rgba(239, 68, 68, 0.2)'
      setTimeout(() => {
        button.style.backgroundColor = ''
      }, 2000)
    } finally {
      setTimeout(() => {
        button.disabled = false
        button.style.opacity = '1'
      }, 1500)
    }
  }

  // Enable click-through on mount
  useEffect(() => {
    ipcRenderer.send('set-force-button-click-through', true)
  }, [])

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
        <button
          style={{
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
          }}
          onClick={handleForceSuggestion}
          onMouseEnter={() => {
            setIsHovered(true)
            ipcRenderer.send('set-force-button-click-through', false)
          }}
          onMouseLeave={() => {
            setIsHovered(false)
            ipcRenderer.send('set-force-button-click-through', true)
          }}
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" style={{ opacity: 0.9 }}>
            <path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z"></path>
          </svg>
        </button>
        <Tooltip text="Suggest" hotkey="⌘⇧F" show={isHovered} />
      </div>
    </div>
  )
}

const container = document.getElementById('root')
// Force transparent background
document.body.style.backgroundColor = 'transparent'
document.documentElement.style.backgroundColor = 'transparent'
container.style.backgroundColor = 'transparent'

const root = createRoot(container)
root.render(<ForceButtonApp />)

import React, { useState, useEffect } from 'react'
import { createRoot } from 'react-dom/client'
import '@/styles.css'

const { ipcRenderer } = window.require('electron')

function VisionToggleApp() {
  const [isEnabled, setIsEnabled] = useState(true) // Default to enabled

  // Sync state with backend on mount and enable click-through
  useEffect(() => {
    ipcRenderer.send('set-vision-toggle-click-through', true)

    ipcRenderer.invoke('get-vision-state').then(backendState => {
      console.log('[VisionToggle] Initial backend state:', backendState)
      setIsEnabled(backendState)
    }).catch(err => {
      console.error('[VisionToggle] Failed to get initial state:', err)
    })

    // Listen for state changes from backend
    const handleStateChange = (event, newState) => {
      console.log('[VisionToggle] Backend state changed to:', newState)
      setIsEnabled(newState)
    }
    ipcRenderer.on('vision-state-changed', handleStateChange)

    return () => {
      ipcRenderer.removeListener('vision-state-changed', handleStateChange)
    }
  }, [])

  const toggleVision = () => {
    const newState = !isEnabled
    console.log(`[VisionToggle] Toggling vision: ${isEnabled} -> ${newState}`)
    setIsEnabled(newState)
    ipcRenderer.send('toggle-global-vision', newState)
    console.log('[VisionToggle] IPC message sent to backend')
  }

  return (
    <div style={{ width: '150px', height: '150px', display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'transparent' }}>
      <div
        className="vision-toggle-button"
        style={{
          WebkitAppRegion: 'no-drag',
          width: '40px',
          height: '40px',
          borderRadius: '50%',
          background: isEnabled
            ? 'rgba(100, 116, 139, 0.9)' // Lighter slate when on
            : 'rgba(51, 65, 85, 0.9)', // Darker slate when off
          boxShadow: isEnabled
            ? '0 4px 15px rgba(100, 116, 139, 0.3), inset 0 1px 1px rgba(255, 255, 255, 0.2)'
            : '0 4px 15px rgba(51, 65, 85, 0.3), inset 0 1px 1px rgba(255, 255, 255, 0.2)',
          cursor: 'pointer',
          transition: 'all 0.2s ease',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          color: 'white',
          fontSize: '18px',
          fontWeight: 'bold',
        }}
        onClick={(e) => {
          e.stopPropagation()
          toggleVision()
        }}
        onMouseEnter={(e) => {
          e.currentTarget.style.transform = 'scale(1.1)'
          e.currentTarget.style.boxShadow = isEnabled
            ? '0 6px 20px rgba(100, 116, 139, 0.4), inset 0 1px 1px rgba(255, 255, 255, 0.3)'
            : '0 6px 20px rgba(51, 65, 85, 0.4), inset 0 1px 1px rgba(255, 255, 255, 0.3)'
          ipcRenderer.send('set-vision-toggle-click-through', false)
        }}
        onMouseLeave={(e) => {
          e.currentTarget.style.transform = 'scale(1)'
          e.currentTarget.style.boxShadow = isEnabled
            ? '0 4px 15px rgba(100, 116, 139, 0.3), inset 0 1px 1px rgba(255, 255, 255, 0.2)'
            : '0 4px 15px rgba(51, 65, 85, 0.3), inset 0 1px 1px rgba(255, 255, 255, 0.2)'
          ipcRenderer.send('set-vision-toggle-click-through', true)
        }}
        title={isEnabled ? 'Vision Pipeline: ON' : 'Vision Pipeline: OFF'}
      >
        {isEnabled ? (
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ opacity: 0.9 }}>
            <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"></path>
            <circle cx="12" cy="12" r="3"></circle>
          </svg>
        ) : (
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ opacity: 0.9 }}>
            <line x1="1" y1="1" x2="23" y2="23"></line>
            <path d="M9 9C7.58 10.07 6.5 11.5 6 12c.5.5 1.5 2 3 3"></path>
            <path d="M15 15c1.42-1.07 2.5-2.5 3-3-.5-.5-1.5-2-3-3"></path>
            <path d="M12 9v6"></path>
          </svg>
        )}
      </div>
    </div>
  )
}

const container = document.getElementById('root')
const root = createRoot(container)
root.render(<VisionToggleApp />)

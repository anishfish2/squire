import React, { useState, useEffect, useRef, useCallback } from 'react'
import { createRoot } from 'react-dom/client'
import '@/styles.css'

const { ipcRenderer } = window.require('electron')

function VisionToggleApp() {
  const [isEnabled, setIsEnabled] = useState(true) // Default to enabled
  const dragStateRef = useRef({
    isDragging: false,
    startX: 0,
    startY: 0,
    startBoxX: 0,
    startBoxY: 0,
    clickStartTime: 0,
    clickStartPos: { x: 0, y: 0 }
  })

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

  // Handle dragging
  const handleMouseDown = (e) => {
    const dragState = dragStateRef.current
    dragState.isDragging = true
    dragState.startX = e.screenX
    dragState.startY = e.screenY
    dragState.clickStartTime = Date.now()
    dragState.clickStartPos = { x: e.screenX, y: e.screenY }
    dragState.startBoxX = e.screenX - e.clientX
    dragState.startBoxY = e.screenY - e.clientY
    e.preventDefault()
    e.stopPropagation()
  }

  const handleMouseMove = useCallback((e) => {
    const dragState = dragStateRef.current
    if (!dragState.isDragging) return

    const deltaX = e.screenX - dragState.startX
    const deltaY = e.screenY - dragState.startY
    const newScreenX = dragState.startBoxX + deltaX
    const newScreenY = dragState.startBoxY + deltaY

    ipcRenderer.send('move-vision-toggle-window', newScreenX, newScreenY)
  }, [])

  const handleMouseUp = useCallback((e) => {
    const dragState = dragStateRef.current
    if (!dragState.isDragging) return

    const timeDiff = Date.now() - dragState.clickStartTime
    const distance = Math.hypot(
      e.screenX - dragState.clickStartPos.x,
      e.screenY - dragState.clickStartPos.y
    )

    dragState.isDragging = false

    // If it was just a quick click, toggle vision
    if (timeDiff < 200 && distance < 5) {
      toggleVision()
    }
  }, [])

  const toggleVision = () => {
    const newState = !isEnabled
    console.log(`[VisionToggle] Toggling vision: ${isEnabled} -> ${newState}`)
    setIsEnabled(newState)
    ipcRenderer.send('toggle-global-vision', newState)
    console.log('[VisionToggle] IPC message sent to backend')
  }

  // Add global mouse listeners for dragging
  useEffect(() => {
    document.addEventListener('mousemove', handleMouseMove)
    document.addEventListener('mouseup', handleMouseUp)

    return () => {
      document.removeEventListener('mousemove', handleMouseMove)
      document.removeEventListener('mouseup', handleMouseUp)
    }
  }, [handleMouseMove, handleMouseUp])

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
            ? 'linear-gradient(135deg, #10b981 0%, #059669 100%)' // Green when on
            : 'linear-gradient(135deg, #ef4444 0%, #dc2626 100%)', // Red when off
          boxShadow: isEnabled
            ? '0 4px 15px rgba(16, 185, 129, 0.4), inset 0 1px 1px rgba(255, 255, 255, 0.2)'
            : '0 4px 15px rgba(239, 68, 68, 0.4), inset 0 1px 1px rgba(255, 255, 255, 0.2)',
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
        onMouseDown={handleMouseDown}
        onMouseEnter={(e) => {
          e.currentTarget.style.transform = 'scale(1.1)'
          e.currentTarget.style.boxShadow = isEnabled
            ? '0 6px 20px rgba(16, 185, 129, 0.6), inset 0 1px 1px rgba(255, 255, 255, 0.3)'
            : '0 6px 20px rgba(239, 68, 68, 0.6), inset 0 1px 1px rgba(255, 255, 255, 0.3)'
          ipcRenderer.send('set-vision-toggle-click-through', false)
        }}
        onMouseLeave={(e) => {
          e.currentTarget.style.transform = 'scale(1)'
          e.currentTarget.style.boxShadow = isEnabled
            ? '0 4px 15px rgba(16, 185, 129, 0.4), inset 0 1px 1px rgba(255, 255, 255, 0.2)'
            : '0 4px 15px rgba(239, 68, 68, 0.4), inset 0 1px 1px rgba(255, 255, 255, 0.2)'
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

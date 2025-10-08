import React, { useState, useEffect, useRef, useCallback } from 'react'
import { createRoot } from 'react-dom/client'

const { ipcRenderer } = window.require('electron')

const HubDotApp = () => {
  const [isExpanded, setIsExpanded] = useState(false)
  const [isHovered, setIsHovered] = useState(false)
  const [unreadCount, setUnreadCount] = useState(0)
  const dragStateRef = useRef({
    isDragging: false,
    startX: 0,
    startY: 0,
    startBoxX: 0,
    startBoxY: 0,
    clickStartTime: 0,
    clickStartPos: { x: 0, y: 0 }
  })

  useEffect(() => {
    // Enable click-through on mount
    ipcRenderer.send('set-hub-dot-click-through', true)

    // Listen for expansion state updates from main process
    ipcRenderer.on('hub-expansion-changed', (_, expanded) => {
      setIsExpanded(expanded)
    })

    // Listen for unread suggestions count updates
    ipcRenderer.on('unread-suggestions-count', (_, count) => {
      setUnreadCount(count)
    })

    // Keyboard shortcut for toggling LLM chat pane
    const handleKeyDown = (e) => {
      // Cmd+Shift+L - Toggle LLM Chat
      if (e.metaKey && e.shiftKey && e.key === 'L') {
        e.preventDefault()
        handleClick() // Toggle expansion/chat
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [])

  const handleClick = () => {
    const newState = !isExpanded
    setIsExpanded(newState)
    ipcRenderer.send('toggle-hub-expansion', newState)
  }

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

    ipcRenderer.send('move-hub-dot-window', newScreenX, newScreenY)
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

    // If it was just a quick click, toggle hub expansion
    if (timeDiff < 300 && distance < 10) {
      setIsExpanded(prev => {
        const newState = !prev
        ipcRenderer.send('toggle-hub-expansion', newState)
        return newState
      })
    }
  }, [])

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
            ? 'rgba(100, 116, 139, 0.9)'
            : 'rgba(71, 85, 105, 0.9)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          boxShadow: isHovered
            ? '0 8px 24px rgba(71, 85, 105, 0.3)'
            : '0 4px 12px rgba(0, 0, 0, 0.15)',
          transform: isHovered ? 'scale(1.1)' : 'scale(1)',
          transition: 'all 0.2s ease',
          position: 'relative',
          cursor: 'pointer',
          WebkitAppRegion: 'no-drag'
        }}
        onMouseDown={handleMouseDown}
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
        {unreadCount > 0 && (
          <div
            style={{
              position: 'absolute',
              top: '-2px',
              right: '-2px',
              width: '12px',
              height: '12px',
              borderRadius: '50%',
              background: '#ef4444',
              border: '2px solid rgba(71, 85, 105, 0.9)',
              animation: 'pulse 2s cubic-bezier(0.4, 0, 0.6, 1) infinite'
            }}
          />
        )}
      </div>
    </div>
  )
}

const root = createRoot(document.getElementById('root'))
root.render(<HubDotApp />)

import React, { useState, useEffect, useRef, useCallback } from 'react'
import { createRoot } from 'react-dom/client'
import '@/styles.css'

const { ipcRenderer } = window.require('electron')



function DotApp() {
  const [hasSuggestions, setHasSuggestions] = useState(false)
  const dragStateRef = useRef({
    isDragging: false,
    startX: 0,
    startY: 0,
    startBoxX: 0,
    startBoxY: 0,
    clickStartTime: 0,
    clickStartPos: { x: 0, y: 0 }
  })

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

  // Handle dragging
  const handleMouseDown = (e) => {
    ipcRenderer.send('dot-drag', 'start')
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

    ipcRenderer.send('move-dot-window', newScreenX, newScreenY)
  }, [])

  const handleMouseUp = useCallback((e) => {
    ipcRenderer.send('dot-drag', 'end')

    const dragState = dragStateRef.current
    if (!dragState.isDragging) return

    const timeDiff = Date.now() - dragState.clickStartTime
    const distance = Math.hypot(
      e.screenX - dragState.clickStartPos.x,
      e.screenY - dragState.clickStartPos.y
    )

    dragState.isDragging = false

    // If it was just a quick click, toggle suggestions box
    if (timeDiff < 200 && distance < 5 && hasSuggestions) {
      ipcRenderer.send('toggle-suggestions-box', true)
    }
  }, [hasSuggestions])

  // Add global mouse listeners for dragging
  useEffect(() => {
    document.addEventListener('mousemove', handleMouseMove)
    document.addEventListener('mouseup', handleMouseUp)

    return () => {
      document.removeEventListener('mousemove', handleMouseMove)
      document.removeEventListener('mouseup', handleMouseUp)
    }
  }, [handleMouseMove, handleMouseUp])

  const [isHovered, setIsHovered] = useState(false)
  const dotRef = useRef(null)

  // Enable click-through on mount, will be disabled when hovering over dot
  useEffect(() => {
    ipcRenderer.send('set-dot-click-through', true)
  }, [])

  const dotStyle = {
    width: '56px',
    height: '56px',
    borderRadius: '50%',
    cursor: 'pointer',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    border: '2px solid rgba(255, 255, 255, 0.3)',
    background: 'linear-gradient(135deg, rgba(100, 150, 255, 1) 0%, rgba(80, 120, 200, 1) 100%)',
    boxShadow: isHovered
      ? '0 6px 16px rgba(0, 0, 0, 0.5), inset 0 1px 2px rgba(255, 255, 255, 0.3)'
      : '0 4px 12px rgba(0, 0, 0, 0.5), inset 0 1px 2px rgba(255, 255, 255, 0.3)',
    transform: isHovered ? 'scale(1.05)' : 'scale(1)',
    transition: 'all 0.3s cubic-bezier(0.4, 0, 0.2, 1)',
    WebkitAppRegion: 'no-drag',
  }

  return (
    <div
      style={{
        width: '100px',
        height: '100px',
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
        onMouseDown={handleMouseDown}
        onMouseEnter={() => {
          setIsHovered(true)
          ipcRenderer.send('set-dot-click-through', false)
        }}
        onMouseLeave={() => {
          setIsHovered(false)
          ipcRenderer.send('set-dot-click-through', true)
        }}
      >
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ opacity: 0.9 }}>
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

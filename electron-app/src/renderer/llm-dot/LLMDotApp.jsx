import React, { useState, useEffect, useRef, useCallback } from 'react'
import { createRoot } from 'react-dom/client'
import '@/styles.css'

const { ipcRenderer } = window.require('electron')

function LLMDotApp() {
  const dragStateRef = useRef({
    isDragging: false,
    startX: 0,
    startY: 0,
    startBoxX: 0,
    startBoxY: 0,
    clickStartTime: 0,
    clickStartPos: { x: 0, y: 0 }
  })

  // Handle dragging
  const handleMouseDown = (e) => {
    ipcRenderer.send('llm-dot-drag', 'start')
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

    ipcRenderer.send('move-llm-dot-window', newScreenX, newScreenY)
  }, [])

  const handleMouseUp = useCallback((e) => {
    ipcRenderer.send('llm-dot-drag', 'end')

    const dragState = dragStateRef.current
    if (!dragState.isDragging) return

    const timeDiff = Date.now() - dragState.clickStartTime
    const distance = Math.hypot(
      e.screenX - dragState.clickStartPos.x,
      e.screenY - dragState.clickStartPos.y
    )

    dragState.isDragging = false

    // If it was just a quick click, toggle LLM chat window
    if (timeDiff < 200 && distance < 5) {
      ipcRenderer.send('toggle-llm-chat', true)
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

  const [isHovered, setIsHovered] = useState(false)
  const dotRef = useRef(null)

  useEffect(() => {
    if (dotRef.current) {
      const computedStyle = window.getComputedStyle(dotRef.current)
      console.log('=== LLM-DOT COMPUTED STYLES ===')
      console.log('background:', computedStyle.background)
      console.log('backgroundColor:', computedStyle.backgroundColor)
      console.log('backgroundImage:', computedStyle.backgroundImage)
      console.log('width:', computedStyle.width)
      console.log('height:', computedStyle.height)
      console.log('borderRadius:', computedStyle.borderRadius)
      console.log('border:', computedStyle.border)
      console.log('display:', computedStyle.display)
      console.log('===========================')
    }
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
    background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
    boxShadow: isHovered
      ? '0 8px 24px rgba(102, 126, 234, 0.4), 0 0 20px rgba(118, 75, 162, 0.3)'
      : '0 4px 12px rgba(0, 0, 0, 0.15)',
    transform: isHovered ? 'scale(1.1)' : 'scale(1)',
    transition: 'all 0.3s cubic-bezier(0.4, 0, 0.2, 1)',
    WebkitAppRegion: 'no-drag',
  }

  return (
    <div
      style={{
        width: '56px',
        height: '56px',
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
        onMouseDown={handleMouseDown}
        onMouseEnter={() => setIsHovered(true)}
        onMouseLeave={() => setIsHovered(false)}
      >
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ opacity: 0.9 }}>
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

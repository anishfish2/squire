
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

  return (
    <div className="w-14 h-14 flex items-center justify-center bg-transparent">
      <div
        className="dot-button"
        style={{
          WebkitAppRegion: 'no-drag',
        }}
        onClick={(e) => {
          e.stopPropagation()
          if (hasSuggestions) {
            ipcRenderer.send('toggle-suggestions-box', true)
          }
        }}
        onMouseDown={handleMouseDown}
      />
    </div>
  )
}

const container = document.getElementById('root')

const root = createRoot(container)
root.render(<DotApp />)

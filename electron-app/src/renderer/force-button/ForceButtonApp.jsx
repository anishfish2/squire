import React, { useRef, useCallback, useEffect } from 'react'
import { createRoot } from 'react-dom/client'
import '@/styles.css'

const { ipcRenderer } = window.require('electron')

function ForceButtonApp() {
  const dragStateRef = useRef({
    isDragging: false,
    startX: 0,
    startY: 0,
    startBoxX: 0,
    startBoxY: 0,
    clickStartTime: 0,
    clickStartPos: { x: 0, y: 0 }
  })

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

    ipcRenderer.send('move-force-button-window', newScreenX, newScreenY)
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

    // If it was just a quick click, allow normal click handlers to run
    if (timeDiff < 200 && distance < 5) return
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
    <div className="w-8 h-8 flex items-center justify-center" style={{ background: 'transparent' }}>
      <button
        className="w-8 h-8 rounded-full cursor-pointer transition-all duration-200 ease-out flex items-center justify-center hover:scale-105 border-2"
        style={{
          WebkitAppRegion: 'no-drag',
          background: 'rgba(100, 150, 255, 0.5)',
          boxShadow: '0 2px 8px rgba(0, 0, 0, 0.4)',
          borderColor: 'rgba(255, 255, 255, 0.25)'
        }}
        title="Get Suggestions Now"
        onClick={handleForceSuggestion}
        onMouseDown={handleMouseDown}
        onMouseEnter={(e) => {
          e.currentTarget.style.background = 'rgba(120, 170, 255, 0.6)'
        }}
        onMouseLeave={(e) => {
          e.currentTarget.style.background = 'rgba(100, 150, 255, 0.5)'
        }}
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ color: 'rgba(255, 255, 255, 0.9)' }}>
          <circle cx="11" cy="11" r="8"></circle>
          <path d="m21 21-4.35-4.35"></path>
        </svg>
      </button>
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

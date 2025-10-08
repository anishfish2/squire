import React, { useState, useRef, useEffect } from 'react'
import { createRoot } from 'react-dom/client'

const { ipcRenderer } = window.require('electron')

function ScreenshotOverlayApp() {
  const [isSelecting, setIsSelecting] = useState(false)
  const [startPos, setStartPos] = useState({ client: { x: 0, y: 0 }, screen: { x: 0, y: 0 } })
  const [currentPos, setCurrentPos] = useState({ client: { x: 0, y: 0 }, screen: { x: 0, y: 0 } })
  const [selectionBox, setSelectionBox] = useState(null)

  useEffect(() => {
    const handleKeyDown = (e) => {
      if (e.key === 'Escape') {
        ipcRenderer.send('cancel-screenshot-capture')
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [])

  const handleMouseDown = (e) => {
    // Track both client (for UI) and screen (for capture) coordinates
    const pos = {
      client: { x: e.clientX, y: e.clientY },
      screen: { x: e.screenX, y: e.screenY }
    }
    setStartPos(pos)
    setCurrentPos(pos)
    setIsSelecting(true)
  }

  const handleMouseMove = (e) => {
    if (!isSelecting) return
    setCurrentPos({
      client: { x: e.clientX, y: e.clientY },
      screen: { x: e.screenX, y: e.screenY }
    })
  }

  const handleMouseUp = async () => {
    if (!isSelecting) return

    // Use screen coordinates for capture
    const x = Math.min(startPos.screen.x, currentPos.screen.x)
    const y = Math.min(startPos.screen.y, currentPos.screen.y)
    const width = Math.abs(currentPos.screen.x - startPos.screen.x)
    const height = Math.abs(currentPos.screen.y - startPos.screen.y)

    // Hide selection UI immediately
    setIsSelecting(false)
    setSelectionBox(null)

    if (width > 10 && height > 10) {
      // Wait for UI to hide, then capture
      await new Promise(resolve => setTimeout(resolve, 100))
      await ipcRenderer.invoke('capture-screenshot-region', { x, y, width, height })
    } else {
      // Selection too small, cancel
      ipcRenderer.send('cancel-screenshot-capture')
    }
  }

  // Calculate selection box dimensions using client coordinates for UI
  const getSelectionStyle = () => {
    if (!isSelecting) return {}

    const x = Math.min(startPos.client.x, currentPos.client.x)
    const y = Math.min(startPos.client.y, currentPos.client.y)
    const width = Math.abs(currentPos.client.x - startPos.client.x)
    const height = Math.abs(currentPos.client.y - startPos.client.y)

    return {
      position: 'absolute',
      left: `${x}px`,
      top: `${y}px`,
      width: `${width}px`,
      height: `${height}px`,
      border: '2px solid rgba(59, 130, 246, 0.8)',
      backgroundColor: 'rgba(59, 130, 246, 0.1)',
      pointerEvents: 'none'
    }
  }

  return (
    <div
      onMouseDown={handleMouseDown}
      onMouseMove={handleMouseMove}
      onMouseUp={handleMouseUp}
      style={{
        width: '100vw',
        height: '100vh',
        background: 'rgba(0, 0, 0, 0.3)',
        cursor: 'crosshair',
        position: 'relative'
      }}
    >
      {isSelecting && <div style={getSelectionStyle()} />}

      {/* Instructions */}
      <div
        style={{
          position: 'absolute',
          top: '20px',
          left: '50%',
          transform: 'translateX(-50%)',
          color: 'white',
          fontSize: '14px',
          fontWeight: '500',
          textShadow: '0 2px 4px rgba(0,0,0,0.5)',
          pointerEvents: 'none',
          background: 'rgba(0, 0, 0, 0.5)',
          padding: '8px 16px',
          borderRadius: '8px'
        }}
      >
        Drag to select an area • Press ESC to cancel
      </div>
    </div>
  )
}

const container = document.getElementById('root')
document.body.style.backgroundColor = 'transparent'
document.documentElement.style.backgroundColor = 'transparent'

const root = createRoot(container)
root.render(<ScreenshotOverlayApp />)

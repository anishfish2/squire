import React, { useState, useEffect, useRef, useCallback } from 'react'
import { createRoot } from 'react-dom/client'
import '@/styles.css'

const { ipcRenderer } = window.require('electron')

function SuggestionsBoxApp() {
  const [suggestions, setSuggestions] = useState([])
  const [isHovered, setIsHovered] = useState(false)
  const [expandedSuggestions, setExpandedSuggestions] = useState(new Set())

  const idleTimerRef = useRef(null)
  const dragStateRef = useRef({
    isDragging: false,
    startX: 0,
    startY: 0,
    startBoxX: 0,
    startBoxY: 0,
    clickStartTime: 0,
    clickStartPos: { x: 0, y: 0 }
  })

  const IDLE_TIMEOUT_MS = 5000

  // Start idle timer
  const startIdleTimer = useCallback(() => {
    if (idleTimerRef.current) {
      clearTimeout(idleTimerRef.current)
    }
    idleTimerRef.current = setTimeout(() => {
      if (!isHovered) {
        ipcRenderer.send('toggle-suggestions-box', false)
      }
    }, IDLE_TIMEOUT_MS)
  }, [isHovered])

  // Pause idle timer
  const pauseIdleTimer = useCallback(() => {
    if (idleTimerRef.current) {
      clearTimeout(idleTimerRef.current)
      idleTimerRef.current = null
    }
  }, [])

  // Handle AI suggestions from IPC
  useEffect(() => {
    const handleAISuggestions = (event, data) => {
      console.log('Suggestions box received AI suggestions:', data)
      if (data.aiSuggestions && data.aiSuggestions.length > 0) {
        setSuggestions(data.aiSuggestions)
      }
    }

    ipcRenderer.on('ai-suggestions', handleAISuggestions)

    return () => {
      ipcRenderer.removeListener('ai-suggestions', handleAISuggestions)
    }
  }, [])

  // Start idle timer when window is shown
  useEffect(() => {
    startIdleTimer()
    return () => {
      if (idleTimerRef.current) {
        clearTimeout(idleTimerRef.current)
      }
    }
  }, [startIdleTimer])

  // Toggle suggestion details
  const toggleSuggestion = (index) => {
    setExpandedSuggestions(prev => {
      const newSet = new Set(prev)
      if (newSet.has(index)) {
        newSet.delete(index)
      } else {
        newSet.add(index)
      }
      return newSet
    })
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

    ipcRenderer.send('move-suggestions-box-window', newScreenX, newScreenY)
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
    <div
      className="w-auto min-w-[280px] max-w-[420px] min-h-[60px] max-h-[520px] bg-black rounded-2xl shadow-[0_20px_60px_rgba(0,0,0,0.6),inset_0_1px_1px_rgba(255,255,255,0.1)] backdrop-blur-3xl overflow-hidden"
      style={{ WebkitAppRegion: 'no-drag' }}
      onMouseEnter={() => {
        setIsHovered(true)
        pauseIdleTimer()
      }}
      onMouseLeave={() => {
        setIsHovered(false)
        startIdleTimer()
      }}
    >
      {/* Drag handle at the top */}
      <div
        className="w-full h-6 cursor-move bg-white/5 flex items-center justify-center border-b border-white/10"
        onMouseDown={handleMouseDown}
      >
        <div className="w-8 h-1 bg-white/20 rounded-full" />
      </div>

      <div className="text-content p-3 max-h-[480px] h-auto overflow-y-auto overflow-x-hidden custom-scrollbar">
        <div className="text-white text-sm leading-relaxed break-words text-left">
          {suggestions.map((suggestion, index) => (
            <SuggestionItem
              key={index}
              suggestion={suggestion}
              index={index}
              isExpanded={expandedSuggestions.has(index)}
              onToggle={() => toggleSuggestion(index)}
            />
          ))}
        </div>
      </div>
    </div>
  )
}

function SuggestionItem({ suggestion, index, isExpanded, onToggle }) {
  const shortDesc = suggestion.content?.short_description || suggestion.title
  const needsGuide = suggestion.content?.requires_detailed_guide

  return (
    <div className="bg-white/[0.05] text-white p-3 rounded-xl border border-white/20 shadow-[0_8px_24px_rgba(0,0,0,0.4)] transition-all duration-200 ease-out mb-3 last:mb-0">
      <div
        className="short-view cursor-pointer rounded-lg p-2 -m-2 transition-all"
        style={{
          background: 'rgba(59, 130, 246, 0.15)',
          border: '2px solid rgba(96, 165, 250, 0.4)'
        }}
        onClick={onToggle}
        onMouseEnter={(e) => e.currentTarget.style.background = 'rgba(59, 130, 246, 0.25)'}
        onMouseLeave={(e) => e.currentTarget.style.background = 'rgba(59, 130, 246, 0.15)'}
      >
        <div className="flex items-center justify-between gap-3">
          <p className="text-[13px] text-white/95 leading-relaxed flex-1 font-medium">{shortDesc}</p>
          <span className="expand-icon text-xs shrink-0 font-bold" style={{ color: '#60a5fa' }}>
            {isExpanded ? '▲' : '▼'}
          </span>
        </div>
      </div>

      {isExpanded && (
        <div className="full-view mt-3 pt-3 border-t border-white/20">
          <h3 className="m-0 mb-2 text-sm font-semibold text-white tracking-tight">{suggestion.title}</h3>
          <p className="text-[13px] mb-3 text-white/85 leading-relaxed">{suggestion.content?.description}</p>

          <div className="text-[11px] space-y-1.5 text-white/70 mb-3 bg-white/[0.05] rounded-lg p-2.5">
            <div className="flex gap-2">
              <span className="text-white/50 min-w-[65px] font-medium">Benefit:</span>
              <span className="text-white/85">{suggestion.content?.expected_benefit || '—'}</span>
            </div>
            <div className="flex gap-2">
              <span className="text-white/50 min-w-[65px] font-medium">Difficulty:</span>
              <span className="text-white/85">{suggestion.content?.difficulty || '—'}</span>
            </div>
            <div className="flex gap-2">
              <span className="text-white/50 min-w-[65px] font-medium">Time:</span>
              <span className="text-white/85">{suggestion.content?.time_investment || '—'}</span>
            </div>
            {suggestion.content?.platforms?.length > 0 && (
              <div className="flex gap-2">
                <span className="text-white/50 min-w-[65px] font-medium">Platforms:</span>
                <span className="text-white/85">{suggestion.content.platforms.join(', ')}</span>
              </div>
            )}
            {suggestion.content?.tools_needed?.length > 0 && (
              <div className="flex gap-2">
                <span className="text-white/50 min-w-[65px] font-medium">Tools:</span>
                <span className="text-white/85">{suggestion.content.tools_needed.join(', ')}</span>
              </div>
            )}
          </div>

          {suggestion.content?.action_steps?.length > 0 && (
            <div className="text-[12px] mb-3">
              <div className="font-semibold text-white/90 mb-2">Steps:</div>
              <ul className="ml-4 space-y-1.5 text-white/80">
                {suggestion.content.action_steps.map((step, i) => (
                  <li key={i} className="leading-relaxed">{step}</li>
                ))}
              </ul>
            </div>
          )}

          {needsGuide && (
            <button
              className="guide-button mt-2 px-3 py-2 text-[11px] bg-white/15 text-white border border-white/25 rounded-lg cursor-pointer hover:bg-white/20 hover:border-white/35 font-medium shadow-sm transition-all hover:shadow-md"
              onClick={(e) => {
                e.stopPropagation()
                console.log('📋 Detailed Guide for:', suggestion.title)
              }}
            >
              📋 Detailed Guide
            </button>
          )}
        </div>
      )}
    </div>
  )
}

const container = document.getElementById('root')
// Force transparent background
document.body.style.backgroundColor = 'transparent'
document.documentElement.style.backgroundColor = 'transparent'
container.style.backgroundColor = 'transparent'

const root = createRoot(container)
root.render(<SuggestionsBoxApp />)

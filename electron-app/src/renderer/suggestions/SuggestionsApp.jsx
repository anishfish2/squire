import React, { useState, useEffect, useRef, useCallback } from 'react'

const { ipcRenderer } = window.require('electron')

function SuggestionsApp() {
  const [suggestions, setSuggestions] = useState([])
  const [isExpanded, setIsExpanded] = useState(false)
  const [isHovered, setIsHovered] = useState(false)
  const [expandedSuggestions, setExpandedSuggestions] = useState(new Set())

  const idleTimerRef = useRef(null)
  const overlayContainerRef = useRef(null)
  const textBoxRef = useRef(null)
  const dotRef = useRef(null)
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
      if (!isHovered && isExpanded) {
        setIsExpanded(false)
      }
    }, IDLE_TIMEOUT_MS)
  }, [isHovered, isExpanded])

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
      console.log('Received AI suggestions:', data)
      if (data.aiSuggestions && data.aiSuggestions.length > 0) {
        setSuggestions(data.aiSuggestions)
        setIsExpanded(true)
      }
    }

    ipcRenderer.on('ai-suggestions', handleAISuggestions)
    ipcRenderer.send('suggestions-set-ignore-mouse-events', false)

    return () => {
      ipcRenderer.removeListener('ai-suggestions', handleAISuggestions)
    }
  }, [])

  // Start idle timer when expanded
  useEffect(() => {
    if (isExpanded) {
      startIdleTimer()
    }
    return () => {
      if (idleTimerRef.current) {
        clearTimeout(idleTimerRef.current)
      }
    }
  }, [isExpanded, startIdleTimer])

  // Handle force suggestion request
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

    ipcRenderer.send('move-suggestions-window', newScreenX, newScreenY)
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
      ref={overlayContainerRef}
      id="overlay-container"
      className="w-screen h-screen relative flex items-start justify-end pointer-events-none"
    >
      {/* Dot button */}
      {!isExpanded && (
        <div
          ref={dotRef}
          className="dot w-14 h-14 bg-gradient-to-b from-white/10 to-white/5 rounded-full shadow-[0_4px_16px_rgba(0,0,0,0.3),inset_0_1px_1px_rgba(255,255,255,0.3)] backdrop-blur-2xl cursor-pointer transition-all duration-300 ease-out absolute top-5 right-[26px] z-10 pointer-events-auto [-webkit-app-region:no-drag] flex items-center justify-center hover:scale-105 hover:shadow-[0_6px_20px_rgba(0,0,0,0.4),inset_0_1px_2px_rgba(255,255,255,0.4)] hover:border-white/30 hover:bg-gradient-to-b hover:from-white/15 hover:to-white/8"
          onClick={(e) => {
            e.stopPropagation()
            if (suggestions.length > 0) {
              setIsExpanded(true)
            }
          }}
          onMouseDown={handleMouseDown}
        />
      )}

      {/* Force suggestion button */}
      <button
        className="force-btn w-8 h-8 bg-white/5 rounded-full shadow-[0_2px_8px_rgba(0,0,0,0.3)] backdrop-blur-xl cursor-pointer transition-all duration-200 ease-out absolute top-[90px] right-[30px] z-10 pointer-events-auto [-webkit-app-region:no-drag] flex items-center justify-center hover:bg-white/10 hover:scale-105 border border-white/10 hover:border-white/20"
        title="Get Suggestions Now"
        onClick={handleForceSuggestion}
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-white/70">
          <circle cx="11" cy="11" r="8"></circle>
          <path d="m21 21-4.35-4.35"></path>
        </svg>
      </button>

      {/* Text box with suggestions */}
      {isExpanded && (
        <div
          ref={textBoxRef}
          className="text-box w-auto min-w-[280px] max-w-[420px] min-h-[60px] max-h-[520px] bg-black rounded-2xl shadow-[0_20px_60px_rgba(0,0,0,0.6),inset_0_1px_1px_rgba(255,255,255,0.1)] backdrop-blur-3xl absolute top-5 right-[15px] overflow-hidden z-[5] pointer-events-auto"
          onMouseEnter={() => {
            setIsHovered(true)
            pauseIdleTimer()
          }}
          onMouseLeave={() => {
            setIsHovered(false)
            startIdleTimer()
          }}
          onMouseDown={handleMouseDown}
        >
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
      )}
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

export default SuggestionsApp

import React, { useState, useEffect, useRef, useCallback } from 'react'
import { createRoot } from 'react-dom/client'
import '@/styles.css'

const { ipcRenderer } = window.require('electron')

// Tooltip component
const Tooltip = ({ text, hotkey, children, show }) => (
  <div className="relative inline-block">
    {children}
    {show && (
      <div style={{
        position: 'absolute',
        bottom: '-32px',
        left: '50%',
        transform: 'translateX(-50%)',
        padding: '5px 10px',
        background: 'rgba(0, 0, 0, 0.95)',
        color: 'white',
        fontSize: '11px',
        fontWeight: '500',
        borderRadius: '6px',
        whiteSpace: 'nowrap',
        pointerEvents: 'none',
        zIndex: 1000,
        animation: 'fadeIn 100ms ease-out',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        gap: '2px'
      }}>
        <span>{text}</span>
        {hotkey && (
          <span style={{
            fontSize: '9px',
            opacity: 0.6,
            fontFamily: 'monospace'
          }}>{hotkey}</span>
        )}
        <div style={{
          position: 'absolute',
          top: '-3px',
          left: '50%',
          transform: 'translateX(-50%)',
          width: 0,
          height: 0,
          borderLeft: '4px solid transparent',
          borderRight: '4px solid transparent',
          borderBottom: '4px solid rgba(0, 0, 0, 0.95)'
        }} />
      </div>
    )}
  </div>
)

// Available LLM models
const MODELS = [
  { id: 'gpt-4', name: 'GPT-4', provider: 'OpenAI' },
  { id: 'gpt-4-turbo', name: 'GPT-4 Turbo', provider: 'OpenAI' },
  { id: 'gpt-3.5-turbo', name: 'GPT-3.5 Turbo', provider: 'OpenAI' },
  { id: 'claude-3-opus', name: 'Claude 3 Opus', provider: 'Anthropic' },
  { id: 'claude-3-sonnet', name: 'Claude 3 Sonnet', provider: 'Anthropic' },
  { id: 'claude-3-haiku', name: 'Claude 3 Haiku', provider: 'Anthropic' },
  { id: 'gemini-pro', name: 'Gemini Pro', provider: 'Google' },
]

function LLMChatApp() {
  const [messages, setMessages] = useState([])
  const [input, setInput] = useState('')
  const [selectedModel, setSelectedModel] = useState('gpt-4')
  const [isLoading, setIsLoading] = useState(false)
  const [isHovered, setIsHovered] = useState(false)
  const messagesEndRef = useRef(null)
  const abortControllerRef = useRef(null)

  const [isVisible, setIsVisible] = useState(false)
  const [isWindowOpen, setIsWindowOpen] = useState(false)
  const [screenshots, setScreenshots] = useState([])
  const [visionEnabled, setVisionEnabled] = useState(false)
  const fileInputRef = useRef(null)

  // Tab state
  const [activeTab, setActiveTab] = useState('chat') // 'chat' or 'suggestions'
  const [suggestions, setSuggestions] = useState([])
  const [expandedSuggestion, setExpandedSuggestion] = useState(null)
  const [unreadCount, setUnreadCount] = useState(0)

  // Tooltip state
  const [hoveredButton, setHoveredButton] = useState(null)

  // Suggestion notification state
  const [suggestionNotification, setSuggestionNotification] = useState(null)

  // Collapsed state
  const [isCollapsed, setIsCollapsed] = useState(false)

  // Drag state
  const dragStateRef = useRef({
    isDragging: false,
    startX: 0,
    startY: 0,
    startWindowX: 0,
    startWindowY: 0
  })

  // Auto-scroll to bottom when new messages arrive
  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }

  useEffect(() => {
    scrollToBottom()
  }, [messages])

  // Mark suggestions as read when viewing suggestions tab
  useEffect(() => {
    if (activeTab === 'suggestions' && unreadCount > 0) {
      setSuggestions(prev => prev.map(s => ({ ...s, unread: false })))
      setUnreadCount(0)
      // Notify main process that suggestions have been read
      ipcRenderer.send('suggestions-read')
    }
  }, [activeTab, unreadCount])

  // Slide in animation on mount
  useEffect(() => {
    setTimeout(() => setIsVisible(true), 100)
    setIsWindowOpen(true) // Window is open on mount

    // Get initial vision state
    ipcRenderer.invoke('get-vision-state').then(state => {
      setVisionEnabled(state)
    })

    // Listen for vision state changes
    const handleVisionStateChange = (event, newState) => {
      setVisionEnabled(newState)
    }
    ipcRenderer.on('vision-state-changed', handleVisionStateChange)

    // Listen for window show/hide events
    const handleWindowShow = () => {
      setIsWindowOpen(true)
    }
    const handleWindowHide = () => {
      setIsWindowOpen(false)
    }
    ipcRenderer.on('llm-chat-window-shown', handleWindowShow)
    ipcRenderer.on('llm-chat-window-hidden', handleWindowHide)

    // Listen for AI suggestions
    const handleAISuggestions = (event, data) => {
      console.log('[LLM Chat] Received AI suggestions:', data)
      if (data.aiSuggestions && data.aiSuggestions.length > 0) {
        // Add new suggestions with timestamp and unread status
        const newSuggestions = data.aiSuggestions.map(s => ({
          ...s,
          timestamp: new Date().toISOString(),
          appName: data.appName,
          windowTitle: data.windowTitle,
          unread: true
        }))
        setSuggestions(prev => [...newSuggestions, ...prev])
        setUnreadCount(prev => prev + newSuggestions.length)

        // Get current window state - use a ref to get the latest value
        ipcRenderer.invoke('is-llm-chat-open').then(isOpen => {
          if (!isOpen) {
            // Show notification only if window is not open
            const firstSuggestion = newSuggestions[0]
            setSuggestionNotification({
              title: firstSuggestion.title || firstSuggestion.action || 'New Suggestion',
              description: firstSuggestion.description || firstSuggestion.content?.description || '',
              count: newSuggestions.length
            })

            // Auto-hide notification after 10 seconds
            setTimeout(() => {
              setSuggestionNotification(null)
            }, 10000)
          } else {
            // Switch to suggestions tab if window is visible
            setActiveTab('suggestions')
          }
        })
      }
    }
    ipcRenderer.on('ai-suggestions', handleAISuggestions)

    return () => {
      ipcRenderer.removeListener('vision-state-changed', handleVisionStateChange)
      ipcRenderer.removeListener('llm-chat-window-shown', handleWindowShow)
      ipcRenderer.removeListener('llm-chat-window-hidden', handleWindowHide)
      ipcRenderer.removeListener('ai-suggestions', handleAISuggestions)
    }
  }, [])

  // Send message to LLM
  const sendMessage = async () => {
    if (!input.trim() || isLoading) return

    const userMessage = {
      role: 'user',
      content: input.trim(),
      timestamp: new Date().toISOString(),
      model: selectedModel
    }

    setMessages(prev => [...prev, userMessage])
    setInput('')
    setIsLoading(true)

    // Create assistant message placeholder
    const assistantMessageId = Date.now()
    setMessages(prev => [...prev, {
      id: assistantMessageId,
      role: 'assistant',
      content: '',
      timestamp: new Date().toISOString(),
      isStreaming: true,
      model: selectedModel
    }])

    console.log('📤 Sending message with model:', selectedModel)

    try {
      // Create abort controller for cancellation
      abortControllerRef.current = new AbortController()

      const requestBody = {
        model: selectedModel,
        messages: [...messages, userMessage].map(m => ({
          role: m.role,
          content: m.content
        })),
        stream: true
      }

      console.log('📨 Request:', requestBody)

      const response = await fetch('http://localhost:8000/api/chat/stream', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(requestBody),
        signal: abortControllerRef.current.signal
      })

      console.log('📥 Response status:', response.status)

      if (!response.ok) {
        const errorText = await response.text()
        console.error('❌ Error response:', errorText)
        throw new Error(`HTTP error! status: ${response.status} - ${errorText}`)
      }

      const reader = response.body.getReader()
      const decoder = new TextDecoder()

      let accumulatedContent = ''

      while (true) {
        const { done, value } = await reader.read()

        if (done) break

        const chunk = decoder.decode(value)
        const lines = chunk.split('\n')

        for (const line of lines) {
          if (line.startsWith('data: ')) {
            const data = line.slice(6)

            if (data === '[DONE]') {
              break
            }

            try {
              const parsed = JSON.parse(data)
              if (parsed.content) {
                accumulatedContent += parsed.content

                // Update the streaming message
                setMessages(prev => prev.map(msg =>
                  msg.id === assistantMessageId
                    ? { ...msg, content: accumulatedContent }
                    : msg
                ))
              }
            } catch (e) {
              console.error('Error parsing SSE data:', e)
            }
          }
        }
      }

      // Mark streaming as complete
      setMessages(prev => prev.map(msg =>
        msg.id === assistantMessageId
          ? { ...msg, isStreaming: false }
          : msg
      ))

    } catch (error) {
      if (error.name === 'AbortError') {
        console.log('Request cancelled')
      } else {
        console.error('Error sending message:', error)

        // Show error message
        setMessages(prev => prev.map(msg =>
          msg.id === assistantMessageId
            ? {
                ...msg,
                content: `Error: ${error.message}. Make sure the backend server is running on http://localhost:8000`,
                isError: true,
                isStreaming: false
              }
            : msg
        ))
      }
    } finally {
      setIsLoading(false)
      abortControllerRef.current = null
    }
  }

  // Handle Enter key to send
  const handleKeyPress = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      sendMessage()
    }
  }

  // Clear conversation
  const clearConversation = () => {
    setMessages([])
  }

  // Stop generation
  const stopGeneration = () => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort()
      setIsLoading(false)
    }
  }

  // Capture screenshot
  const captureScreenshot = () => {
    // Send message to show screenshot overlay
    ipcRenderer.send('start-screenshot-capture')
  }

  // Listen for captured screenshots
  useEffect(() => {
    const handleScreenshotCaptured = (event, dataUrl) => {
      if (dataUrl) {
        setScreenshots(prev => [...prev, {
          id: Date.now(),
          dataUrl: dataUrl,
          name: 'Screenshot'
        }])
      }
    }

    ipcRenderer.on('screenshot-captured', handleScreenshotCaptured)

    return () => {
      ipcRenderer.removeListener('screenshot-captured', handleScreenshotCaptured)
    }
  }, [])

  // Remove screenshot
  const removeScreenshot = (id) => {
    setScreenshots(prev => prev.filter(s => s.id !== id))
  }

  // Toggle vision
  const toggleVision = () => {
    const newState = !visionEnabled
    setVisionEnabled(newState)
    ipcRenderer.send('toggle-global-vision', newState)
  }

  // Force suggestions
  const forceSuggestions = async () => {
    await ipcRenderer.invoke('force-suggestion-request')
  }

  // Handle notification click
  const handleNotificationClick = () => {
    setSuggestionNotification(null)
    ipcRenderer.send('toggle-llm-chat', true)
    setActiveTab('suggestions')
  }

  // Drag handlers
  const handleHeaderMouseDown = useCallback((e) => {
    // Only allow dragging on the header background, not on buttons
    if (e.target.tagName === 'BUTTON' || e.target.closest('button')) {
      return
    }

    const dragState = dragStateRef.current
    dragState.isDragging = true
    dragState.startX = e.screenX
    dragState.startY = e.screenY
    dragState.startWindowX = e.screenX - e.clientX
    dragState.startWindowY = e.screenY - e.clientY
  }, [])

  const handleMouseMove = useCallback((e) => {
    const dragState = dragStateRef.current
    if (!dragState.isDragging) return

    const deltaX = e.screenX - dragState.startX
    const deltaY = e.screenY - dragState.startY
    const newX = dragState.startWindowX + deltaX
    const newY = dragState.startWindowY + deltaY

    ipcRenderer.send('move-llm-chat-window', newX, newY)
  }, [])

  const handleMouseUp = useCallback(() => {
    const dragState = dragStateRef.current
    dragState.isDragging = false
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

  // Toggle collapse
  const toggleCollapse = () => {
    const newCollapsedState = !isCollapsed
    setIsCollapsed(newCollapsedState)

    if (newCollapsedState) {
      // Collapse to small bar (60px wide)
      ipcRenderer.send('resize-llm-chat-window', 60, 800)
    } else {
      // Expand back to normal size (400px wide)
      ipcRenderer.send('resize-llm-chat-window', 400, 800)
    }
  }

  // Keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (e) => {
      // Cmd+Option+V - Toggle Activity Tracking
      if (e.metaKey && e.altKey && e.key === 'v') {
        e.preventDefault()
        toggleVision()
      }
      // Cmd+Option+F - Force Suggestions
      else if (e.metaKey && e.altKey && e.key === 'f') {
        e.preventDefault()
        forceSuggestions()
      }
      // Cmd+Option+M - Toggle collapse/minimize to bar
      else if (e.metaKey && e.altKey && e.key === 'm') {
        e.preventDefault()
        toggleCollapse()
      }
      // Cmd+Option+S - Open Settings
      else if (e.metaKey && e.altKey && e.key === 's') {
        e.preventDefault()
        ipcRenderer.send('toggle-settings', true)
      }
      // Cmd+Option+W or Escape - Close window
      else if ((e.metaKey && e.altKey && e.key === 'w') || e.key === 'Escape') {
        e.preventDefault()
        ipcRenderer.send('toggle-hub-expansion', false)
        setTimeout(() => {
          ipcRenderer.send('toggle-llm-chat', false)
        }, 100)
      }
    }

    // Listen for global shortcut events from main process
    const handleGlobalVisionToggle = () => toggleVision()
    const handleForceSuggestions = () => forceSuggestions()
    const handleToggleCollapse = () => toggleCollapse()
    const handleCloseWindow = () => {
      ipcRenderer.send('toggle-hub-expansion', false)
      setTimeout(() => {
        ipcRenderer.send('toggle-llm-chat', false)
      }, 100)
    }

    ipcRenderer.on('global-vision-toggle', handleGlobalVisionToggle)
    ipcRenderer.on('force-suggestions-request', handleForceSuggestions)
    ipcRenderer.on('toggle-collapse-request', handleToggleCollapse)
    ipcRenderer.on('close-window-request', handleCloseWindow)

    window.addEventListener('keydown', handleKeyDown)
    return () => {
      window.removeEventListener('keydown', handleKeyDown)
      ipcRenderer.removeListener('global-vision-toggle', handleGlobalVisionToggle)
      ipcRenderer.removeListener('force-suggestions-request', handleForceSuggestions)
      ipcRenderer.removeListener('toggle-collapse-request', handleToggleCollapse)
      ipcRenderer.removeListener('close-window-request', handleCloseWindow)
    }
  }, [visionEnabled, isCollapsed])

  // Collapsed view - minimal bar
  if (isCollapsed) {
    return (
      <div
        className="w-full h-full flex flex-col items-center justify-center"
        style={{
          WebkitAppRegion: 'no-drag',
          background: 'rgba(15, 23, 42, 0.85)',
          backdropFilter: 'blur(10px)',
          borderRadius: '16px',
          boxShadow: '0 8px 24px rgba(0,0,0,0.28), 0 1px 0 rgba(255,255,255,0.06) inset',
          opacity: isVisible ? 1 : 0,
          transition: 'all 150ms ease-out',
          overflow: 'hidden'
        }}
      >
        {/* Expand button */}
        <button
          onClick={toggleCollapse}
          style={{
            width: '40px',
            height: '40px',
            borderRadius: '12px',
            background: 'rgba(59, 130, 246, 0.2)',
            border: '1px solid rgba(59, 130, 246, 0.3)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            cursor: 'pointer',
            transition: 'all 130ms ease-out',
            marginBottom: '12px'
          }}
          className="hover:bg-blue-500/30"
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="15 18 9 12 15 6"></polyline>
          </svg>
        </button>

        {/* Tab indicators */}
        <div className="flex flex-col gap-2">
          <button
            onClick={() => {
              setActiveTab('chat')
              toggleCollapse()
            }}
            style={{
              width: '40px',
              height: '40px',
              borderRadius: '12px',
              background: activeTab === 'chat' ? 'rgba(59, 130, 246, 0.3)' : 'rgba(71, 85, 105, 0.2)',
              border: '1px solid rgba(71, 85, 105, 0.3)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              cursor: 'pointer',
              transition: 'all 130ms ease-out'
            }}
            className="hover:bg-white/10"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" opacity="0.8">
              <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"></path>
            </svg>
          </button>

          <button
            onClick={() => {
              setActiveTab('suggestions')
              toggleCollapse()
            }}
            style={{
              width: '40px',
              height: '40px',
              borderRadius: '12px',
              background: activeTab === 'suggestions' ? 'rgba(59, 130, 246, 0.3)' : 'rgba(71, 85, 105, 0.2)',
              border: '1px solid rgba(71, 85, 105, 0.3)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              cursor: 'pointer',
              transition: 'all 130ms ease-out',
              position: 'relative'
            }}
            className="hover:bg-white/10"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" opacity="0.8">
              <path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z"></path>
            </svg>
            {unreadCount > 0 && (
              <span
                style={{
                  position: 'absolute',
                  top: '-4px',
                  right: '-4px',
                  width: '16px',
                  height: '16px',
                  borderRadius: '50%',
                  background: '#ef4444',
                  border: '2px solid rgba(15, 23, 42, 0.85)',
                  fontSize: '9px',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  color: 'white',
                  fontWeight: '600'
                }}
              >
                {unreadCount > 9 ? '9+' : unreadCount}
              </span>
            )}
          </button>
        </div>

        {/* Close button */}
        <button
          onClick={() => {
            ipcRenderer.send('toggle-hub-expansion', false)
            setTimeout(() => {
              ipcRenderer.send('toggle-llm-chat', false)
            }, 100)
          }}
          style={{
            width: '40px',
            height: '40px',
            borderRadius: '12px',
            background: 'rgba(71, 85, 105, 0.2)',
            border: '1px solid rgba(71, 85, 105, 0.3)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            cursor: 'pointer',
            transition: 'all 130ms ease-out',
            marginTop: 'auto'
          }}
          className="hover:bg-white/10"
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" opacity="0.6">
            <line x1="18" y1="6" x2="6" y2="18"></line>
            <line x1="6" y1="6" x2="18" y2="18"></line>
          </svg>
        </button>
      </div>
    )
  }

  return (
    <div
      className="w-full h-full flex flex-col"
      style={{
        WebkitAppRegion: 'no-drag',
        background: 'rgba(15, 23, 42, 0.08)',
        backdropFilter: 'blur(10px)',
        borderRadius: '16px',
        boxShadow: '0 8px 24px rgba(0,0,0,0.28), 0 1px 0 rgba(255,255,255,0.06) inset',
        transform: isVisible ? 'scale(1) translateX(0)' : 'scale(0.98) translateX(100%)',
        transition: isVisible
          ? 'transform 150ms ease-out, opacity 150ms ease-out'
          : 'transform 120ms ease-in, opacity 120ms ease-in',
        opacity: isVisible ? 1 : 0,
        overflow: 'hidden'
      }}
    >
      {/* Loading progress bar */}
      {isLoading && (
        <div style={{
          position: 'absolute',
          top: 0,
          left: 0,
          right: 0,
          height: '2px',
          background: 'linear-gradient(90deg, transparent, rgba(59, 130, 246, 0.8), transparent)',
          animation: 'shimmer 1.5s infinite',
          zIndex: 100
        }} />
      )}

      {/* Header */}
      <div
        className="w-full h-12 flex items-center justify-between px-4 border-b"
        style={{
          background: 'rgba(30, 41, 59, 0.06)',
          backdropFilter: 'blur(8px)',
          borderBottomColor: 'rgba(71, 85, 105, 0.2)',
          cursor: 'move',
          borderTopLeftRadius: '16px',
          borderTopRightRadius: '16px'
        }}
        onMouseDown={handleHeaderMouseDown}
      >
        <div className="flex items-center gap-3">
          {/* Tab switcher */}
          <div className="flex items-center gap-1 bg-white/5 rounded-full p-0.5">
            <button
              onClick={() => setActiveTab('chat')}
              style={{
                borderRadius: '24px',
                transition: 'all 140ms ease-out'
              }}
              className={`px-3 py-1 text-xs font-semibold ${
                activeTab === 'chat'
                  ? 'bg-blue-500 text-white shadow-sm'
                  : 'text-white/60 hover:text-white/90 hover:bg-white/5'
              }`}
            >
              Chat
            </button>
            <button
              onClick={() => setActiveTab('suggestions')}
              style={{
                borderRadius: '24px',
                transition: 'all 140ms ease-out'
              }}
              className={`px-3 py-1 text-xs font-semibold flex items-center gap-2.5 relative ${
                activeTab === 'suggestions'
                  ? 'bg-blue-500 text-white shadow-sm'
                  : 'text-white/60 hover:text-white/90 hover:bg-white/5'
              }`}
            >
              Suggestions
              {unreadCount > 0 && (
                <span className="px-1.5 py-0.5 bg-white/25 text-[10px] rounded-full font-medium">
                  {unreadCount}
                </span>
              )}
              {unreadCount > 0 && (
                <span className="absolute -top-1 -right-1 w-2 h-2 bg-red-500 rounded-full shadow-sm"></span>
              )}
            </button>
          </div>
        </div>
        <div className="flex items-center gap-1">
          <Tooltip text="Activity Tracking" hotkey="⌘⌥V" show={hoveredButton === 'vision'}>
            <button
              onClick={toggleVision}
              onMouseEnter={() => setHoveredButton('vision')}
              onMouseLeave={() => setHoveredButton(null)}
              style={{
                borderRadius: '20px',
                transition: 'all 130ms ease-out'
              }}
              className={`w-7 h-7 flex items-center justify-center ${
                visionEnabled
                  ? 'text-blue-400 hover:bg-blue-500/10'
                  : 'text-white/50 hover:bg-white/5 hover:text-white/70'
              }`}
            >
              {visionEnabled ? (
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"></path>
                  <circle cx="12" cy="12" r="3"></circle>
                </svg>
              ) : (
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"></path>
                  <line x1="1" y1="1" x2="23" y2="23"></line>
                </svg>
              )}
            </button>
          </Tooltip>
          <Tooltip text="Suggest" hotkey="⌘⌥F" show={hoveredButton === 'suggest'}>
            <button
              onClick={forceSuggestions}
              onMouseEnter={() => setHoveredButton('suggest')}
              onMouseLeave={() => setHoveredButton(null)}
              style={{
                borderRadius: '20px',
                transition: 'all 130ms ease-out'
              }}
              className="w-7 h-7 text-white/50 hover:text-blue-400 hover:bg-blue-500/10 flex items-center justify-center"
            >
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z"></path>
              </svg>
            </button>
          </Tooltip>
          <Tooltip text="Clear" show={hoveredButton === 'clear'}>
            <button
              onClick={clearConversation}
              onMouseEnter={() => setHoveredButton('clear')}
              onMouseLeave={() => setHoveredButton(null)}
              style={{
                borderRadius: '20px',
                transition: 'all 130ms ease-out'
              }}
              className="w-7 h-7 text-white/50 hover:text-white/90 hover:bg-white/10 flex items-center justify-center"
            >
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M3 6h18"></path>
                <path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"></path>
                <path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"></path>
              </svg>
            </button>
          </Tooltip>
          <Tooltip text="Settings" hotkey="⌘⌥S" show={hoveredButton === 'settings'}>
            <button
              onClick={() => ipcRenderer.send('toggle-settings', true)}
              onMouseEnter={() => setHoveredButton('settings')}
              onMouseLeave={() => setHoveredButton(null)}
              style={{
                borderRadius: '20px',
                transition: 'all 130ms ease-out'
              }}
              className="w-7 h-7 text-white/50 hover:text-white/90 hover:bg-white/10 flex items-center justify-center"
            >
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="12" cy="12" r="3"></circle>
                <path d="M12 1v6m0 6v6m9-9h-6m-6 0H3"></path>
              </svg>
            </button>
          </Tooltip>
          <div className="w-px h-4 bg-white/10 mx-1"></div>
          <Tooltip text="Close" show={hoveredButton === 'close'}>
            <button
              onClick={async () => {
                ipcRenderer.send('toggle-hub-expansion', false)
                await new Promise(resolve => setTimeout(resolve, 100))
                ipcRenderer.send('toggle-llm-chat', false)
              }}
              onMouseEnter={() => setHoveredButton('close')}
              onMouseLeave={() => setHoveredButton(null)}
              style={{
                borderRadius: '20px',
                transition: 'all 130ms ease-out'
              }}
              className="w-7 h-7 text-white/50 hover:text-white/90 hover:bg-white/10 flex items-center justify-center"
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <line x1="18" y1="6" x2="6" y2="18"></line>
                <line x1="6" y1="6" x2="18" y2="18"></line>
              </svg>
            </button>
          </Tooltip>
        </div>
      </div>

      {/* Content area - Chat or Suggestions */}
      {activeTab === 'chat' ? (
        <>
          {/* Messages area */}
          <div className="flex-1 overflow-y-auto overflow-x-hidden custom-scrollbar px-4 py-4" style={{
            background: 'rgba(15, 23, 42, 0.3)'
          }}>
            {messages.length === 0 ? (
              <div className="flex flex-col items-center justify-center h-full text-white/40 text-sm gap-2">
                <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" opacity="0.4">
                  <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"></path>
                </svg>
                <span className="font-medium">Type to ask...</span>
                <span className="text-xs text-white/30">⌘↵ to send</span>
              </div>
            ) : (
              <div className="space-y-4">
                {messages.map((msg, idx) => (
                  <ChatMessage key={idx} message={msg} />
                ))}
                <div ref={messagesEndRef} />
              </div>
            )}
          </div>

          {/* Input area */}
          <div className="p-5 border-t" style={{
            background: 'rgba(30, 41, 59, 0.95)',
            borderTopColor: 'rgba(71, 85, 105, 0.3)'
          }}>
            {/* Screenshot previews */}
            {screenshots.length > 0 && (
              <div className="mb-4 flex gap-2 flex-wrap">
                {screenshots.map(screenshot => (
                  <div key={screenshot.id} className="relative group">
                    <img
                      src={screenshot.dataUrl}
                      alt={screenshot.name}
                      className="w-16 h-16 object-cover rounded border border-white/10"
                    />
                    <button
                      onClick={() => removeScreenshot(screenshot.id)}
                      className="absolute -top-1.5 -right-1.5 w-5 h-5 bg-red-500 hover:bg-red-600 text-white rounded-full text-xs opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center"
                    >
                      <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3">
                        <line x1="18" y1="6" x2="6" y2="18"></line>
                        <line x1="6" y1="6" x2="18" y2="18"></line>
                      </svg>
                    </button>
                  </div>
                ))}
              </div>
            )}

            <div className="flex gap-3 items-end">
              <div className="flex-1">
                <input
                  type="text"
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  onKeyPress={handleKeyPress}
                  placeholder="Type to ask... ⌘↵"
                  className="w-full text-white text-sm px-4 py-3 focus:outline-none focus:ring-1 focus:ring-blue-500 placeholder-white/40 transition-all"
                  style={{
                    background: 'rgba(51, 65, 85, 0.3)',
                    border: '1px solid rgba(71, 85, 105, 0.25)',
                    borderRadius: '14px',
                    height: '44px',
                    fontWeight: '500'
                  }}
                  disabled={isLoading}
                />
                <div className="flex items-center justify-between mt-3">
                  <button
                    onClick={captureScreenshot}
                    className="text-white/40 hover:text-white/90 text-xs transition-all flex items-center gap-2.5"
                    title="Capture screenshot"
                  >
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"></path>
                      <circle cx="12" cy="13" r="4"></circle>
                    </svg>
                    <span>Screenshot</span>
                  </button>
                  <select
                    value={selectedModel}
                    onChange={(e) => setSelectedModel(e.target.value)}
                    className="text-white/70 text-[10px] px-2.5 py-1.5 rounded focus:outline-none focus:ring-1 focus:ring-blue-500/50 cursor-pointer transition-all"
                    style={{
                      background: 'rgba(51, 65, 85, 0.3)',
                      border: '1px solid rgba(71, 85, 105, 0.25)',
                      borderRadius: '8px'
                    }}
                  >
                    {MODELS.map(model => (
                      <option key={model.id} value={model.id} style={{ background: 'rgba(30, 41, 59, 1)' }}>
                        {model.name}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
              {isLoading ? (
                <button
                  onClick={stopGeneration}
                  style={{
                    borderRadius: '14px',
                    transition: 'all 130ms ease-out',
                    boxShadow: '0 2px 8px rgba(239, 68, 68, 0.2)'
                  }}
                  className="px-5 py-3 bg-red-500 hover:bg-red-600 text-white text-xs font-semibold flex items-center gap-2"
                >
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor">
                    <rect x="6" y="6" width="12" height="12"></rect>
                  </svg>
                  Stop
                </button>
              ) : (
                <button
                  onClick={sendMessage}
                  disabled={!input.trim()}
                  style={{
                    borderRadius: '14px',
                    transition: 'all 130ms ease-out',
                    boxShadow: !input.trim() ? 'none' : '0 2px 8px rgba(59, 130, 246, 0.25)'
                  }}
                  className="px-5 py-3 bg-blue-500 hover:bg-blue-600 text-white text-xs font-semibold disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:bg-blue-500 flex items-center gap-2"
                >
                  <span>Send</span>
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <line x1="22" y1="2" x2="11" y2="13"></line>
                    <polygon points="22 2 15 22 11 13 2 9 22 2"></polygon>
                  </svg>
                </button>
              )}
            </div>
          </div>
        </>
      ) : (
        /* Suggestions View */
        <div className="flex-1 overflow-y-auto overflow-x-hidden custom-scrollbar" style={{
          background: 'rgba(15, 23, 42, 0.3)',
          WebkitAppRegion: 'no-drag',
          pointerEvents: 'auto'
        }}>
          {suggestions.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-full text-white/40 text-sm gap-2">
              <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" opacity="0.4">
                <path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z"></path>
              </svg>
              <span className="font-medium">No suggestions yet</span>
              <span className="text-xs text-white/30">Suggestions will appear here automatically</span>
            </div>
          ) : (
            <div className="p-4 space-y-3" style={{ WebkitAppRegion: 'no-drag', pointerEvents: 'auto' }}>
              {suggestions.map((suggestion, idx) => (
                <SuggestionCard
                  key={idx}
                  suggestion={suggestion}
                  isExpanded={expandedSuggestion === idx}
                  onToggle={() => setExpandedSuggestion(expandedSuggestion === idx ? null : idx)}
                />
              ))}
            </div>
          )}
        </div>
      )}

      {/* Suggestion Notification Popup */}
      {suggestionNotification && (
        <div
          onClick={handleNotificationClick}
          style={{
            position: 'fixed',
            bottom: '20px',
            right: '20px',
            width: '320px',
            background: 'rgba(30, 41, 59, 0.98)',
            backdropFilter: 'blur(12px)',
            borderRadius: '12px',
            boxShadow: '0 8px 32px rgba(0,0,0,0.4), 0 1px 0 rgba(255,255,255,0.1) inset',
            padding: '16px',
            cursor: 'pointer',
            border: '1px solid rgba(59, 130, 246, 0.3)',
            animation: 'slideIn 200ms ease-out',
            zIndex: 10000
          }}
        >
          <div style={{ display: 'flex', alignItems: 'flex-start', gap: '12px' }}>
            <div style={{
              flexShrink: 0,
              width: '32px',
              height: '32px',
              borderRadius: '8px',
              background: 'rgba(59, 130, 246, 0.2)',
              border: '1px solid rgba(59, 130, 246, 0.4)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center'
            }}>
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="rgba(59, 130, 246, 0.9)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z"></path>
              </svg>
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                marginBottom: '6px'
              }}>
                <span style={{
                  color: 'white',
                  fontSize: '13px',
                  fontWeight: '600'
                }}>
                  New Suggestion{suggestionNotification.count > 1 ? 's' : ''}
                </span>
                {suggestionNotification.count > 1 && (
                  <span style={{
                    background: 'rgba(59, 130, 246, 0.2)',
                    color: 'rgba(59, 130, 246, 0.9)',
                    fontSize: '10px',
                    fontWeight: '600',
                    padding: '2px 6px',
                    borderRadius: '8px'
                  }}>
                    {suggestionNotification.count}
                  </span>
                )}
              </div>
              <div style={{
                color: 'rgba(255, 255, 255, 0.9)',
                fontSize: '12px',
                fontWeight: '500',
                marginBottom: '4px'
              }}>
                {suggestionNotification.title}
              </div>
              <div style={{
                color: 'rgba(255, 255, 255, 0.5)',
                fontSize: '11px',
                lineHeight: '1.4',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                display: '-webkit-box',
                WebkitLineClamp: 2,
                WebkitBoxOrient: 'vertical'
              }}>
                {suggestionNotification.description}
              </div>
              <div style={{
                marginTop: '8px',
                color: 'rgba(59, 130, 246, 0.8)',
                fontSize: '10px',
                fontWeight: '500'
              }}>
                Click to view →
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

function SuggestionCard({ suggestion, isExpanded, onToggle }) {
  const formatTime = (timestamp) => {
    const date = new Date(timestamp)
    return date.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })
  }

  const handleClick = (e) => {
    e.preventDefault()
    e.stopPropagation()
    onToggle()
  }

  return (
    <div
      className="rounded-lg border overflow-hidden transition-all"
      style={{
        background: 'rgba(30, 41, 59, 0.6)',
        borderColor: 'rgba(71, 85, 105, 0.3)',
        WebkitAppRegion: 'no-drag',
        pointerEvents: 'auto'
      }}
    >
      {/* Header - Always visible */}
      <div
        onClick={handleClick}
        className="w-full p-3 flex items-start gap-3 hover:bg-white/5 transition-all cursor-pointer"
        style={{ WebkitAppRegion: 'no-drag', userSelect: 'none' }}
      >
        <div className="flex-shrink-0 w-8 h-8 rounded-full flex items-center justify-center text-xs font-medium" style={{
          background: 'rgba(59, 130, 246, 0.2)',
          border: '1px solid rgba(59, 130, 246, 0.3)'
        }}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z"></path>
          </svg>
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1">
            <span className="text-xs text-white/90 font-medium">
              {suggestion.appName?.replace('Batch Analysis', '').trim() || 'App'}
            </span>
            <span className="text-[10px] text-white/30">•</span>
            <span className="text-[10px] text-white/40">{formatTime(suggestion.timestamp)}</span>
          </div>
          <div className="text-xs text-white/60 truncate mb-1.5">{suggestion.windowTitle}</div>
          <div className="text-xs text-white/50 line-clamp-2">
            {suggestion.title || suggestion.action || suggestion.description || ''}
          </div>
        </div>
        <div className="flex-shrink-0 text-white/40">
          <svg
            width="16"
            height="16"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            style={{
              transform: isExpanded ? 'rotate(180deg)' : 'rotate(0deg)',
              transition: 'transform 0.2s'
            }}
          >
            <polyline points="6 9 12 15 18 9"></polyline>
          </svg>
        </div>
      </div>

      {/* Expanded details */}
      {isExpanded && (
        <div className="px-3 pb-3 space-y-3 border-t" style={{
          borderColor: 'rgba(71, 85, 105, 0.2)'
        }}>
          <div className="mt-3">
            {/* Parse and display content field if it's an object */}
            {suggestion.content && typeof suggestion.content === 'object' && (
              <div className="space-y-2 mb-3">
                {suggestion.content.description && (
                  <div>
                    <div className="text-[10px] text-white/40 uppercase tracking-wider mb-1">Description</div>
                    <div className="text-xs text-white/80 leading-relaxed">{suggestion.content.description}</div>
                  </div>
                )}
                {suggestion.content.expected_benefit && (
                  <div>
                    <div className="text-[10px] text-white/40 uppercase tracking-wider mb-1">Expected Benefit</div>
                    <div className="text-xs text-white/80 leading-relaxed">{suggestion.content.expected_benefit}</div>
                  </div>
                )}
                {suggestion.content.action_steps && Array.isArray(suggestion.content.action_steps) && (
                  <div>
                    <div className="text-[10px] text-white/40 uppercase tracking-wider mb-1">Action Steps</div>
                    <ol className="text-xs text-white/80 space-y-1 list-decimal list-inside">
                      {suggestion.content.action_steps.map((step, idx) => (
                        <li key={idx}>{step}</li>
                      ))}
                    </ol>
                  </div>
                )}
                {suggestion.content.difficulty && (
                  <div className="flex items-center gap-2">
                    <span className="text-[10px] text-white/40 uppercase tracking-wider">Difficulty:</span>
                    <span className="text-xs text-white/80">{suggestion.content.difficulty}</span>
                  </div>
                )}
                {suggestion.content.time_investment && (
                  <div className="flex items-center gap-2">
                    <span className="text-[10px] text-white/40 uppercase tracking-wider">Time:</span>
                    <span className="text-xs text-white/80">{suggestion.content.time_investment}</span>
                  </div>
                )}
              </div>
            )}

            {/* Other fields */}
            <div className="space-y-2">
              {suggestion.type && (
                <div className="flex items-center gap-2">
                  <span className="text-[10px] text-white/40 uppercase tracking-wider">Type:</span>
                  <span className="text-xs text-white/80">{suggestion.type}</span>
                </div>
              )}
              {suggestion.priority && (
                <div className="flex items-center gap-2">
                  <span className="text-[10px] text-white/40 uppercase tracking-wider">Priority:</span>
                  <span className="text-xs text-white/80">{suggestion.priority}</span>
                </div>
              )}
              {suggestion.confidence_score && (
                <div className="flex items-center gap-2">
                  <span className="text-[10px] text-white/40 uppercase tracking-wider">Confidence:</span>
                  <span className="text-xs text-white/80">{(suggestion.confidence_score * 100).toFixed(0)}%</span>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

function ChatMessage({ message }) {
  const isUser = message.role === 'user'
  const isError = message.isError

  // Get model name for display
  const modelInfo = MODELS.find(m => m.id === message.model) || MODELS.find(m => m.id === 'gpt-4')
  const displayName = isUser ? 'You' : `${modelInfo?.name || 'Assistant'}`

  // Simple markdown rendering
  const renderContent = (content) => {
    if (!content) return ''

    // Code blocks
    content = content.replace(/```(\w*)\n([\s\S]*?)```/g, (match, lang, code) => {
      return `<pre style="background: rgba(15, 23, 42, 0.6); padding: 12px; border-radius: 6px; margin: 8px 0; overflow-x: auto; border: 1px solid rgba(71, 85, 105, 0.3);"><code class="text-xs text-white/90 font-mono">${code.trim()}</code></pre>`
    })

    // Inline code
    content = content.replace(/`([^`]+)`/g, '<code style="background: rgba(15, 23, 42, 0.6); padding: 2px 6px; border-radius: 4px; font-size: 0.8125rem; font-family: monospace; border: 1px solid rgba(71, 85, 105, 0.2);">$1</code>')

    // Bold
    content = content.replace(/\*\*(.+?)\*\*/g, '<strong class="font-semibold">$1</strong>')

    // Italic
    content = content.replace(/\*(.+?)\*/g, '<em class="italic">$1</em>')

    // Line breaks
    content = content.replace(/\n/g, '<br/>')

    return content
  }

  return (
    <div className="flex gap-3">
      <div className="flex-shrink-0 w-7 h-7 rounded-full flex items-center justify-center text-xs font-medium" style={{
        background: isUser ? 'rgba(59, 130, 246, 0.2)' : 'rgba(100, 116, 139, 0.2)',
        color: isUser ? 'rgba(147, 197, 253, 0.9)' : 'rgba(203, 213, 225, 0.9)',
        border: `1px solid ${isUser ? 'rgba(59, 130, 246, 0.3)' : 'rgba(100, 116, 139, 0.3)'}`
      }}>
        {isUser ? 'U' : 'A'}
      </div>
      <div className="flex-1 min-w-0">
        <div className="text-xs text-white/40 mb-1.5 font-medium">
          {displayName}
        </div>
        <div
          className={`text-sm break-words leading-relaxed ${
            isError ? 'text-red-300' : 'text-white/85'
          }`}
          dangerouslySetInnerHTML={{ __html: renderContent(message.content) }}
        />
        {message.isStreaming && (
          <span className="inline-block w-1.5 h-3.5 ml-1 bg-blue-400/70 animate-pulse rounded-sm" />
        )}
      </div>
    </div>
  )
}

// Add shimmer and slide-in animations
const style = document.createElement('style')
style.textContent = `
  @keyframes shimmer {
    0% { transform: translateX(-100%); }
    100% { transform: translateX(200%); }
  }
  @keyframes slideIn {
    0% {
      transform: translateX(100%) scale(0.95);
      opacity: 0;
    }
    100% {
      transform: translateX(0) scale(1);
      opacity: 1;
    }
  }
`
document.head.appendChild(style)

const container = document.getElementById('root')
// Force transparent background
document.body.style.backgroundColor = 'transparent'
document.documentElement.style.backgroundColor = 'transparent'
container.style.backgroundColor = 'transparent'

const root = createRoot(container)
root.render(<LLMChatApp />)

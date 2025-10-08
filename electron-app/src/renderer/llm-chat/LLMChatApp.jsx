import React, { useState, useEffect, useRef, useCallback } from 'react'
import { createRoot } from 'react-dom/client'
import '@/styles.css'

const { ipcRenderer } = window.require('electron')

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
  const [screenshots, setScreenshots] = useState([])
  const [visionEnabled, setVisionEnabled] = useState(true)
  const fileInputRef = useRef(null)

  // Auto-scroll to bottom when new messages arrive
  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }

  useEffect(() => {
    scrollToBottom()
  }, [messages])

  // Slide in animation on mount
  useEffect(() => {
    setTimeout(() => setIsVisible(true), 100)

    // Get initial vision state
    ipcRenderer.invoke('get-vision-state').then(state => {
      setVisionEnabled(state)
    })

    // Listen for vision state changes
    const handleVisionStateChange = (event, newState) => {
      setVisionEnabled(newState)
    }
    ipcRenderer.on('vision-state-changed', handleVisionStateChange)

    return () => {
      ipcRenderer.removeListener('vision-state-changed', handleVisionStateChange)
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

  // Toggle suggestions box
  const toggleSuggestionsBox = () => {
    ipcRenderer.send('toggle-suggestions-box', true)
  }


  return (
    <div
      className="w-full h-full flex flex-col"
      style={{
        WebkitAppRegion: 'no-drag',
        background: 'rgba(15, 23, 42, 0.96)',
        backdropFilter: 'blur(20px)',
        transform: isVisible ? 'translateX(0)' : 'translateX(100%)',
        transition: 'transform 0.3s cubic-bezier(0.4, 0, 0.2, 1)'
      }}
    >
      {/* Header */}
      <div
        className="w-full h-12 flex items-center justify-between px-4 border-b"
        style={{
          background: 'rgba(30, 41, 59, 0.95)',
          borderBottomColor: 'rgba(71, 85, 105, 0.3)'
        }}
      >
        <div className="flex items-center gap-3">
          <div className="text-white/90 text-xs font-semibold uppercase tracking-wide">Chat</div>
        </div>
        <div className="flex items-center gap-1">
          <button
            onClick={toggleVision}
            className={`w-7 h-7 rounded transition-all flex items-center justify-center ${
              visionEnabled
                ? 'text-blue-400 hover:bg-white/10'
                : 'text-white/40 hover:bg-white/5 hover:text-white/60'
            }`}
            title={visionEnabled ? "Vision enabled" : "Vision disabled"}
          >
            {visionEnabled ? (
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"></path>
                <circle cx="12" cy="12" r="3"></circle>
              </svg>
            ) : (
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <line x1="1" y1="1" x2="23" y2="23"></line>
                <path d="M9 9v6"></path>
                <path d="M15 9v6"></path>
              </svg>
            )}
          </button>
          <button
            onClick={forceSuggestions}
            className="w-7 h-7 text-white/40 hover:text-white/90 hover:bg-white/10 rounded transition-all flex items-center justify-center"
            title="Force suggestions"
          >
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z"></path>
            </svg>
          </button>
          <button
            onClick={toggleSuggestionsBox}
            className="w-7 h-7 text-white/40 hover:text-white/90 hover:bg-white/10 rounded transition-all flex items-center justify-center"
            title="Open suggestions"
          >
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="11" cy="11" r="8"></circle>
              <path d="m21 21-4.35-4.35"></path>
            </svg>
          </button>
          <button
            onClick={clearConversation}
            className="w-7 h-7 text-white/40 hover:text-white/90 hover:bg-white/10 rounded transition-all flex items-center justify-center"
            title="Clear conversation"
          >
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M3 6h18"></path>
              <path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"></path>
              <path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"></path>
            </svg>
          </button>
          <div className="w-px h-4 bg-white/10 mx-1"></div>
          <button
            onClick={() => ipcRenderer.send('toggle-llm-chat', false)}
            className="w-7 h-7 text-white/40 hover:text-white/90 hover:bg-white/10 rounded transition-all flex items-center justify-center"
            title="Close"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <line x1="18" y1="6" x2="6" y2="18"></line>
              <line x1="6" y1="6" x2="18" y2="18"></line>
            </svg>
          </button>
        </div>
      </div>

      {/* Model selector */}
      <div className="px-4 py-2.5 border-b" style={{
        background: 'rgba(30, 41, 59, 0.5)',
        borderBottomColor: 'rgba(71, 85, 105, 0.2)'
      }}>
        <select
          value={selectedModel}
          onChange={(e) => setSelectedModel(e.target.value)}
          className="w-full text-white/90 text-xs px-2.5 py-1.5 rounded focus:outline-none focus:ring-1 focus:ring-blue-500/50 cursor-pointer transition-all"
          style={{ background: 'rgba(51, 65, 85, 0.4)', border: '1px solid rgba(71, 85, 105, 0.3)' }}
        >
          {MODELS.map(model => (
            <option key={model.id} value={model.id} style={{ background: 'rgba(30, 41, 59, 1)' }}>
              {model.name} ({model.provider})
            </option>
          ))}
        </select>
      </div>

      {/* Messages area */}
      <div className="flex-1 overflow-y-auto overflow-x-hidden custom-scrollbar px-4 py-4" style={{
        background: 'rgba(15, 23, 42, 0.3)'
      }}>
        {messages.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-white/20 text-sm gap-3">
            <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" opacity="0.3">
              <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"></path>
            </svg>
            <span>Start a conversation...</span>
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
      <div className="p-4 border-t" style={{
        background: 'rgba(30, 41, 59, 0.95)',
        borderTopColor: 'rgba(71, 85, 105, 0.3)'
      }}>
        {/* Screenshot previews */}
        {screenshots.length > 0 && (
          <div className="mb-3 flex gap-2 flex-wrap">
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

        <div className="flex gap-2 items-end">
          <div className="flex-1">
            <textarea
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyPress={handleKeyPress}
              placeholder="Ask anything..."
              className="w-full text-white/90 text-sm px-3 py-2.5 rounded focus:outline-none focus:ring-1 focus:ring-blue-500/50 resize-none placeholder-white/30 transition-all"
              style={{
                background: 'rgba(51, 65, 85, 0.4)',
                border: '1px solid rgba(71, 85, 105, 0.3)',
                minHeight: '42px',
                maxHeight: '120px'
              }}
              rows="1"
              disabled={isLoading}
            />
            <div className="flex items-center gap-2 mt-2">
              <button
                onClick={captureScreenshot}
                className="text-white/40 hover:text-white/90 text-xs transition-all flex items-center gap-1.5"
                title="Capture screenshot"
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"></path>
                  <circle cx="12" cy="13" r="4"></circle>
                </svg>
                <span>Screenshot</span>
              </button>
            </div>
          </div>
          {isLoading ? (
            <button
              onClick={stopGeneration}
              className="px-4 py-2.5 bg-red-500/90 hover:bg-red-500 text-white text-xs rounded transition-all font-medium flex items-center gap-2"
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
              className="px-4 py-2.5 bg-blue-500/90 hover:bg-blue-500 text-white text-xs rounded transition-all font-medium disabled:opacity-40 disabled:cursor-not-allowed flex items-center gap-2"
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

const container = document.getElementById('root')
// Force transparent background
document.body.style.backgroundColor = 'transparent'
document.documentElement.style.backgroundColor = 'transparent'
container.style.backgroundColor = 'transparent'

const root = createRoot(container)
root.render(<LLMChatApp />)

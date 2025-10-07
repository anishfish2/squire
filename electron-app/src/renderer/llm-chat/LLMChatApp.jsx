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

  const dragStateRef = useRef({
    isDragging: false,
    startX: 0,
    startY: 0,
    startBoxX: 0,
    startBoxY: 0,
    clickStartTime: 0,
    clickStartPos: { x: 0, y: 0 }
  })

  // Auto-scroll to bottom when new messages arrive
  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }

  useEffect(() => {
    scrollToBottom()
  }, [messages])

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

    ipcRenderer.send('move-llm-chat-window', newScreenX, newScreenY)
  }, [])

  const handleMouseUp = useCallback((e) => {
    const dragState = dragStateRef.current
    if (!dragState.isDragging) return

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

  return (
    <div
      className="w-full h-full bg-black rounded-2xl shadow-[0_20px_60px_rgba(0,0,0,0.6),inset_0_1px_1px_rgba(255,255,255,0.1)] backdrop-blur-3xl overflow-hidden flex flex-col"
      style={{ WebkitAppRegion: 'no-drag' }}
    >
      {/* Drag handle at the top */}
      <div
        className="w-full h-6 cursor-move bg-white/5 flex items-center justify-between px-3 border-b border-white/10"
        onMouseDown={handleMouseDown}
      >
        <div className="w-8 h-1 bg-white/20 rounded-full" />
        <div className="flex items-center gap-2">
          <button
            onClick={clearConversation}
            className="text-[10px] text-white/60 hover:text-white/90 transition-colors"
            title="Clear conversation"
          >
            Clear
          </button>
          <button
            onClick={() => ipcRenderer.send('toggle-llm-chat', false)}
            className="text-white/60 hover:text-white/90 transition-colors text-xs"
            title="Close"
          >
            ✕
          </button>
        </div>
      </div>

      {/* Model selector */}
      <div className="px-3 py-2 border-b border-white/10 bg-white/5">
        <select
          value={selectedModel}
          onChange={(e) => setSelectedModel(e.target.value)}
          className="w-full bg-white/10 text-white text-xs px-2 py-1.5 rounded-lg border border-white/20 focus:border-white/40 focus:outline-none cursor-pointer"
        >
          {MODELS.map(model => (
            <option key={model.id} value={model.id} className="bg-gray-900">
              {model.name} ({model.provider})
            </option>
          ))}
        </select>
      </div>

      {/* Messages area */}
      <div className="flex-1 overflow-y-auto overflow-x-hidden custom-scrollbar p-3">
        {messages.length === 0 ? (
          <div className="flex items-center justify-center h-full text-white/40 text-sm">
            Start a conversation...
          </div>
        ) : (
          <div className="space-y-3">
            {messages.map((msg, idx) => (
              <ChatMessage key={idx} message={msg} />
            ))}
            <div ref={messagesEndRef} />
          </div>
        )}
      </div>

      {/* Input area */}
      <div className="p-3 border-t border-white/10 bg-white/5">
        <div className="flex gap-2">
          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyPress={handleKeyPress}
            placeholder="Type your message... (Enter to send, Shift+Enter for new line)"
            className="flex-1 bg-white/10 text-white text-sm px-3 py-2 rounded-lg border border-white/20 focus:border-white/40 focus:outline-none resize-none"
            rows="2"
            disabled={isLoading}
          />
          {isLoading ? (
            <button
              onClick={stopGeneration}
              className="px-4 py-2 bg-red-600/80 hover:bg-red-600 text-white text-xs rounded-lg transition-colors font-medium"
            >
              Stop
            </button>
          ) : (
            <button
              onClick={sendMessage}
              disabled={!input.trim()}
              className="px-4 py-2 bg-blue-600/80 hover:bg-blue-600 disabled:bg-white/10 disabled:cursor-not-allowed text-white text-xs rounded-lg transition-colors font-medium"
            >
              Send
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

  return (
    <div className={`flex ${isUser ? 'justify-end' : 'justify-start'}`}>
      <div
        className={`max-w-[85%] rounded-lg px-3 py-2 ${
          isUser
            ? 'bg-blue-600/80 text-white'
            : isError
            ? 'bg-red-900/40 text-red-200 border border-red-500/30'
            : 'bg-white/10 text-white border border-white/20'
        }`}
      >
        <div className="text-xs opacity-60 mb-1">
          {displayName}
          {message.model && !isUser && (
            <span className="ml-1 opacity-50">({message.model})</span>
          )}
        </div>
        <div className="text-sm whitespace-pre-wrap break-words">
          {message.content}
          {message.isStreaming && (
            <span className="inline-block w-2 h-4 ml-1 bg-white/60 animate-pulse" />
          )}
        </div>
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

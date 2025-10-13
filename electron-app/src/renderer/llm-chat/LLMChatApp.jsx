import React, { useState, useEffect, useRef, useCallback } from 'react'
import { createRoot } from 'react-dom/client'
import '@/styles.css'

const { ipcRenderer } = window.require('electron')

// Helper function to extract time from user message and convert to 24-hour format
const extractTimeFromMessage = (message) => {
  if (!message) return null

  // Patterns to match various time formats
  // Match: "6pm", "6 pm", "6:00pm", "6:00 pm", "18:00", etc.
  const timePatterns = [
    /(\d{1,2}):?(\d{2})?\s*(am|pm)/gi,  // 6pm, 6:00pm, 6 pm, 6:00 pm
    /(\d{1,2}):(\d{2})/g                 // 18:00, 6:00 (24-hour)
  ]

  for (const pattern of timePatterns) {
    const matches = message.match(pattern)
    if (matches && matches.length > 0) {
      const timeStr = matches[matches.length - 1] // Get last match (most relevant)
      console.log('🕐 [Time Parser] Found time in message:', timeStr)

      // Parse the time
      const ampmMatch = timeStr.match(/(\d{1,2}):?(\d{2})?\s*(am|pm)/i)
      if (ampmMatch) {
        let hour = parseInt(ampmMatch[1])
        const minute = ampmMatch[2] ? parseInt(ampmMatch[2]) : 0
        const ampm = ampmMatch[3].toLowerCase()

        // Convert to 24-hour
        if (ampm === 'pm' && hour !== 12) {
          hour += 12
        } else if (ampm === 'am' && hour === 12) {
          hour = 0
        }

        console.log(`   Converted to 24-hour: ${hour}:${minute.toString().padStart(2, '0')}`)
        return { hour, minute }
      }

      // Try 24-hour format
      const timeMatch = timeStr.match(/(\d{1,2}):(\d{2})/)
      if (timeMatch) {
        const hour = parseInt(timeMatch[1])
        const minute = parseInt(timeMatch[2])
        console.log(`   Already 24-hour: ${hour}:${minute.toString().padStart(2, '0')}`)
        return { hour, minute }
      }
    }
  }

  return null
}

// Helper function to correct time in datetime string based on user's intent
const correctTimeInDatetime = (datetimeStr, userMessage) => {
  if (!datetimeStr || !userMessage) return datetimeStr

  try {
    const extractedTime = extractTimeFromMessage(userMessage)
    if (!extractedTime) {
      console.log('⚠️ [Time Correction] No time found in user message, returning as-is')
      return datetimeStr
    }

    // Parse the datetime string
    const match = datetimeStr.match(/^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2}):(\d{2})(.*)$/)
    if (!match) {
      console.log('⚠️ [Time Correction] Could not parse datetime string:', datetimeStr)
      return datetimeStr
    }

    const [, date, currentHour, currentMinute, currentSecond, timezone] = match
    const currentHourInt = parseInt(currentHour)

    // Check if the hour matches what the user requested
    if (currentHourInt !== extractedTime.hour) {
      console.log(`🔧 [Time Correction] MISMATCH DETECTED!`)
      console.log(`   User requested: ${extractedTime.hour}:${extractedTime.minute.toString().padStart(2, '0')}`)
      console.log(`   LLM generated: ${currentHour}:${currentMinute}`)
      console.log(`   CORRECTING to user's requested time...`)

      const correctedDatetime = `${date}T${extractedTime.hour.toString().padStart(2, '0')}:${extractedTime.minute.toString().padStart(2, '0')}:${currentSecond}${timezone}`
      console.log(`   ✅ Corrected datetime: ${correctedDatetime}`)
      return correctedDatetime
    }

    console.log('✓ [Time Correction] LLM generated correct time, no correction needed')
    return datetimeStr

  } catch (error) {
    console.error('❌ [Time Correction] Error:', error)
    return datetimeStr
  }
}

// Helper function to add user's timezone offset to datetime string
const addTimezoneOffset = (datetimeStr) => {
  if (!datetimeStr || typeof datetimeStr !== 'string') return datetimeStr

  try {
    // If it already has a timezone offset, return as-is
    if (datetimeStr.includes('+') || datetimeStr.endsWith('Z') || /[+-]\d{2}:\d{2}$/.test(datetimeStr)) {
      console.log('✓ [Timezone] Already has offset:', datetimeStr)
      return datetimeStr
    }

    // Get user's current timezone offset
    const now = new Date()
    const timezoneOffset = -now.getTimezoneOffset() / 60
    const timezoneOffsetStr = timezoneOffset >= 0
      ? `+${String(timezoneOffset).padStart(2, '0')}:00`
      : `-${String(Math.abs(timezoneOffset)).padStart(2, '0')}:00`

    // Check if it's a date-only format (YYYY-MM-DD)
    if (/^\d{4}-\d{2}-\d{2}$/.test(datetimeStr)) {
      // Add time component for date-only strings
      const withTimezone = `${datetimeStr}T00:00:00${timezoneOffsetStr}`
      console.log(`🕐 [Timezone] Date-only, added time and offset: ${datetimeStr} → ${withTimezone}`)
      return withTimezone
    }

    // For datetime strings, ensure 'T' separator exists
    if (!datetimeStr.includes('T')) {
      // Replace any incorrect separator with 'T'
      datetimeStr = datetimeStr.replace(/(\d{4}-\d{2}-\d{2})[\s-](\d{2}:\d{2})/, '$1T$2')
    }

    // Ensure seconds are present
    if (/T\d{2}:\d{2}$/.test(datetimeStr)) {
      datetimeStr += ':00'
    }

    // Append timezone offset
    const withTimezone = `${datetimeStr}${timezoneOffsetStr}`
    console.log(`🕐 [Timezone] Added offset: ${datetimeStr} → ${withTimezone}`)

    return withTimezone
  } catch (error) {
    console.error('❌ [Timezone] Error adding offset:', error)
    return datetimeStr
  }
}

// Helper to get ISO-like local date string (YYYY-MM-DD) in user's timezone
const getLocalDateString = (date) => {
  const d = date instanceof Date ? new Date(date.getTime()) : new Date(date)
  const localDate = new Date(d.getTime() - d.getTimezoneOffset() * 60000)
  return localDate.toISOString().split('T')[0]
}

// Helper to build consistent date/time context for prompts
const getCurrentDateTimeContext = () => {
  const now = new Date()
  const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'
  const offsetMinutes = now.getTimezoneOffset()
  const absMinutes = Math.abs(offsetMinutes)
  const sign = offsetMinutes <= 0 ? '+' : '-'
  const offsetHours = String(Math.floor(absMinutes / 60)).padStart(2, '0')
  const offsetMins = String(absMinutes % 60).padStart(2, '0')
  const timezoneOffset = `${sign}${offsetHours}:${offsetMins}`
  const localDate = getLocalDateString(now)
  const localTime24 = now.toLocaleTimeString('en-GB', {
    hour12: false,
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit'
  })

  return {
    now,
    timezone,
    timezoneOffsetMinutes: offsetMinutes,
    timezoneOffset,
    localDate,
    localTime24
  }
}

const getRelativeLocalDateString = (daysOffset) => {
  const now = new Date()
  now.setDate(now.getDate() + daysOffset)
  return getLocalDateString(now)
}

// Helper function to preserve event duration when updating
const preserveEventDuration = (eventId, start, end, searchResults) => {
  if (!start || !end) return { start, end }

  try {
    // Check if start and end are the same (zero duration - likely LLM error)
    const startDate = new Date(start)
    const endDate = new Date(end)

    if (startDate.getTime() === endDate.getTime()) {
      console.log('⚠️ [Duration] Zero-duration event detected, attempting to preserve original duration')

      // Find the original event in search results
      if (!searchResults || searchResults.length === 0) {
        console.log('⚠️ [Duration] No search results available, defaulting to 1 hour')
        // Default to 1 hour duration
        const newEnd = new Date(startDate.getTime() + 60 * 60 * 1000)
        return {
          start,
          end: newEnd.toISOString().split('.')[0]  // Remove milliseconds
        }
      }

      // Find the event in search results
      let originalEvent = null
      for (const result of searchResults) {
        if (!result || !result.data) continue

        const eventsArray = Array.isArray(result.data)
          ? result.data
          : Array.isArray(result.data.events)
            ? result.data.events
            : []

        originalEvent = eventsArray.find(event => event.event_id === eventId)
        if (originalEvent) break
      }

      if (!originalEvent) {
        console.log('⚠️ [Duration] Original event not found in search results, defaulting to 1 hour')
        const newEnd = new Date(startDate.getTime() + 60 * 60 * 1000)
        return {
          start,
          end: newEnd.toISOString().split('.')[0]
        }
      }

      // Calculate original duration
      const origStart = new Date(originalEvent.start)
      const origEnd = new Date(originalEvent.end)
      const durationMs = origEnd.getTime() - origStart.getTime()

      console.log(`✅ [Duration] Found original event with duration: ${durationMs / 1000 / 60} minutes`)

      // Apply duration to new start time
      const newEnd = new Date(startDate.getTime() + durationMs)
      const newEndStr = newEnd.toISOString().split('.')[0]  // Remove milliseconds

      console.log(`✅ [Duration] Preserved duration: ${start} → ${newEndStr}`)

      return {
        start,
        end: newEndStr
      }
    }

    // If not zero-duration, return as-is
    console.log('✓ [Duration] Event has non-zero duration, no adjustment needed')
    return { start, end }

  } catch (error) {
    console.error('❌ [Duration] Error preserving duration:', error)
    return { start, end }
  }
}

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

// Available LLM models - Updated with all models from backend
const MODELS = [
  // OpenAI
  { id: 'gpt-5', name: 'GPT-5', provider: 'OpenAI' },
  { id: 'gpt-5-codex', name: 'GPT-5 Codex', provider: 'OpenAI' },
  { id: 'gpt-4.1', name: 'GPT-4.1', provider: 'OpenAI' },
  { id: 'gpt-4.1-mini', name: 'GPT-4.1 Mini', provider: 'OpenAI' },
  { id: 'gpt-4.1-nano', name: 'GPT-4.1 Nano', provider: 'OpenAI' },
  { id: 'gpt-4o', name: 'GPT-4o (Latest)', provider: 'OpenAI' },
  { id: 'gpt-4o-mini', name: 'GPT-4o Mini', provider: 'OpenAI' },
  { id: 'gpt-4', name: 'GPT-4', provider: 'OpenAI' },
  { id: 'gpt-4-turbo', name: 'GPT-4 Turbo', provider: 'OpenAI' },
  { id: 'o4-mini', name: 'O4 Mini (Reasoning)', provider: 'OpenAI' },
  { id: 'o1-preview', name: 'O1 Preview (Reasoning)', provider: 'OpenAI' },
  { id: 'o1-mini', name: 'O1 Mini (Reasoning)', provider: 'OpenAI' },
  { id: 'gpt-3.5-turbo', name: 'GPT-3.5 Turbo', provider: 'OpenAI' },

  // Anthropic
  { id: 'claude-3-opus', name: 'Claude 3 Opus', provider: 'Anthropic' },
  { id: 'claude-3-sonnet', name: 'Claude 3 Sonnet', provider: 'Anthropic' },
  { id: 'claude-3-haiku', name: 'Claude 3 Haiku', provider: 'Anthropic' },
  { id: 'claude-3.5-sonnet', name: 'Claude 3.5 Sonnet', provider: 'Anthropic' },
  { id: 'claude-sonnet-4.5', name: 'Claude Sonnet 4.5', provider: 'Anthropic' },

  // Google Gemini
  { id: 'gemini-2.5-pro', name: 'Gemini 2.5 Pro', provider: 'Google' },
  { id: 'gemini-2.5-flash', name: 'Gemini 2.5 Flash', provider: 'Google' },
  { id: 'gemini-2.0-flash', name: 'Gemini 2.0 Flash', provider: 'Google' },
  { id: 'gemini-pro', name: 'Gemini Pro', provider: 'Google' },
]

function LLMChatApp() {
  const [messages, setMessages] = useState([])
  const [input, setInput] = useState('')
  const [selectedModel, setSelectedModel] = useState('gpt-5') // Updated models list
  const [isLoading, setIsLoading] = useState(false)
  const [isHovered, setIsHovered] = useState(false)
  const messagesEndRef = useRef(null)
  const abortControllerRef = useRef(null)

  const [isVisible, setIsVisible] = useState(false)
  const [isWindowOpen, setIsWindowOpen] = useState(false)
  const [screenshots, setScreenshots] = useState([])
  const [uploadedFiles, setUploadedFiles] = useState([])
  const [visionEnabled, setVisionEnabled] = useState(false)

  // Tab state
  const [activeTab, setActiveTab] = useState('chat') // 'chat' or 'suggestions'
  const [suggestions, setSuggestions] = useState([])
  const [expandedSuggestion, setExpandedSuggestion] = useState(null)
  const [unreadCount, setUnreadCount] = useState(0)

  // Tooltip state
  const [hoveredButton, setHoveredButton] = useState(null)

  // Suggestion notification state
  const [suggestionNotification, setSuggestionNotification] = useState(null)

  // Force suggestion loading state
  const [isForcingSuggestion, setIsForcingSuggestion] = useState(false)

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

  // Execute search actions and continue conversation
  const executeSearchAndContinue = async (actionSteps, assistantMessageId, userMessageContent, depth = 0) => {
    // Prevent infinite recursion
    const MAX_DEPTH = 3
    if (depth >= MAX_DEPTH) {
      console.warn(`⚠️ [executeSearchAndContinue] Maximum recursion depth (${MAX_DEPTH}) reached, stopping`)
      setMessages(prev => prev.map(msg =>
        msg.id === assistantMessageId
          ? {
              ...msg,
              content: msg.content || 'I encountered too many nested searches. Please try rephrasing your request.',
              isStreaming: false
            }
          : msg
      ))
      return
    }

    try {
      console.log(`🔍 [executeSearchAndContinue] Executing search actions (depth ${depth}):`, actionSteps)

      // Get auth token
      const authToken = await ipcRenderer.invoke('get-auth-token')
      if (!authToken) {
        throw new Error('Not authenticated. Please log in to execute actions.')
      }

      // Execute search actions
      const response = await fetch('http://localhost:8000/api/actions/execute-direct', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${authToken}`
        },
        body: JSON.stringify({
          action_steps: actionSteps.map(step => ({
            action_type: step.action_type,
            action_params: step.action_params
          })),
          suggestion_id: null
        })
      })

      const data = await response.json()
      console.log('📥 [executeSearchAndContinue] Search results:', data)

      if (!response.ok) {
        throw new Error(data.detail || 'Failed to execute search')
      }

      // Log search results with timezone info
      if (data.results && data.results.length > 0) {
        data.results.forEach((result, idx) => {
          if (result.success && result.data && result.data.events) {
            console.log(`🔍 [TIMEZONE DEBUG] Search results for query "${result.data.query}":`)
            result.data.events.forEach((event, eventIdx) => {
              console.log(`   Event ${eventIdx + 1}: "${event.title}"`)
              console.log(`      Start: ${event.start} ← Time from Google Calendar`)
              console.log(`      End: ${event.end} ← Time from Google Calendar`)
              console.log(`      Event ID: ${event.event_id}`)
            })
          }
        })
      }

      // Format tool results for GPT-4
      // Build tool response messages
      const toolMessages = actionSteps.map((step, idx) => {
        const result = data.results[idx]
        return {
          role: 'tool',
          tool_call_id: step.tool_call_id,
          name: step.action_type,
          content: JSON.stringify(result.data)
        }
      })

      console.log('🔧 [executeSearchAndContinue] Tool messages being sent to LLM:', toolMessages)

      // Update the assistant message to show search results
      setMessages(prev => prev.map(msg =>
        msg.id === assistantMessageId
          ? {
              ...msg,
              content: msg.content || 'Searching calendar...',
              isStreaming: false,
              searchResults: data.results
            }
          : msg
      ))

      // Get current conversation history
      const currentMessages = messages.filter(m => m.role === 'user' || m.role === 'assistant')

      // Add system message with date/time context
      const {
        now: continuationNow,
        timezone: continuationTimezone,
        timezoneOffset: continuationOffset,
        localDate: continuationDate,
        localTime24: continuationTime
      } = getCurrentDateTimeContext()
      const continuationTomorrow = getRelativeLocalDateString(1)
      const continuationYesterday = getRelativeLocalDateString(-1)

      const systemMessage = {
        role: 'system',
        content: `You are a helpful AI assistant with access to Google Calendar and Gmail tools.

OUTPUT FORMATTING:
- Use rich markdown formatting for better readability
- Format lists with clear bullet points or numbered items
- Use **bold** for important information like event titles
- Use tables when showing multiple events with similar data
- Keep responses concise but informative
- Do NOT use emojis in responses

⚠️ TIME FORMAT - SUPER SIMPLE ⚠️
Current date: ${continuationDate}
Current time: ${continuationTime}
User timezone: ${continuationTimezone} (UTC${continuationOffset})

🕐 Convert times to 24-hour format (military time):
- 6pm → 18:00
- 9pm → 21:00
- 2pm → 14:00
- 10am → 10:00

✅ CORRECT FORMAT: "${continuationDate}T<HOUR>:00:00"
Where <HOUR> is 24-hour format (00-23)

📅 DATE HANDLING:
- "today" → ${continuationDate}
- "tomorrow" → ${continuationTomorrow}
- "yesterday" → ${continuationYesterday}

⚠️ CRITICAL: When updating event dates/times, you MUST update BOTH start AND end times!
If changing the date, update the date in BOTH start and end.
If changing the time, update BOTH start and end times, keeping the same duration.

🔴 DO NOT add timezone info (no Z, no +00:00, no -07:00) - just the time!`
      }

      // Build the assistant message with tool_calls for OpenAI format
      const assistantToolCallMessage = {
        role: 'assistant',
        content: null,
        tool_calls: actionSteps.map(step => ({
          id: step.tool_call_id,
          type: 'function',
          function: {
            name: step.action_type,
            arguments: JSON.stringify(step.action_params)
          }
        }))
      }

      // Build messages array for continuation
      const continuationMessages = [
        systemMessage,
        ...currentMessages.slice(0, -1).map(m => ({  // Exclude the last assistant message (it's being replaced with tool call version)
          role: m.role,
          content: m.content
        })),
        assistantToolCallMessage,  // Add assistant message with tool_calls
        ...toolMessages  // Add tool results
      ]

      console.log('📤 [executeSearchAndContinue] Sending continuation request with messages:', continuationMessages.length)

      // Create new assistant message for continuation
      const continuationMessageId = Date.now() + 1
      setMessages(prev => [...prev, {
        id: continuationMessageId,
        role: 'assistant',
        content: '',
        timestamp: new Date().toISOString(),
        isStreaming: true,
        model: selectedModel
      }])

      // Continue conversation with GPT-4
      const continuationResponse = await fetch('http://localhost:8000/api/chat/stream', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: selectedModel,
          messages: continuationMessages,
          stream: true
        }),
        signal: abortControllerRef.current?.signal
      })

      if (!continuationResponse.ok) {
        throw new Error(`HTTP error! status: ${continuationResponse.status}`)
      }

      // Stream the continuation response
      const reader = continuationResponse.body.getReader()
      const decoder = new TextDecoder()
      let accumulatedContent = ''
      let continuationToolCalls = []

      while (true) {
        const { done, value } = await reader.read()
        if (done) break

        const chunk = decoder.decode(value)
        const lines = chunk.split('\n')

        for (const line of lines) {
          if (line.startsWith('data: ')) {
            const data = line.slice(6)
            if (data === '[DONE]') break

            try {
              const parsed = JSON.parse(data)

              // Handle text content
              if (parsed.content) {
                accumulatedContent += parsed.content
                setMessages(prev => prev.map(msg =>
                  msg.id === continuationMessageId
                    ? { ...msg, content: accumulatedContent }
                    : msg
                ))
              }

              // Handle tool calls in continuation
              if (parsed.tool_call) {
                const existingIndex = continuationToolCalls.findIndex(tc => tc.id === parsed.tool_call.id)
                if (existingIndex >= 0) {
                  if (parsed.tool_call.arguments) {
                    continuationToolCalls[existingIndex].arguments += parsed.tool_call.arguments
                  }
                } else {
                  continuationToolCalls.push({
                    id: parsed.tool_call.id,
                    name: parsed.tool_call.name || '',
                    arguments: parsed.tool_call.arguments || ''
                  })
                }
              }
            } catch (e) {
              console.error('Error parsing continuation SSE:', e)
            }
          }
        }
      }

      // Handle any tool calls from continuation (e.g., calendar_update_event)
      if (continuationToolCalls.length > 0) {
        console.log('🔧 [executeSearchAndContinue] Continuation returned tool calls:', continuationToolCalls)

        // Use the passed user message for time correction
        console.log('📝 [executeSearchAndContinue] Original user message:', userMessageContent)

        // Convert to action steps - handle ALL tool types
        const continuationActionSteps = continuationToolCalls.map(tc => {
          if (!tc.arguments || tc.arguments.trim() === '') return null

          const args = JSON.parse(tc.arguments)

          if (tc.name === 'calendar_update_event') {
            // For updates, preserve event duration if LLM creates zero-duration event
            // First, preserve duration (before adding timezone)
            const { start: preservedStart, end: preservedEnd } = preserveEventDuration(
              args.event_id,
              args.start,
              args.end,
              data.results  // searchResults from the executed search
            )

            // Then add timezone offset
            const startWithTimezone = addTimezoneOffset(preservedStart)
            const endWithTimezone = preservedEnd ? addTimezoneOffset(preservedEnd) : undefined

            return {
              tool_call_id: tc.id,
              action_type: 'calendar_update_event',
              action_params: {
                event_id: args.event_id,
                title: args.title,
                start: startWithTimezone,
                end: endWithTimezone,
                description: args.description,
                location: args.location
              }
            }
          } else if (tc.name === 'calendar_create_event') {
            // Apply time correction and add timezone offset for CREATE operations
            const correctedStart = addTimezoneOffset(correctTimeInDatetime(args.start, userMessageContent))
            const correctedEnd = args.end ? addTimezoneOffset(correctTimeInDatetime(args.end, userMessageContent)) : undefined

            return {
              tool_call_id: tc.id,
              action_type: 'calendar_create_event',
              action_params: {
                title: args.title,
                start: correctedStart,
                end: correctedEnd,
                description: args.description,
                location: args.location
              }
            }
          } else if (tc.name === 'calendar_list_upcoming') {
            // List upcoming events
            return {
              tool_call_id: tc.id,
              action_type: 'calendar_list_upcoming',
              action_params: {
                days: args.days || 7,
                max_results: args.max_results || 10
              }
            }
          } else if (tc.name === 'calendar_search_events') {
            // Search for events
            return {
              tool_call_id: tc.id,
              action_type: 'calendar_search_events',
              action_params: {
                query: args.query,
                start_date: addTimezoneOffset(args.start_date),
                end_date: addTimezoneOffset(args.end_date),
                max_results: args.max_results || 10
              }
            }
          } else {
            console.warn(`⚠️ [executeSearchAndContinue] Unhandled tool type: ${tc.name}`)
            return null
          }
        }).filter(Boolean)

        // Check if ALL actions are search-only operations
        const searchOnlyTypes = ['calendar_search_events', 'calendar_list_upcoming']
        const allSearchOnly = continuationActionSteps.every(step =>
          searchOnlyTypes.includes(step.action_type)
        )

        if (continuationActionSteps.length > 0) {
          if (allSearchOnly) {
            // Auto-execute search operations and recurse
            console.log('🔍 [executeSearchAndContinue] Continuation returned search-only operations, auto-executing...')

            // Execute the search and continue again (with recursion guard)
            await executeSearchAndContinue(continuationActionSteps, continuationMessageId, userMessageContent, depth + 1)
          } else {
            // Show non-search actions as actionable for user confirmation
            setMessages(prev => prev.map(msg =>
              msg.id === continuationMessageId
                ? {
                    ...msg,
                    isStreaming: false,
                    isActionable: true,
                    action_steps: continuationActionSteps,
                    execution_mode: 'direct',
                    original_user_message: userMessageContent  // Store for later time correction
                  }
                : msg
            ))
          }
        } else {
          setMessages(prev => prev.map(msg =>
            msg.id === continuationMessageId
              ? { ...msg, isStreaming: false }
              : msg
          ))
        }
      } else {
        // No tool calls, just mark as complete
        setMessages(prev => prev.map(msg =>
          msg.id === continuationMessageId
            ? { ...msg, isStreaming: false }
            : msg
        ))
      }

      setIsLoading(false)

    } catch (error) {
      console.error('❌ [executeSearchAndContinue] Error:', error)
      setMessages(prev => prev.map(msg =>
        msg.id === assistantMessageId
          ? {
              ...msg,
              content: `Error during search: ${error.message}`,
              isError: true,
              isStreaming: false
            }
          : msg
      ))
      setIsLoading(false)
    }
  }

  // Send message to LLM
  // Detect actions from user message
  const detectAndShowActions = async (userMessage) => {
    try {
      console.log('🔍 Detecting actions from message:', userMessage)

      const authToken = await ipcRenderer.invoke('get-auth-token')
      if (!authToken) {
        console.warn('⚠️ No auth token available for action detection')
        return
      }

      const response = await fetch('http://localhost:8000/api/chat/detect-actions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${authToken}`
        },
        body: JSON.stringify({
          message: userMessage,
          context: {
            app_name: 'LLM Chat',
            window_title: 'Squire LLM Chat'
          }
        })
      })

      if (!response.ok) {
        console.error('❌ Action detection failed:', response.status)
        return
      }

      const data = await response.json()
      console.log('📥 Action detection result:', data)

      if (data.has_actions && data.action_steps && data.action_steps.length > 0) {
        // Add actionable message to chat
        const actionMessage = {
          id: Date.now(),
          role: 'action',
          content: data.message,
          timestamp: new Date().toISOString(),
          execution_mode: 'direct',
          action_steps: data.action_steps,
          isActionable: true
        }

        setMessages(prev => [...prev, actionMessage])
        console.log('✅ Added actionable message to chat')
      }

    } catch (error) {
      console.error('❌ Error detecting actions:', error)
    }
  }

  const sendMessage = async () => {
    if (!input.trim() || isLoading) return

    // Build message content - multimodal format for images
    let messageContent
    const hasImages = uploadedFiles.some(f => f.type.startsWith('image/')) || screenshots.length > 0

    if (hasImages) {
      // Use array format for multimodal content (images + text)
      messageContent = []

      // Add text part
      let textContent = input.trim()

      // Add non-image file contents to text
      const textFiles = uploadedFiles.filter(f => !f.type.startsWith('image/'))
      if (textFiles.length > 0) {
        textContent += '\n\n[Attached Files]:\n'
        textFiles.forEach(file => {
          textContent += `\n- File: ${file.name}\nContent:\n\`\`\`\n${file.content}\n\`\`\`\n`
        })
      }

      messageContent.push({
        type: 'text',
        text: textContent
      })

      // Add screenshot images
      screenshots.forEach(screenshot => {
        messageContent.push({
          type: 'image_url',
          image_url: {
            url: screenshot.dataUrl
          }
        })
      })

      // Add uploaded images
      uploadedFiles.filter(f => f.type.startsWith('image/')).forEach(file => {
        messageContent.push({
          type: 'image_url',
          image_url: {
            url: file.content
          }
        })
      })
    } else {
      // Plain text content
      messageContent = input.trim()

      // Add file contents to the message
      if (uploadedFiles.length > 0) {
        messageContent += '\n\n[Attached Files]:\n'
        uploadedFiles.forEach(file => {
          messageContent += `\n- File: ${file.name}\nContent:\n\`\`\`\n${file.content}\n\`\`\`\n`
        })
      }
    }

    const userMessage = {
      role: 'user',
      content: messageContent,
      timestamp: new Date().toISOString(),
      model: selectedModel
    }

    setMessages(prev => [...prev, userMessage])
    setInput('')
    setUploadedFiles([]) // Clear files after sending
    setScreenshots([]) // Clear screenshots after sending
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

      // Add system message with current date and timezone context
      const { now: currentDate, timezone, timezoneOffset, localDate, localTime24 } = getCurrentDateTimeContext()
      const tomorrowLocalDate = getRelativeLocalDateString(1)
      const yesterdayLocalDate = getRelativeLocalDateString(-1)

      const systemMessage = {
        role: 'system',
        content: `You are a helpful AI assistant with access to Google Calendar and Gmail tools.

OUTPUT FORMATTING:
- Use rich markdown formatting for better readability
- Format lists with clear bullet points or numbered items
- Use **bold** for important information like event titles
- Use tables when showing multiple events with similar data
- Keep responses concise but informative
- Do NOT use emojis in responses

⚠️ TIME FORMAT - SUPER SIMPLE ⚠️
Current date: ${localDate}
Current time: ${localTime24}
User timezone: ${timezone} (UTC${timezoneOffset})

🕐 Convert times to 24-hour format (military time):
- 6pm → 18:00
- 9pm → 21:00
- 2pm → 14:00
- 10am → 10:00

✅ CORRECT FORMAT: "${localDate}T<HOUR>:00:00"
Where <HOUR> is 24-hour format (00-23)

📋 EXAMPLES:
User: "meeting at 6pm" → start="${localDate}T18:00:00"
User: "event at 2pm" → start="${localDate}T14:00:00"
User: "call at 10am" → start="${localDate}T10:00:00"

🔴 DO NOT add timezone info (no Z, no +00:00, no -07:00) - just the time!

📅 DATE HANDLING:
- "today" → ${localDate}
- "tomorrow" → ${tomorrowLocalDate}
- "yesterday" → ${yesterdayLocalDate}

⚠️ CRITICAL: When updating event dates/times, you MUST update BOTH start AND end times!

EDITING CALENDAR EVENTS:
To edit/update an event, you MUST follow this two-step process:
1. First, use calendar_search_events to find the event and get its event_id
2. Then, use calendar_update_event with the event_id to make changes

Example workflows:

1. Moving event to different time (same day):
User: "Move my climbing event to 3pm"
→ calendar_update_event(event_id="...", start="${localDate}T15:00:00", end="${localDate}T17:00:00")
Note: Update BOTH start and end times, keeping the same duration

2. Moving event to different day:
User: "Move my climbing event from tomorrow to today"
Current event: start="2025-10-12T10:00:00", end="2025-10-12T12:00:00"
→ calendar_update_event(event_id="...", start="${localDate}T10:00:00", end="${localDate}T12:00:00")
⚠️ IMPORTANT: Change the date in BOTH start AND end times to "${localDate}"

3. Moving event to different day AND time:
User: "Move my meeting from tomorrow to today at 2pm"
→ calendar_update_event(event_id="...", start="${localDate}T14:00:00", end="${localDate}T16:00:00")
Update date AND time in BOTH fields

If search returns multiple events, ask the user to clarify which one to update.
If search returns zero events, tell the user no matching events were found.`
      }

      const requestBody = {
        model: selectedModel,
        messages: [systemMessage, ...messages, userMessage].map(m => ({
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
      let toolCalls = [] // Track tool calls from GPT-4

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

              // Handle text content
              if (parsed.content) {
                accumulatedContent += parsed.content

                // Update the streaming message
                setMessages(prev => prev.map(msg =>
                  msg.id === assistantMessageId
                    ? { ...msg, content: accumulatedContent }
                    : msg
                ))
              }

              // Handle tool calls from GPT-4
              if (parsed.tool_call) {
                console.log('🔧 Received tool call:', parsed.tool_call)

                // Find existing tool call or create new one
                const existingIndex = toolCalls.findIndex(tc => tc.id === parsed.tool_call.id)
                if (existingIndex >= 0) {
                  // Update existing tool call (accumulate arguments)
                  if (parsed.tool_call.arguments) {
                    toolCalls[existingIndex].arguments += parsed.tool_call.arguments
                  }
                } else {
                  // Add new tool call
                  toolCalls.push({
                    id: parsed.tool_call.id,
                    name: parsed.tool_call.name || '',
                    arguments: parsed.tool_call.arguments || ''
                  })
                }
              }
            } catch (e) {
              console.error('Error parsing SSE data:', e)
            }
          }
        }
      }

      // Convert tool calls to action_steps format if present
      let finalMessage = {
        isStreaming: false
      }

      if (toolCalls.length > 0) {
        console.log('✅ Stream complete with tool calls:', toolCalls)

        try {
          // Convert tool calls to action_steps format
          const actionSteps = toolCalls.map(tc => {
            // Skip tool calls with empty or invalid arguments
            if (!tc.arguments || tc.arguments.trim() === '') {
              console.warn('⚠️ Skipping tool call with empty arguments:', tc)
              return null
            }

            console.log('🔧 Parsing tool call arguments:', tc.name, tc.arguments)
            const args = JSON.parse(tc.arguments)

            if (tc.name === 'calendar_create_event') {
              // Apply time correction and add timezone offset
              const correctedStart = addTimezoneOffset(correctTimeInDatetime(args.start, userMessage.content))
              const correctedEnd = args.end ? addTimezoneOffset(correctTimeInDatetime(args.end, userMessage.content)) : undefined

              return {
                tool_call_id: tc.id,
                action_type: 'calendar_create_event',
                action_params: {
                  title: args.title,
                  start: correctedStart,
                  end: correctedEnd,
                  description: args.description,
                  location: args.location
                }
              }
            } else if (tc.name === 'calendar_search_events') {
              // Add timezone offset to search dates
              return {
                tool_call_id: tc.id,
                action_type: 'calendar_search_events',
                action_params: {
                  query: args.query,
                  start_date: addTimezoneOffset(args.start_date),
                  end_date: addTimezoneOffset(args.end_date),
                  max_results: args.max_results
                }
              }
            } else if (tc.name === 'calendar_update_event') {
              // For updates, preserve event duration if LLM creates zero-duration event
              // Note: searchResults may not be available here (defaults to 1 hour)
              const { start: preservedStart, end: preservedEnd } = preserveEventDuration(
                args.event_id,
                args.start,
                args.end,
                []  // No search results in initial processing
              )

              // Then add timezone offset
              const startWithTimezone = addTimezoneOffset(preservedStart)
              const endWithTimezone = preservedEnd ? addTimezoneOffset(preservedEnd) : undefined

              return {
                tool_call_id: tc.id,
                action_type: 'calendar_update_event',
                action_params: {
                  event_id: args.event_id,
                  title: args.title,
                  start: startWithTimezone,
                  end: endWithTimezone,
                  description: args.description,
                  location: args.location
                }
              }
            } else if (tc.name === 'gmail_create_draft') {
              return {
                tool_call_id: tc.id,  // Preserve tool call ID
                action_type: 'gmail_create_draft',
                action_params: {
                  to: args.to,
                  subject: args.subject,
                  body: args.body
                }
              }
            } else if (tc.name === 'calendar_list_upcoming') {
              return {
                tool_call_id: tc.id,
                action_type: 'calendar_list_upcoming',
                action_params: {
                  days: args.days || 7,
                  max_results: args.max_results || 10
                }
              }
            } else if (tc.name === 'calendar_create_recurring') {
              // Apply time correction and add timezone offset
              const correctedStart = addTimezoneOffset(correctTimeInDatetime(args.start, userMessage.content))
              const correctedEnd = args.end ? addTimezoneOffset(correctTimeInDatetime(args.end, userMessage.content)) : undefined

              return {
                tool_call_id: tc.id,
                action_type: 'calendar_create_recurring',
                action_params: {
                  title: args.title,
                  start: correctedStart,
                  end: correctedEnd,
                  recurrence_rule: args.recurrence_rule,
                  description: args.description,
                  location: args.location
                }
              }
            } else if (tc.name === 'calendar_add_meet_link') {
              return {
                tool_call_id: tc.id,
                action_type: 'calendar_add_meet_link',
                action_params: {
                  event_id: args.event_id
                }
              }
            } else if (tc.name === 'calendar_set_reminders') {
              return {
                tool_call_id: tc.id,
                action_type: 'calendar_set_reminders',
                action_params: {
                  event_id: args.event_id,
                  reminders: args.reminders
                }
              }
            } else if (tc.name === 'calendar_add_attendees') {
              return {
                tool_call_id: tc.id,
                action_type: 'calendar_add_attendees',
                action_params: {
                  event_id: args.event_id,
                  attendees: args.attendees
                }
              }
            }
            return null
          }).filter(Boolean)

          if (actionSteps.length > 0) {
            console.log('📋 Converted to action steps:', actionSteps)

            // Check if any action is a "search" or "list" (information gathering) vs "action" (execution)
            const isQueryAction = (actionType) =>
              actionType.includes('search') ||
              actionType.includes('list_upcoming')

            const hasSearchOnly = actionSteps.every(step => isQueryAction(step.action_type))
            const hasSearch = actionSteps.some(step => isQueryAction(step.action_type))

            // If it's only search queries, auto-execute them and continue the conversation
            if (hasSearchOnly) {
              console.log('🔍 Search-only request detected, auto-executing and continuing conversation...')
              console.log('📝 [BEFORE CALL] userMessage:', userMessage)
              console.log('📝 [BEFORE CALL] userMessage.content:', userMessage.content)

              // Execute search immediately
              await executeSearchAndContinue(actionSteps, assistantMessageId, userMessage.content)
              return // Exit early, executeSearchAndContinue will handle the rest
            }

            // Otherwise, show as actionable for user confirmation
            finalMessage = {
              ...finalMessage,
              isActionable: true,
              action_steps: actionSteps,
              execution_mode: 'direct',
              original_user_message: userMessage.content  // Store for later time correction
            }
          }
        } catch (error) {
          console.error('❌ Error converting tool calls to actions:', error, 'Tool calls:', toolCalls)
        }
      }

      // Mark streaming as complete and add actions if present
      setMessages(prev => prev.map(msg =>
        msg.id === assistantMessageId
          ? { ...msg, ...finalMessage }
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

  // File handling - open file picker
  const handleAddFile = async () => {
    try {
      const result = await ipcRenderer.invoke('open-file-dialog')
      if (result && !result.canceled && result.filePaths && result.filePaths.length > 0) {
        const fs = require('fs')
        const path = require('path')

        const maxSize = 20 * 1024 * 1024 // 20MB limit

        for (const filePath of result.filePaths) {
          const stats = fs.statSync(filePath)

          if (stats.size > maxSize) {
            console.warn(`File ${path.basename(filePath)} is too large (${(stats.size / 1024 / 1024).toFixed(2)}MB). Max size is 20MB.`)
            continue
          }

          const fileData = {
            id: Date.now() + Math.random(),
            name: path.basename(filePath),
            size: stats.size,
            type: '', // Will be determined by extension
            content: null
          }

          // Read file content
          const ext = path.extname(filePath).toLowerCase()
          if (['.png', '.jpg', '.jpeg', '.gif', '.webp', '.bmp'].includes(ext)) {
            // Read as data URL for images
            const buffer = fs.readFileSync(filePath)
            const base64 = buffer.toString('base64')
            const mimeType = ext === '.jpg' ? 'jpeg' : ext.slice(1)
            fileData.content = `data:image/${mimeType};base64,${base64}`
            fileData.type = `image/${mimeType}`
          } else {
            // Read as text
            try {
              fileData.content = fs.readFileSync(filePath, 'utf-8')
              fileData.type = 'text/plain'
            } catch (e) {
              // If it fails to read as text, skip the file
              console.error(`Could not read file ${filePath} as text:`, e)
              continue
            }
          }

          setUploadedFiles(prev => [...prev, fileData])
        }
      }
    } catch (error) {
      console.error('Error opening file:', error)
    }
  }

  const removeFile = (id) => {
    setUploadedFiles(prev => prev.filter(f => f.id !== id))
  }

  // Toggle vision
  const toggleVision = () => {
    const newState = !visionEnabled
    setVisionEnabled(newState)
    ipcRenderer.send('toggle-global-vision', newState)
  }

  // Force suggestions
  const forceSuggestions = async () => {
    try {
      setIsForcingSuggestion(true)
      await ipcRenderer.invoke('force-suggestion-request')
      // Reset after a delay to show completion
      setTimeout(() => {
        setIsForcingSuggestion(false)
      }, 1000)
    } catch (error) {
      console.error('Error forcing suggestions:', error)
      setIsForcingSuggestion(false)
    }
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
      className="w-full h-full flex flex-col relative"
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
        overflow: 'hidden',
        zIndex: 9999,
        pointerEvents: 'auto'
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
              disabled={isForcingSuggestion}
              style={{
                borderRadius: '20px',
                transition: 'all 130ms ease-out',
                cursor: isForcingSuggestion ? 'not-allowed' : 'pointer'
              }}
              className={`w-7 h-7 flex items-center justify-center ${
                isForcingSuggestion
                  ? 'text-blue-400 bg-blue-500/10'
                  : 'text-white/50 hover:text-blue-400 hover:bg-blue-500/10'
              }`}
            >
              {isForcingSuggestion ? (
                <svg className="animate-spin" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <circle cx="12" cy="12" r="10" opacity="0.25"></circle>
                  <path d="M12 2 A10 10 0 0 1 22 12" opacity="0.75"></path>
                </svg>
              ) : (
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z"></path>
                </svg>
              )}
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
                <path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z"></path>
                <circle cx="12" cy="12" r="3"></circle>
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
          <div
            className="flex-1 overflow-y-auto overflow-x-hidden custom-scrollbar px-4 pt-8 pb-4"
            style={{
              background: 'rgba(15, 23, 42, 0.3)'
            }}
          >
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
          <div className="px-3 py-3 border-t" style={{
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
                      className="w-14 h-14 object-cover rounded border border-white/10"
                    />
                    <button
                      onClick={() => removeScreenshot(screenshot.id)}
                      className="absolute -top-1 -right-1 w-4 h-4 bg-red-500 hover:bg-red-600 text-white rounded-full text-xs opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center"
                    >
                      <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3">
                        <line x1="18" y1="6" x2="6" y2="18"></line>
                        <line x1="6" y1="6" x2="18" y2="18"></line>
                      </svg>
                    </button>
                  </div>
                ))}
              </div>
            )}

            {/* Uploaded file previews */}
            {uploadedFiles.length > 0 && (
              <div className="mb-3 flex gap-2 flex-wrap">
                {uploadedFiles.map(file => (
                  <div key={file.id} className="relative group">
                    <div className="w-auto px-3 py-2 rounded border border-blue-500/30 bg-blue-500/10 flex items-center gap-2">
                      {file.type.startsWith('image/') ? (
                        <img
                          src={file.content}
                          alt={file.name}
                          className="w-8 h-8 object-cover rounded"
                        />
                      ) : (
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="rgba(96, 165, 250, 0.8)" strokeWidth="2">
                          <path d="M13 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z"></path>
                          <polyline points="13 2 13 9 20 9"></polyline>
                        </svg>
                      )}
                      <div className="flex flex-col">
                        <span className="text-white/90 text-xs max-w-[120px] truncate">{file.name}</span>
                        <span className="text-white/40 text-[10px]">{(file.size / 1024).toFixed(1)}KB</span>
                      </div>
                    </div>
                    <button
                      onClick={() => removeFile(file.id)}
                      className="absolute -top-1 -right-1 w-4 h-4 bg-red-500 hover:bg-red-600 text-white rounded-full text-xs opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center"
                    >
                      <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3">
                        <line x1="18" y1="6" x2="6" y2="18"></line>
                        <line x1="6" y1="6" x2="18" y2="18"></line>
                      </svg>
                    </button>
                  </div>
                ))}
              </div>
            )}

            <div className="flex gap-2 items-center">
              <button
                onClick={handleAddFile}
                className="text-white/40 hover:text-white/90 transition-all flex items-center justify-center flex-shrink-0"
                style={{
                  fontSize: '11px',
                  width: '38px',
                  height: '38px',
                  borderRadius: '10px',
                  background: 'rgba(51, 65, 85, 0.3)',
                  border: '1px solid rgba(71, 85, 105, 0.25)'
                }}
                title="Add file"
              >
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <line x1="12" y1="5" x2="12" y2="19"></line>
                  <line x1="5" y1="12" x2="19" y2="12"></line>
                </svg>
              </button>
              <div className="flex-1 min-w-0">
                <input
                  type="text"
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  onKeyPress={handleKeyPress}
                  placeholder="Type to ask... ⌘↵"
                  className="w-full text-white text-sm py-2 focus:outline-none focus:ring-1 focus:ring-blue-500 placeholder-white/40 transition-all"
                  style={{
                    background: 'rgba(51, 65, 85, 0.3)',
                    border: '1px solid rgba(71, 85, 105, 0.25)',
                    borderRadius: '10px',
                    height: '38px',
                    fontWeight: '500',
                    paddingLeft: '14px',
                    paddingRight: '14px'
                  }}
                  disabled={isLoading}
                />
                <div className="flex items-center justify-between mt-1.5 gap-2 flex-wrap">
                  <button
                    onClick={captureScreenshot}
                    className="text-white/40 hover:text-white/90 transition-all flex items-center flex-shrink-0"
                    style={{ fontSize: '11px' }}
                    title="Capture screenshot"
                  >
                    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"></path>
                      <circle cx="12" cy="13" r="4"></circle>
                    </svg>
                    <span style={{ marginLeft: '5px' }}>Screenshot</span>
                  </button>
                  <select
                    value={selectedModel}
                    onChange={(e) => setSelectedModel(e.target.value)}
                    className="text-white/70 px-2 py-1 rounded focus:outline-none focus:ring-1 focus:ring-blue-500/50 cursor-pointer transition-all"
                    style={{
                      background: 'rgba(51, 65, 85, 0.3)',
                      border: '1px solid rgba(71, 85, 105, 0.25)',
                      borderRadius: '6px',
                      fontSize: '9px'
                    }}
                  >
                    {MODELS.map(model => (
                      <option key={model.id} value={model.id} style={{ background: 'rgba(30, 41, 59, 1)', fontSize: '11px' }}>
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
                    borderRadius: '8px',
                    transition: 'all 130ms ease-out',
                    boxShadow: '0 2px 8px rgba(239, 68, 68, 0.2)',
                    height: '38px',
                    minWidth: '70px'
                  }}
                  className="px-3 py-0 bg-red-500 hover:bg-red-600 text-white text-xs font-semibold flex items-center justify-center gap-2 flex-shrink-0"
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
                    borderRadius: '8px',
                    transition: 'all 130ms ease-out',
                    boxShadow: !input.trim() ? 'none' : '0 2px 8px rgba(59, 130, 246, 0.25)',
                    height: '38px',
                    minWidth: '70px'
                  }}
                  className="px-3 py-0 bg-blue-500 hover:bg-blue-600 text-white text-xs font-semibold disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:bg-blue-500 flex items-center justify-center gap-2 flex-shrink-0"
                >
                  <span>Send</span>
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
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
  const [isExecuting, setIsExecuting] = useState(false)
  const [executionResult, setExecutionResult] = useState(null)
  const [executionError, setExecutionError] = useState(null)

  const formatTime = (timestamp) => {
    const date = new Date(timestamp)
    return date.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })
  }

  const handleClick = (e) => {
    e.preventDefault()
    e.stopPropagation()
    onToggle()
  }

  // Check if this suggestion is actionable
  const isActionable = suggestion.execution_mode === 'direct' && suggestion.action_steps && suggestion.action_steps.length > 0

  // Execute action
  const executeAction = async () => {
    if (!isActionable || isExecuting) return

    setIsExecuting(true)
    setExecutionError(null)
    setExecutionResult(null)

    try {
      // Convert ID to string to match backend validation
      const suggestionIdString = suggestion.id ? String(suggestion.id) : null
      console.log('🔄 [Execute] Converting suggestion_id:', suggestion.id, '→', suggestionIdString, typeof suggestionIdString)

      const payload = {
        action_steps: suggestion.action_steps,
        suggestion_id: suggestionIdString
      }

      console.log('🚀 [Execute] Preparing to execute suggestion actions')
      console.log('📦 [Execute] Full payload:', JSON.stringify(payload, null, 2))
      console.log('📋 [Execute] Action steps:', suggestion.action_steps)

      // Get auth token from electron store
      const authToken = await ipcRenderer.invoke('get-auth-token')
      console.log('🔑 [Execute] Auth token:', authToken ? `${authToken.substring(0, 20)}...` : 'MISSING')

      const headers = {
        'Content-Type': 'application/json',
      }

      if (authToken) {
        headers['Authorization'] = `Bearer ${authToken}`
        console.log('✅ [Execute] Authorization header set')
      } else {
        console.error('❌ [Execute] No auth token available!')
      }

      const response = await fetch('http://localhost:8000/api/actions/execute-direct', {
        method: 'POST',
        headers: headers,
        body: JSON.stringify(payload)
      })

      const data = await response.json()
      console.log('📥 [Execute] Response:', response.status, data)

      if (!response.ok) {
        // Handle authentication errors specifically
        if (response.status === 401) {
          throw new Error('Authentication required. Please open Settings and connect your Google account to execute actions.')
        }

        // Better error message formatting with field locations
        console.error('❌ [Execute] Raw error detail:', data.detail)

        let errorMsg = `HTTP ${response.status}`
        if (data.detail) {
          if (typeof data.detail === 'string') {
            errorMsg = data.detail
          } else if (Array.isArray(data.detail)) {
            // Pydantic validation errors: include field location
            errorMsg = data.detail.map(e => {
              const field = e.loc ? e.loc.join('.') : 'unknown'
              const msg = e.msg || e.message || 'validation error'
              return `${field}: ${msg}`
            }).join('; ')
          } else {
            errorMsg = JSON.stringify(data.detail)
          }
        } else if (data.error) {
          errorMsg = typeof data.error === 'string' ? data.error : JSON.stringify(data.error)
        }

        console.error('❌ [Execute] Formatted error:', errorMsg)
        throw new Error(errorMsg)
      }

      console.log('✅ Action executed successfully:', data)
      setExecutionResult(data)

    } catch (error) {
      console.error('❌ Error executing action:', error)
      setExecutionError(error.message)
    } finally {
      setIsExecuting(false)
    }
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

            {/* Execute Button for Actionable Suggestions */}
            {isActionable && (
              <div className="mt-4 space-y-2">
                <button
                  onClick={executeAction}
                  disabled={isExecuting}
                  className="w-full px-4 py-2.5 rounded-lg font-semibold text-sm transition-all flex items-center justify-center gap-2"
                  style={{
                    background: isExecuting
                      ? 'rgba(71, 85, 105, 0.3)'
                      : executionResult
                      ? 'rgba(34, 197, 94, 0.2)'
                      : 'rgba(59, 130, 246, 0.3)',
                    border: `1px solid ${
                      isExecuting
                        ? 'rgba(71, 85, 105, 0.4)'
                        : executionResult
                        ? 'rgba(34, 197, 94, 0.4)'
                        : 'rgba(59, 130, 246, 0.4)'
                    }`,
                    color: isExecuting ? 'rgba(255, 255, 255, 0.5)' : executionResult ? 'rgba(34, 197, 94, 0.9)' : 'rgba(147, 197, 253, 0.9)',
                    cursor: isExecuting ? 'not-allowed' : 'pointer'
                  }}
                >
                  {isExecuting ? (
                    <>
                      <svg className="animate-spin" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <circle cx="12" cy="12" r="10" opacity="0.25"></circle>
                        <path d="M12 2 A10 10 0 0 1 22 12" opacity="0.75"></path>
                      </svg>
                      <span>Executing...</span>
                    </>
                  ) : executionResult ? (
                    <>
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                        <polyline points="20 6 9 17 4 12"></polyline>
                      </svg>
                      <span>Executed Successfully</span>
                    </>
                  ) : (
                    <>
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <polygon points="5 3 19 12 5 21 5 3"></polygon>
                      </svg>
                      <span>Execute Action</span>
                    </>
                  )}
                </button>

                {/* Execution Result */}
                {executionResult && (
                  <div className="rounded-lg overflow-hidden" style={{
                    background: 'rgba(34, 197, 94, 0.1)',
                    border: '1px solid rgba(34, 197, 94, 0.3)'
                  }}>
                    {executionResult.results && executionResult.results.length > 0 && (
                      <div className="space-y-0">
                        {executionResult.results.map((result, idx) => {
                          // Handle search results (multiple events)
                          if (result.success && result.data && result.data.events) {
                            return (
                              <div key={idx} className="p-3 space-y-2">
                                <div className="text-white/70 text-xs font-medium mb-2">
                                  🔍 Found {result.data.count} event{result.data.count !== 1 ? 's' : ''} matching "{result.data.query}"
                                </div>
                                {result.data.events.map((event, eventIdx) => (
                                  <div key={eventIdx} className="ml-4 p-2 rounded border border-white/10 bg-white/5 space-y-1">
                                    <div className="flex items-center gap-2">
                                      <span className="text-sm">📅</span>
                                      <span className="text-white/90 text-xs font-medium">{event.title}</span>
                                    </div>
                                    {event.start && (
                                      <div className="text-white/60 text-[11px] pl-5">
                                        {new Date(event.start).toLocaleString('en-US', {
                                          weekday: 'short',
                                          month: 'short',
                                          day: 'numeric',
                                          hour: 'numeric',
                                          minute: '2-digit',
                                          hour12: true
                                        })}
                                      </div>
                                    )}
                                    <div className="text-white/40 text-[10px] pl-5 font-mono">ID: {event.event_id.substring(0, 12)}...</div>
                                  </div>
                                ))}
                              </div>
                            )
                          }

                          // Handle single event results (create/update)
                          if (result.success && result.data) {
                            return (
                              <div key={idx} className="p-3 space-y-2">
                                {result.data.title && (
                                  <div className="flex items-center gap-2">
                                    <span className="text-base">📅</span>
                                    <span className="text-white/90 font-medium text-xs">{result.data.title}</span>
                                  </div>
                                )}
                                {result.data.start && (
                                  <div className="text-white/60 text-[11px] pl-6">
                                    {new Date(result.data.start).toLocaleString('en-US', {
                                      weekday: 'short',
                                      month: 'short',
                                      day: 'numeric',
                                      hour: 'numeric',
                                      minute: '2-digit',
                                      hour12: true
                                    })}
                                  </div>
                                )}
                                {result.data.html_link && (
                                  <a
                                    href={result.data.html_link}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-all ml-6 group"
                                    style={{
                                      background: 'rgba(59, 130, 246, 0.15)',
                                      border: '1px solid rgba(59, 130, 246, 0.3)',
                                      color: 'rgb(96, 165, 250)'
                                    }}
                                    onMouseEnter={(e) => {
                                      e.currentTarget.style.background = 'rgba(59, 130, 246, 0.25)'
                                      e.currentTarget.style.borderColor = 'rgba(59, 130, 246, 0.5)'
                                    }}
                                    onMouseLeave={(e) => {
                                      e.currentTarget.style.background = 'rgba(59, 130, 246, 0.15)'
                                      e.currentTarget.style.borderColor = 'rgba(59, 130, 246, 0.3)'
                                    }}
                                    onClick={(e) => {
                                      e.preventDefault()
                                      window.require('electron').shell.openExternal(result.data.html_link)
                                    }}
                                  >
                                    <span>View in Google Calendar</span>
                                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="group-hover:translate-x-0.5 transition-transform">
                                      <line x1="5" y1="12" x2="19" y2="12"></line>
                                      <polyline points="12 5 19 12 12 19"></polyline>
                                    </svg>
                                  </a>
                                )}
                              </div>
                            )
                          }

                          return null
                        })}
                      </div>
                    )}
                  </div>
                )}

                {/* Execution Error */}
                {executionError && (
                  <div className="p-3 rounded-lg" style={{
                    background: 'rgba(239, 68, 68, 0.1)',
                    border: '1px solid rgba(239, 68, 68, 0.3)'
                  }}>
                    <div className="text-xs text-red-400 font-medium mb-1">✗ Execution Failed</div>
                    <div className="text-xs text-white/60">{executionError}</div>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

function ChatMessage({ message }) {
  const isUser = message.role === 'user'
  const isAction = message.role === 'action' || message.isActionable
  const isError = message.isError
  const isAssistant = message.role === 'assistant'

  // State for action execution
  const [isExecuting, setIsExecuting] = useState(false)
  const [executionResult, setExecutionResult] = useState(null)
  const [executionError, setExecutionError] = useState(null)

  // Get model name for display
  const modelInfo = MODELS.find(m => m.id === message.model) || MODELS.find(m => m.id === 'gpt-4')
  // Show model name for assistant messages with tool calls, only show "Squire Actions" for separate action messages
  const displayName = isUser ? 'You' : message.role === 'action' ? 'Squire Actions' : `${modelInfo?.name || 'Assistant'}`

  // Execute action
  const executeAction = async () => {
    if (!isAction || isExecuting) return

    console.log('🚀🚀🚀 [Execute] NEW CODE LOADED - Starting execution with time correction')

    setIsExecuting(true)
    setExecutionError(null)
    setExecutionResult(null)

    try {
      // Convert ID to string to match backend validation
      const suggestionIdString = message.id ? String(message.id) : null
      console.log('🔄 [Execute] Converting suggestion_id:', message.id, '→', suggestionIdString, typeof suggestionIdString)

      // Apply time correction ONLY for calendar_create_event (not updates)
      // For updates, the LLM has context from search results and should be trusted
      let correctedActionSteps = message.action_steps
      if (message.original_user_message) {
        console.log('📝 [Execute] Original user message:', message.original_user_message)
        correctedActionSteps = message.action_steps.map(step => {
          // Only apply time correction to CREATE operations, not UPDATE
          if (step.action_type === 'calendar_create_event') {
            const correctedParams = { ...step.action_params }
            if (correctedParams.start) {
              const correctedStart = correctTimeInDatetime(correctedParams.start, message.original_user_message)
              if (correctedStart !== correctedParams.start) {
                console.log(`🔧 [Execute] Time correction applied: ${correctedParams.start} → ${correctedStart}`)
                correctedParams.start = correctedStart
              }
            }
            if (correctedParams.end) {
              const correctedEnd = correctTimeInDatetime(correctedParams.end, message.original_user_message)
              if (correctedEnd !== correctedParams.end) {
                console.log(`🔧 [Execute] Time correction applied: ${correctedParams.end} → ${correctedEnd}`)
                correctedParams.end = correctedEnd
              }
            }
            return { ...step, action_params: correctedParams }
          } else if (step.action_type === 'calendar_update_event') {
            console.log(`✓ [Execute] Skipping time correction for UPDATE - trusting LLM's context-aware decision`)
          }
          return step
        })
      } else {
        console.log('⚠️ [Execute] No original user message available for time correction')
      }

      const payload = {
        action_steps: correctedActionSteps,
        suggestion_id: suggestionIdString
      }

      console.log('🚀 [Execute] Preparing to execute actions')
      console.log('📦 [Execute] Full payload:', JSON.stringify(payload, null, 2))
      console.log('📋 [Execute] Action steps:', correctedActionSteps)

      const authToken = await ipcRenderer.invoke('get-auth-token')
      if (!authToken) {
        throw new Error('Not authenticated. Please log in to execute actions.')
      }

      const response = await fetch('http://localhost:8000/api/actions/execute-direct', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${authToken}`
        },
        body: JSON.stringify(payload)
      })

      const data = await response.json()
      console.log('📥 [Execute] Response:', response.status, data)

      if (!response.ok) {
        if (response.status === 401) {
          throw new Error('Authentication required. Please open Settings and connect your Google account to execute actions.')
        }

        // Better error message formatting with field locations
        console.error('❌ [Execute] Raw error detail:', data.detail)

        let errorMsg = `HTTP ${response.status}`
        if (data.detail) {
          if (typeof data.detail === 'string') {
            errorMsg = data.detail
          } else if (Array.isArray(data.detail)) {
            // Pydantic validation errors: include field location
            errorMsg = data.detail.map(e => {
              const field = e.loc ? e.loc.join('.') : 'unknown'
              const msg = e.msg || e.message || 'validation error'
              return `${field}: ${msg}`
            }).join('; ')
          } else {
            errorMsg = JSON.stringify(data.detail)
          }
        } else if (data.error) {
          errorMsg = typeof data.error === 'string' ? data.error : JSON.stringify(data.error)
        }

        console.error('❌ [Execute] Formatted error:', errorMsg)
        throw new Error(errorMsg)
      }

      console.log('✅ Action executed successfully:', data)
      setExecutionResult(data)
    } catch (error) {
      console.error('❌ Error executing action:', error)
      setExecutionError(error.message)
    } finally {
      setIsExecuting(false)
    }
  }

  // Simple markdown rendering
  const renderContent = (content) => {
    if (!content) return ''

    // Handle multimodal content (array with text and images)
    if (Array.isArray(content)) {
      // Extract text parts and return as HTML with images
      let html = ''
      content.forEach(part => {
        if (part.type === 'text') {
          html += renderTextContent(part.text)
        } else if (part.type === 'image_url') {
          html += `<img src="${part.image_url.url}" style="max-width: 300px; border-radius: 8px; margin: 8px 0; border: 1px solid rgba(71, 85, 105, 0.3);" />`
        }
      })
      return html
    }

    // Handle plain text content
    return renderTextContent(content)
  }

  const renderTextContent = (content) => {
    if (!content) return ''

    // Code blocks
    content = content.replace(/```(\w*)\n([\s\S]*?)```/g, (match, lang, code) => {
      return `<pre style="background: rgba(15, 23, 42, 0.6); padding: 8px; border-radius: 6px; margin: 8px 0; overflow-x: auto; border: 1px solid rgba(71, 85, 105, 0.3); max-width: 100%; font-size: 11px;"><code class="text-white/90 font-mono" style="word-wrap: break-word; white-space: pre-wrap;">${code.trim()}</code></pre>`
    })

    // Inline code (must be before links to avoid matching backticks in URLs)
    content = content.replace(/`([^`]+)`/g, '<code style="background: rgba(15, 23, 42, 0.6); padding: 2px 6px; border-radius: 4px; font-size: 0.8125rem; font-family: monospace; border: 1px solid rgba(71, 85, 105, 0.2);">$1</code>')

    // Markdown links [text](url)
    content = content.replace(/\[([^\]]+)\]\(([^\)]+)\)/g, (match, text, url) => {
      return `<a href="${url}" class="text-blue-400 hover:text-blue-300 underline transition-colors cursor-pointer" onclick="event.preventDefault(); window.require('electron').shell.openExternal('${url}')" target="_blank" rel="noopener noreferrer">${text}</a>`
    })

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
        background: isUser ? 'rgba(59, 130, 246, 0.2)' : isAction ? 'rgba(34, 197, 94, 0.2)' : 'rgba(100, 116, 139, 0.2)',
        color: isUser ? 'rgba(147, 197, 253, 0.9)' : isAction ? 'rgba(134, 239, 172, 0.9)' : 'rgba(203, 213, 225, 0.9)',
        border: `1px solid ${isUser ? 'rgba(59, 130, 246, 0.3)' : isAction ? 'rgba(34, 197, 94, 0.3)' : 'rgba(100, 116, 139, 0.3)'}`
      }}>
        {isUser ? 'U' : isAction ? '⚡' : (isAssistant ? 'A' : '?')}
      </div>
      <div className="flex-1 overflow-hidden">
        <div className="text-xs text-white/40 mb-1.5 font-medium">
          {displayName}
        </div>
        <div
          className={`text-sm break-words leading-relaxed ${
            isError ? 'text-red-300' : 'text-white/85'
          }`}
          style={{
            wordBreak: 'break-word',
            overflowWrap: 'anywhere',
            maxWidth: '100%'
          }}
          dangerouslySetInnerHTML={{ __html: renderContent(message.content) }}
        />
        {message.isStreaming && (
          <span className="inline-block w-1.5 h-3.5 ml-1 bg-blue-400/70 animate-pulse rounded-sm" />
        )}

        {/* Execute button for action messages */}
        {isAction && message.action_steps && (
          <div className="mt-3">
            <button
              onClick={executeAction}
              disabled={isExecuting || executionResult}
              className="px-4 py-2 rounded-lg text-sm font-medium transition-all flex items-center gap-2"
              style={{
                background: isExecuting
                  ? 'rgba(71, 85, 105, 0.3)'
                  : executionResult
                  ? 'rgba(34, 197, 94, 0.2)'
                  : 'rgba(59, 130, 246, 0.3)',
                border: `1px solid ${
                  isExecuting
                    ? 'rgba(71, 85, 105, 0.4)'
                    : executionResult
                    ? 'rgba(34, 197, 94, 0.4)'
                    : 'rgba(59, 130, 246, 0.4)'
                }`,
                color: isExecuting ? 'rgba(255, 255, 255, 0.5)' : executionResult ? 'rgba(34, 197, 94, 0.9)' : 'rgba(147, 197, 253, 0.9)',
                cursor: isExecuting || executionResult ? 'not-allowed' : 'pointer'
              }}
            >
              {isExecuting ? (
                <>
                  <svg className="animate-spin" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <circle cx="12" cy="12" r="10" opacity="0.25"></circle>
                    <path d="M12 2a10 10 0 0 1 10 10" opacity="0.75"></path>
                  </svg>
                  <span>Executing...</span>
                </>
              ) : executionResult ? (
                <>
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <polyline points="20 6 9 17 4 12"></polyline>
                  </svg>
                  <span>Executed Successfully</span>
                </>
              ) : (
                <>
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <polygon points="5 3 19 12 5 21 5 3"></polygon>
                  </svg>
                  <span>Execute Action</span>
                </>
              )}
            </button>

            {executionError && (
              <div className="mt-2 text-xs text-red-400 bg-red-500/10 border border-red-500/20 rounded px-3 py-2">
                {executionError}
              </div>
            )}

            {executionResult && (
              <div className="mt-3 text-xs bg-green-500/10 border border-green-500/20 rounded-lg overflow-hidden">
                {executionResult.results && executionResult.results.map((result, idx) => {
                  // Handle search results (multiple events)
                  if (result.success && result.data && result.data.events) {
                    return (
                      <div key={idx} className="p-3 space-y-2">
                        <div className="text-white/70 text-xs font-medium mb-2">
                          🔍 Found {result.data.count} event{result.data.count !== 1 ? 's' : ''} matching "{result.data.query}"
                        </div>
                        {result.data.events.map((event, eventIdx) => (
                          <div key={eventIdx} className="ml-4 p-2 rounded border border-white/10 bg-white/5 space-y-1">
                            <div className="flex items-center gap-2">
                              <span className="text-sm">📅</span>
                              <span className="text-white/90 text-xs font-medium">{event.title}</span>
                            </div>
                            {event.start && (
                              <div className="text-white/60 text-[11px] pl-5">
                                {new Date(event.start).toLocaleString('en-US', {
                                  weekday: 'short',
                                  month: 'short',
                                  day: 'numeric',
                                  hour: 'numeric',
                                  minute: '2-digit',
                                  hour12: true
                                })}
                              </div>
                            )}
                            <div className="text-white/40 text-[10px] pl-5 font-mono">ID: {event.event_id.substring(0, 12)}...</div>
                          </div>
                        ))}
                      </div>
                    )
                  }

                  // Handle single event results (create/update)
                  if (result.success && result.data) {
                    return (
                      <div key={idx} className="p-3 space-y-2">
                        {result.data.title && (
                          <div className="flex items-center gap-2">
                            <span className="text-base">📅</span>
                            <span className="text-white/90 font-medium">{result.data.title}</span>
                          </div>
                        )}
                        {result.data.start && (
                          <div className="text-white/60 text-[11px] pl-6">
                            {new Date(result.data.start).toLocaleString('en-US', {
                              weekday: 'short',
                              month: 'short',
                              day: 'numeric',
                              hour: 'numeric',
                              minute: '2-digit',
                              hour12: true
                            })}
                          </div>
                        )}
                        {result.data.html_link && (
                          <a
                            href={result.data.html_link}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-all ml-6 group"
                            style={{
                              background: 'rgba(59, 130, 246, 0.15)',
                              border: '1px solid rgba(59, 130, 246, 0.3)',
                              color: 'rgb(96, 165, 250)'
                            }}
                            onMouseEnter={(e) => {
                              e.currentTarget.style.background = 'rgba(59, 130, 246, 0.25)'
                              e.currentTarget.style.borderColor = 'rgba(59, 130, 246, 0.5)'
                            }}
                            onMouseLeave={(e) => {
                              e.currentTarget.style.background = 'rgba(59, 130, 246, 0.15)'
                              e.currentTarget.style.borderColor = 'rgba(59, 130, 246, 0.3)'
                            }}
                            onClick={(e) => {
                              e.preventDefault()
                              window.require('electron').shell.openExternal(result.data.html_link)
                            }}
                          >
                            <span>View in Google Calendar</span>
                            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="group-hover:translate-x-0.5 transition-transform">
                              <line x1="5" y1="12" x2="19" y2="12"></line>
                              <polyline points="12 5 19 12 12 19"></polyline>
                            </svg>
                          </a>
                        )}
                      </div>
                    )
                  }

                  return null
                })}
              </div>
            )}
          </div>
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

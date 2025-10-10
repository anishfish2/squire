/**
 * Smart Action Detector
 * Detects when user types actionable content in specific apps
 * and triggers immediate OCR + action detection
 */

import { uIOhook, UiohookKey } from 'uiohook-napi'
import activeWin from 'active-win'

class SmartActionDetector {
  constructor(aiAssistant, ocrManager) {
    this.aiAssistant = aiAssistant
    this.ocrManager = ocrManager
    this.isEnabled = false

    // Apps where we should detect actions immediately
    this.actionableApps = [
      'gmail',
      'mail',
      'outlook',
      'calendar',
      'google chrome', // For Gmail web
      'safari',  // For Gmail web
      'firefox',
      'microsoft edge'
    ]

    // Typing state
    this.typingState = {
      isTyping: false,
      lastKeystroke: 0,
      typingTimeout: null,
      currentApp: null,
      currentWindow: null,
      keystrokeBuffer: [],
      typingSessionStart: 0
    }

    // Debounce settings
    this.TYPING_PAUSE_THRESHOLD = 1500 // 1.5 seconds after typing stops
    this.MIN_KEYSTROKES = 15 // Minimum keystrokes before triggering

    // Action detection keywords (trigger immediate analysis)
    this.actionKeywords = [
      'meeting',
      'meet',
      'schedule',
      'calendar',
      'appointment',
      'call',
      'tomorrow',
      'today',
      'next week',
      'draft',
      'email',
      'send',
      'reply',
      'at',
      'pm',
      'am'
    ]

    // Recent OCR results cache
    this.recentOCR = {
      text: [],
      timestamp: 0,
      appName: null
    }

    console.log('✨ [SmartActionDetector] Initialized')
  }

  start() {
    if (this.isEnabled) {
      console.log('⚠️ [SmartActionDetector] Already running')
      return
    }

    this.isEnabled = true

    // Listen to keyboard events
    uIOhook.on('keydown', (e) => this.handleKeyDown(e))

    console.log('🎯 [SmartActionDetector] Started monitoring keyboard')
  }

  stop() {
    this.isEnabled = false
    if (this.typingState.typingTimeout) {
      clearTimeout(this.typingState.typingTimeout)
    }
    console.log('🛑 [SmartActionDetector] Stopped')
  }

  async handleKeyDown(event) {
    if (!this.isEnabled) return

    const now = Date.now()

    // Get current active app
    try {
      const activeWindow = await activeWin()
      if (!activeWindow || !activeWindow.owner) return

      const appName = activeWindow.owner.name.toLowerCase()
      const windowTitle = activeWindow.title || ''

      // Check if this is an actionable app
      const isActionableApp = this.actionableApps.some(app =>
        appName.includes(app) || windowTitle.toLowerCase().includes('gmail') || windowTitle.toLowerCase().includes('mail')
      )

      if (!isActionableApp) {
        // Not an app we care about
        return
      }

      // Track typing state
      this.typingState.currentApp = appName
      this.typingState.currentWindow = windowTitle

      // Add to keystroke buffer
      this.typingState.keystrokeBuffer.push({
        key: event.keycode,
        timestamp: now
      })

      // Keep buffer size manageable
      if (this.typingState.keystrokeBuffer.length > 100) {
        this.typingState.keystrokeBuffer.shift()
      }

      if (!this.typingState.isTyping) {
        this.typingState.typingSessionStart = now
        this.typingState.isTyping = true
        console.log(`⌨️ [SmartActionDetector] Typing started in ${appName}`)
      }

      this.typingState.lastKeystroke = now

      // Clear existing timeout
      if (this.typingState.typingTimeout) {
        clearTimeout(this.typingState.typingTimeout)
      }

      // Set new timeout - trigger OCR after user stops typing
      this.typingState.typingTimeout = setTimeout(() => {
        this.onTypingPaused()
      }, this.TYPING_PAUSE_THRESHOLD)

    } catch (error) {
      console.error('❌ [SmartActionDetector] Error handling keydown:', error)
    }
  }

  async onTypingPaused() {
    if (!this.isEnabled || !this.typingState.isTyping) return

    const keystrokeCount = this.typingState.keystrokeBuffer.length
    const typingDuration = Date.now() - this.typingState.typingSessionStart

    console.log(`⏸️ [SmartActionDetector] Typing paused in ${this.typingState.currentApp}`)
    console.log(`   Keystrokes: ${keystrokeCount}, Duration: ${typingDuration}ms`)

    // Reset typing state
    this.typingState.isTyping = false
    this.typingState.keystrokeBuffer = []

    // Only trigger if user typed enough
    if (keystrokeCount < this.MIN_KEYSTROKES) {
      console.log(`   ⚠️ Not enough keystrokes (${keystrokeCount} < ${this.MIN_KEYSTROKES}), skipping`)
      return
    }

    // Trigger immediate OCR + action detection
    console.log(`🎯 [SmartActionDetector] Triggering immediate action detection...`)
    await this.triggerActionDetection()
  }

  async triggerActionDetection() {
    try {
      const appContext = {
        appName: this.typingState.currentApp,
        windowTitle: this.typingState.currentWindow,
        session_id: this.aiAssistant?.sessionId
      }

      console.log(`📸 [SmartActionDetector] Capturing OCR for action detection...`)

      // Capture OCR immediately
      const ocrText = await this.ocrManager.captureAndRecognize(
        appContext,
        this.aiAssistant?.userId
      )

      if (!ocrText || ocrText.length === 0) {
        console.log(`   ⚠️ No OCR text captured`)
        return
      }

      // Cache OCR result
      this.recentOCR = {
        text: ocrText,
        timestamp: Date.now(),
        appName: this.typingState.currentApp
      }

      console.log(`   ✅ OCR captured: ${ocrText.length} lines`)

      // Check if OCR text contains action keywords
      const hasActionKeywords = this.containsActionKeywords(ocrText)

      if (!hasActionKeywords) {
        console.log(`   ⚠️ No action keywords found, skipping backend analysis`)
        return
      }

      console.log(`   🎯 Action keywords detected! Triggering backend analysis...`)

      // Trigger immediate AI suggestion with high priority
      await this.aiAssistant.requestImmediateActionAnalysis({
        appName: appContext.appName,
        windowTitle: appContext.windowTitle,
        ocrText: ocrText,
        priority: 'high',
        trigger: 'smart_action_detection',
        timestamp: Date.now()
      })

    } catch (error) {
      console.error('❌ [SmartActionDetector] Error triggering action detection:', error)
    }
  }

  containsActionKeywords(ocrLines) {
    const fullText = ocrLines.join(' ').toLowerCase()

    // Check for action keywords
    const hasKeywords = this.actionKeywords.some(keyword =>
      fullText.includes(keyword.toLowerCase())
    )

    if (hasKeywords) {
      const matchedKeywords = this.actionKeywords.filter(keyword =>
        fullText.includes(keyword.toLowerCase())
      )
      console.log(`   🔍 Matched keywords: ${matchedKeywords.join(', ')}`)
    }

    return hasKeywords
  }

  // Get recent OCR text (for use by other components)
  getRecentOCR(maxAge = 10000) {
    const age = Date.now() - this.recentOCR.timestamp
    if (age > maxAge) {
      return null
    }
    return this.recentOCR
  }
}

export default SmartActionDetector

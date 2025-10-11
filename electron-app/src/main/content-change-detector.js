/**
 * Content Change Detector
 * Monitors for significant content changes in actionable apps
 * Triggers immediate focused capture when new important content appears
 */

import { desktopCapturer } from 'electron'
import activeWin from 'active-win'

class ContentChangeDetector {
  constructor(ocrManager, aiAssistant) {
    this.ocrManager = ocrManager
    this.aiAssistant = aiAssistant
    this.isEnabled = false
    this.hasLoggedPermissionError = false // Track if we've already logged permission errors

    // Apps where we monitor for content changes
    this.monitoredApps = [
      'gmail',
      'mail',
      'outlook',
      'calendar',
      'google calendar',
      'google chrome',
      'safari',
      'firefox',
      'microsoft edge',
      'slack',
      'teams'
    ]

    // Store previous OCR content for comparison
    this.previousContent = new Map()

    // Polling interval for content monitoring
    this.pollInterval = null
    this.POLL_FREQUENCY = 2000 // 2 seconds for actionable apps

    // Content change thresholds
    this.SIGNIFICANT_CHANGE_THRESHOLD = 0.3 // 30% new content
    this.MIN_NEW_LINES = 3 // Minimum new lines to trigger

    // Keywords that indicate actionable content
    this.actionablePatterns = [
      // Calendar/Meeting patterns
      /meeting.*(?:tomorrow|today|monday|tuesday|wednesday|thursday|friday)/i,
      /schedule.*(?:\d{1,2}(?:am|pm)|meeting|call)/i,
      /calendar.*invite/i,
      /(?:can we|let'?s|shall we).*meet/i,
      /(?:\d{1,2}:\d{2}|\d{1,2}(?:am|pm)).*(?:meeting|call|sync)/i,

      // Email action patterns
      /please.*(?:review|approve|sign|send|schedule)/i,
      /urgent.*action required/i,
      /deadline.*(?:today|tomorrow|this week)/i,
      /(?:asap|urgent|immediately)/i,

      // Task patterns
      /(?:todo|task|action item):/i,
      /need(?:s|ed)? (?:to|your)/i,
      /please (?:confirm|respond|reply)/i
    ]
  }

  async start() {
    if (this.isEnabled) return

    console.log('🔍 [ContentChangeDetector] Starting content monitoring...')
    this.isEnabled = true

    // Start polling for content changes
    this.pollInterval = setInterval(() => {
      this.checkForContentChanges()
    }, this.POLL_FREQUENCY)
  }

  stop() {
    if (!this.isEnabled) return

    console.log('🔍 [ContentChangeDetector] Stopping content monitoring...')
    this.isEnabled = false

    if (this.pollInterval) {
      clearInterval(this.pollInterval)
      this.pollInterval = null
    }

    this.previousContent.clear()
  }

  async checkForContentChanges() {
    try {
      const activeWindow = await activeWin()
      if (!activeWindow) return

      const appName = activeWindow.owner.name.toLowerCase()

      // Only monitor specific apps
      if (!this.shouldMonitorApp(appName)) return

      // Capture current content (lightweight OCR)
      const currentContent = await this.captureContent(activeWindow)
      if (!currentContent || currentContent.length === 0) return

      // Get previous content for this app
      const previousContent = this.previousContent.get(appName) || []

      // Detect significant changes
      const changes = this.detectChanges(previousContent, currentContent)

      if (changes.isSignificant && changes.hasActionableContent) {
        console.log(`🎯 [ContentChangeDetector] Significant actionable content detected in ${appName}!`)
        console.log(`   - New lines: ${changes.newLines.length}`)
        console.log(`   - Change ratio: ${(changes.changeRatio * 100).toFixed(1)}%`)
        console.log(`   - Actionable: ${changes.actionableType}`)

        // Trigger focused action detection
        await this.triggerFocusedCapture(activeWindow, changes)
      }

      // Update previous content
      this.previousContent.set(appName, currentContent)

    } catch (error) {
      // Only log permission errors once
      if (error.message?.includes('screen recording permission')) {
        if (!this.hasLoggedPermissionError) {
          console.log('⚠️ [ContentChangeDetector] Screen recording permission required (suppressing future warnings)')
          this.hasLoggedPermissionError = true
        }
        return
      }

      // Silently ignore other errors (e.g. SIGINT from process interruption)
      // These are normal when the app is shutting down or switching contexts
    }
  }

  shouldMonitorApp(appName) {
    return this.monitoredApps.some(app => appName.includes(app))
  }

  async captureContent(activeWindow) {
    // Use focused region capture instead of full screen
    const appContext = {
      appName: activeWindow.owner.name,
      windowTitle: activeWindow.title,
      session_id: this.aiAssistant?.sessionId
    }

    // Capture focused region around mouse/activity
    const jobId = await this.ocrManager.captureFocusedAndQueue(
      null,  // Auto-detect region from mouse
      appContext,
      this.aiAssistant?.userId
    )

    if (!jobId) return null

    // Wait for OCR completion (with short timeout)
    try {
      const result = await this.ocrManager.waitForJobCompletionWebSocket(jobId, 5000)
      return result.text_lines || []
    } catch {
      return null
    }
  }

  detectChanges(previousContent, currentContent) {
    // Find new lines not in previous content
    const prevSet = new Set(previousContent.map(line => line.trim().toLowerCase()))
    const newLines = currentContent.filter(line => {
      const normalized = line.trim().toLowerCase()
      return normalized.length > 10 && !prevSet.has(normalized)
    })

    // Calculate change ratio
    const totalLines = Math.max(currentContent.length, 1)
    const changeRatio = newLines.length / totalLines

    // Check if new content contains actionable patterns
    const newContent = newLines.join(' ')
    let hasActionableContent = false
    let actionableType = null

    for (const pattern of this.actionablePatterns) {
      if (pattern.test(newContent)) {
        hasActionableContent = true

        // Determine type of action
        if (/meeting|calendar|schedule.*(?:\d|am|pm)/i.test(newContent)) {
          actionableType = 'calendar_scheduling'
        } else if (/urgent|asap|deadline/i.test(newContent)) {
          actionableType = 'urgent_task'
        } else if (/review|approve|sign/i.test(newContent)) {
          actionableType = 'approval_request'
        } else {
          actionableType = 'general_action'
        }
        break
      }
    }

    // Determine if change is significant
    const isSignificant = (
      newLines.length >= this.MIN_NEW_LINES ||
      changeRatio >= this.SIGNIFICANT_CHANGE_THRESHOLD
    )

    return {
      isSignificant,
      hasActionableContent,
      actionableType,
      newLines,
      changeRatio,
      focusedContent: newLines.slice(0, 10) // Focus on first 10 new lines
    }
  }

  async triggerFocusedCapture(activeWindow, changes) {
    try {
      // Build focused context with emphasis on new content
      const focusedContext = {
        appName: activeWindow.owner.name,
        windowTitle: activeWindow.title,

        // Prioritize new content
        ocrText: [
          ...changes.focusedContent,  // New content first
          '--- Previous Context ---',
          ...this.previousContent.get(activeWindow.owner.name.toLowerCase()).slice(-5) // Some context
        ],

        // High priority for immediate processing
        priority: 'immediate',
        trigger: 'content_change_detection',

        // Include detection metadata
        metadata: {
          changeType: changes.actionableType,
          newLinesCount: changes.newLines.length,
          changeRatio: changes.changeRatio,
          timestamp: Date.now()
        }
      }

      console.log(`📸 [ContentChangeDetector] Triggering focused action analysis...`)

      // Request immediate, focused AI analysis
      const suggestions = await this.aiAssistant.requestFocusedActionAnalysis(focusedContext)

      if (suggestions && suggestions.length > 0) {
        console.log(`   ✅ Generated ${suggestions.length} focused suggestions`)
      }

    } catch (error) {
      console.error('❌ [ContentChangeDetector] Error triggering focused capture:', error)
    }
  }
}

export default ContentChangeDetector
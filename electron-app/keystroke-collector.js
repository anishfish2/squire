const { globalShortcut, app } = require('electron');
const { GlobalKeyboardListener } = require('node-global-key-listener');

class EfficientKeystrokeCollector {
  constructor(onSequenceReady) {
    this.buffer = [];
    this.sequenceStart = null;
    this.lastKeystroke = null;
    this.onSequenceReady = onSequenceReady;
    this.currentContext = null;
    this.isTracking = false;

    // Configuration
    this.maxBufferSize = 100;
    this.flushInterval = 30000; // 30 seconds
    this.naturalBreakThreshold = 5000; // 5 seconds of inactivity
    this.minSequenceLength = 5; // minimum keystrokes before analysis

    // Timers
    this.flushTimer = null;
    this.naturalBreakTimer = null;

    // Global keyboard listener
    this.keyboardListener = null;

    // Track active modifier state
    this.activeModifiers = new Set(); // Track which modifiers are currently DOWN

    console.log('🎹 EfficientKeystrokeCollector initialized');
  }


  startTracking() {
    if (this.isTracking) {
      console.log('⚠️ Keystroke tracking already started');
      return;
    }

    // ✅ set flag before registering listeners
    this.isTracking = true;

    try {
      this.registerKeystrokeListeners();
      console.log('✅ Keystroke tracking started');
    } catch (error) {
      this.isTracking = false; // roll back if init fails
      console.error('❌ Failed to start keystroke tracking:', error);
    }
  }


  stopTracking() {
    if (!this.isTracking) return;

    this.flushBufferIfNeeded();
    this.clearTimers();
    this.unregisterKeystrokeListeners();
    this.isTracking = false;
    console.log('🛑 Keystroke tracking stopped');
  }

  registerKeystrokeListeners() {
    // Register common key combinations and individual keys
    // Note: Electron's globalShortcut has limitations, so we'll use a different approach

    // For now, we'll use a more comprehensive approach with native modules
    // This is a simplified version - in production you'd use a native module
    this.setupKeystrokeCapture();
  }




  setupKeystrokeCapture() {
    try {
      if (this.keyboardListener) {
        try { this.keyboardListener.kill(); } catch {}
        this.keyboardListener = null;
      }

      this.keyboardListener = new GlobalKeyboardListener();
      console.log("🎹 Setting up real keystroke monitoring (non-blocking)");

      this.lastPhysicalByScan = new Map();
      this.lastPhysicalByKey = new Map();
      this.lastAcceptedByKey = new Map();

      // Timing windows
      const SCAN_DUP_WINDOW_MS = 35;
      const KEY_MIN_SPACING_MS = 5;

      this.keyboardListener.addListener((e) => {
        if (!this.isTracking) return;

        const now = Date.now();
        let key = e.name || "";
        const state = e.state; // "DOWN" or "UP"


        // Normalize mouse clicks
        if (key.startsWith("MOUSE")) {
          
          this.captureKeystroke(key, [], Date.now(), state);

          return;
        }

        // Normalize special keys
        if (key === "Space") key = "SPACE";
        if (key === "Return" || key === "Enter") key = "ENTER";
        if (key === "Backspace") key = "BACKSPACE";
        if (key === "Tab") key = "TAB";

        // Normalize modifier keys
        if (key === "LEFT CTRL" || key === "RIGHT CTRL") key = "CTRL";
        if (key === "LEFT SHIFT" || key === "RIGHT SHIFT") key = "SHIFT";
        if (key === "LEFT META" || key === "RIGHT META") key = "CMD";
        if (key === "LEFT ALT" || key === "RIGHT ALT") key = "ALT";

        // Normalize printable characters
        if (key.length === 1) {
          key = e.shift ? key.toUpperCase() : key.toLowerCase();
        }

        // Track modifier state changes
        if (["CTRL", "SHIFT", "CMD", "ALT"].includes(key)) {
          if (state === "DOWN") {
            this.activeModifiers.add(key);
          } else if (state === "UP") {
            this.activeModifiers.delete(key);
          }
        }

        // Get current active modifiers for this keystroke
        const currentModifiers = Array.from(this.activeModifiers);
        const hasScan = Number.isInteger(e.scanCode) && e.scanCode > 0;

        if (state === "DOWN" && hasScan) {
          // Deduplicate only DOWN events
          const lastScanT = this.lastPhysicalByScan.get(e.scanCode) || 0;
          if (now - lastScanT < SCAN_DUP_WINDOW_MS) return;

          const lastKeyT = this.lastAcceptedByKey.get(key) || 0;
          if (now - lastKeyT < KEY_MIN_SPACING_MS) return;

          this.lastPhysicalByScan.set(e.scanCode, now);
          this.lastPhysicalByKey.set(key, now);
          this.lastAcceptedByKey.set(key, now);
        }

        // Always capture (both DOWN and UP)
        this.captureKeystroke(key, currentModifiers, now, state);
      });

      console.log("✅ Real keystroke monitoring enabled");
    } catch (error) {
      console.error("❌ Failed to setup real keystroke monitoring:", error);
    }
  }




  captureKeystroke(key, modifiers, timestamp, state = "DOWN") {
    if (!this.isTracking) return;

    if (!this.sequenceStart) {
      this.sequenceStart = timestamp;
      this.startFlushTimer();
    }

    const relativeTime = timestamp - this.sequenceStart;

    const keystrokeData = {
      key,
      modifiers: modifiers || [],
      timing: relativeTime,
      timestamp,
      state, 
      context: this.getCurrentContext()
    };

    this.buffer.push(keystrokeData);
    this.lastKeystroke = timestamp;

    this.resetNaturalBreakTimer();

    if (this.shouldFlush()) {
      this.flushBuffer();
    }
  }


  getCurrentContext() {

    return {
      timestamp: Date.now(),
      // This would be filled by app tracker
      app_name: this.currentContext?.app_name || 'Unknown',
      window_title: this.currentContext?.window_title || ''
    };
  }

  updateContext(context) {
    // Called by main process when app context changes
    this.currentContext = context;

    // Context change might trigger a flush to segment sequences by app
    if (this.buffer.length > this.minSequenceLength) {
      this.flushBuffer('context_change');
    }
  }

  shouldFlush() {
    const timeSinceStart = Date.now() - (this.sequenceStart || Date.now());

    return (
      this.buffer.length >= this.maxBufferSize ||
      timeSinceStart >= this.flushInterval
    );
  }

  flushBuffer(reason = 'normal') {
    if (this.buffer.length < this.minSequenceLength) {
      // Not enough data to analyze, just reset
      this.resetBuffer();
      return;
    }

    console.log(`📤 Flushing keystroke buffer: ${this.buffer.length} keystrokes (reason: ${reason})`);

    // Compress the sequence
    const compressedSequence = this.compressSequence(this.buffer);

    // Send to callback for backend processing
    if (this.onSequenceReady) {
      this.onSequenceReady(compressedSequence);
    }

    // Reset buffer
    this.resetBuffer();
  }


  compressSequence(buffer) {
    if (buffer.length === 0) return null;

    const keys = buffer.map(k => k.key);
    const timings = buffer.map(k => k.timing);
    const modifiers = buffer.map(k => k.modifiers);
    const states = buffer.map(k => k.state);

    const down_keys = buffer
      .filter(k => k.state === "DOWN")
      .map(k => k.key);

    const patterns = this.detectPatterns(buffer);
    const metadata = this.calculateSequenceMetadata(buffer);

    const contextData = this.aggregateContextData(buffer);

    return {
      sequence_id: this.generateSequenceId(),
      sequence_start: this.sequenceStart,
      sequence_duration: buffer[buffer.length - 1].timing,
      keystroke_count: buffer.length,

      // Efficient storage arrays
      keys,
      timings,
      modifiers,
      states,
      down_keys, // <-- NEW

      // Analyzed patterns
      patterns,
      metadata,
      context_data: contextData,

      // Processing info
      flush_reason: 'normal',
      created_at: new Date().toISOString()
    };
  }


  detectPatterns(buffer) {
    // Detect repetitive patterns
    const repetitivePatterns = this.findRepetitiveSequences(buffer);

    // Detect timing patterns
    const timingPatterns = this.analyzeTimingPatterns(buffer);

    // Detect modifier usage patterns
    const modifierPatterns = this.analyzeModifierUsage(buffer);

    return {
      repetitive_sequences: repetitivePatterns,
      timing_patterns: timingPatterns,
      modifier_usage: modifierPatterns,
      navigation_sequences: this.detectNavigationPatterns(buffer),
      shortcut_sequences: this.detectShortcutPatterns(buffer)
    };
  }

  findRepetitiveSequences(buffer) {
    const sequences = [];
    const keys = buffer.map(k => k.key);

    // Find sequences of the same key repeated
    let currentSequence = { key: keys[0], count: 1, start_index: 0 };

    for (let i = 1; i < keys.length; i++) {
      if (keys[i] === currentSequence.key) {
        currentSequence.count++;
      } else {
        if (currentSequence.count >= 3) { // Only store if repeated 3+ times
          sequences.push({
            key: currentSequence.key,
            repetitions: currentSequence.count,
            start_timing: buffer[currentSequence.start_index].timing,
            avg_interval: this.calculateAverageInterval(buffer, currentSequence.start_index, currentSequence.count)
          });
        }
        currentSequence = { key: keys[i], count: 1, start_index: i };
      }
    }

    // Check final sequence
    if (currentSequence.count >= 3) {
      sequences.push({
        key: currentSequence.key,
        repetitions: currentSequence.count,
        start_timing: buffer[currentSequence.start_index].timing,
        avg_interval: this.calculateAverageInterval(buffer, currentSequence.start_index, currentSequence.count)
      });
    }

    return sequences;
  }

  analyzeTimingPatterns(buffer) {
    if (buffer.length < 2) return {};

    const intervals = [];
    for (let i = 1; i < buffer.length; i++) {
      intervals.push(buffer[i].timing - buffer[i-1].timing);
    }

    return {
      avg_interval: intervals.reduce((a, b) => a + b, 0) / intervals.length,
      min_interval: Math.min(...intervals),
      max_interval: Math.max(...intervals),
      interval_variance: this.calculateVariance(intervals),
      typing_rhythm: this.categorizeTypingRhythm(intervals)
    };
  }

  analyzeModifierUsage(buffer) {
    const modifierCounts = {};
    const totalKeystrokes = buffer.length;

    buffer.forEach(keystroke => {
      keystroke.modifiers.forEach(modifier => {
        modifierCounts[modifier] = (modifierCounts[modifier] || 0) + 1;
      });
    });

    return {
      modifier_frequencies: modifierCounts,
      shortcut_ratio: Object.values(modifierCounts).reduce((a, b) => a + b, 0) / totalKeystrokes,
      most_used_modifier: Object.keys(modifierCounts).reduce((a, b) =>
        modifierCounts[a] > modifierCounts[b] ? a : b, null)
    };
  }

  detectNavigationPatterns(buffer) {
    const navigationKeys = ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Home', 'End', 'PageUp', 'PageDown'];
    const navigationSequences = [];

    let currentNav = [];

    buffer.forEach((keystroke, index) => {
      if (navigationKeys.includes(keystroke.key)) {
        currentNav.push(keystroke);
      } else {
        if (currentNav.length >= 2) { // 2+ navigation keys in sequence
          navigationSequences.push({
            keys: currentNav.map(k => k.key),
            duration: currentNav[currentNav.length - 1].timing - currentNav[0].timing,
            pattern_type: this.categorizeNavigationPattern(currentNav.map(k => k.key))
          });
        }
        currentNav = [];
      }
    });

    return navigationSequences;
  }

  detectShortcutPatterns(buffer) {
    return buffer
      .filter(keystroke => {
        // Only DOWN events and must have actual modifier keys
        return keystroke.state === "DOWN" &&
               keystroke.modifiers.length > 0 &&
               !["CTRL", "SHIFT", "CMD", "ALT"].includes(keystroke.key);
      })
      .map(keystroke => ({
        shortcut: `${keystroke.modifiers.join('+')}+${keystroke.key}`,
        timing: keystroke.timing
      }));
  }

  categorizeNavigationPattern(keys) {
    const keyStr = keys.join('');
    if (/^(ArrowDown)+$/.test(keyStr)) return 'vertical_down';
    if (/^(ArrowUp)+$/.test(keyStr)) return 'vertical_up';
    if (/^(ArrowLeft)+$/.test(keyStr)) return 'horizontal_left';
    if (/^(ArrowRight)+$/.test(keyStr)) return 'horizontal_right';
    return 'mixed_navigation';
  }

  categorizeTypingRhythm(intervals) {
    const avgInterval = intervals.reduce((a, b) => a + b, 0) / intervals.length;
    const variance = this.calculateVariance(intervals);

    if (avgInterval < 100 && variance < 50) return 'fast_consistent';
    if (avgInterval < 100) return 'fast_variable';
    if (avgInterval > 300) return 'slow_deliberate';
    if (variance < 50) return 'consistent_moderate';
    return 'variable_moderate';
  }

  calculateAverageInterval(buffer, startIndex, count) {
    if (count < 2) return 0;

    const intervals = [];
    for (let i = startIndex + 1; i < startIndex + count && i < buffer.length; i++) {
      intervals.push(buffer[i].timing - buffer[i-1].timing);
    }

    return intervals.length > 0 ? intervals.reduce((a, b) => a + b, 0) / intervals.length : 0;
  }

  calculateVariance(numbers) {
    if (numbers.length === 0) return 0;
    const mean = numbers.reduce((a, b) => a + b, 0) / numbers.length;
    const squaredDiffs = numbers.map(num => Math.pow(num - mean, 2));
    return squaredDiffs.reduce((a, b) => a + b, 0) / numbers.length;
  }

  calculateSequenceMetadata(buffer) {
    return {
      total_keystrokes: buffer.length,
      unique_keys: new Set(buffer.map(k => k.key)).size,
      sequence_duration: buffer[buffer.length - 1].timing - buffer[0].timing,
      shortcuts_used: buffer.filter(k => k.modifiers.length > 0).length,
      navigation_keys_used: buffer.filter(k =>
        ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Home', 'End', 'PageUp', 'PageDown'].includes(k.key)
      ).length
    };
  }

  aggregateContextData(buffer) {
    // Get unique contexts in this sequence
    const contexts = buffer.map(k => k.context);
    const uniqueApps = new Set(contexts.map(c => c.app_name));

    return {
      apps_involved: Array.from(uniqueApps),
      context_changes: this.detectContextChanges(contexts),
      primary_app: this.findPrimaryApp(contexts)
    };
  }

  detectContextChanges(contexts) {
    const changes = [];
    let currentApp = contexts[0]?.app_name;

    contexts.forEach((context, index) => {
      if (context.app_name !== currentApp) {
        changes.push({
          from_app: currentApp,
          to_app: context.app_name,
          timing: context.timestamp
        });
        currentApp = context.app_name;
      }
    });

    return changes;
  }

  findPrimaryApp(contexts) {
    const appCounts = {};
    contexts.forEach(context => {
      appCounts[context.app_name] = (appCounts[context.app_name] || 0) + 1;
    });

    return Object.keys(appCounts).reduce((a, b) =>
      appCounts[a] > appCounts[b] ? a : b
    );
  }

  generateSequenceId() {
    return `seq_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  resetBuffer() {
    this.buffer = [];
    this.sequenceStart = null;
    this.lastKeystroke = null;
    this.activeModifiers.clear(); // Clear active modifier state
    this.clearTimers();
  }

  startFlushTimer() {
    this.clearTimers();
    this.flushTimer = setTimeout(() => {
      this.flushBuffer('timer');
    }, this.flushInterval);
  }

  resetNaturalBreakTimer() {
    if (this.naturalBreakTimer) {
      clearTimeout(this.naturalBreakTimer);
    }

    this.naturalBreakTimer = setTimeout(() => {
      if (this.buffer.length > 0) {
        this.flushBuffer('natural_break');
      }
    }, this.naturalBreakThreshold);
  }

  clearTimers() {
    if (this.flushTimer) {
      clearTimeout(this.flushTimer);
      this.flushTimer = null;
    }

    if (this.naturalBreakTimer) {
      clearTimeout(this.naturalBreakTimer);
      this.naturalBreakTimer = null;
    }
  }

  flushBufferIfNeeded() {
    if (this.buffer.length >= this.minSequenceLength) {
      this.flushBuffer('shutdown');
    } else {
      this.resetBuffer();
    }
  }

  unregisterKeystrokeListeners() {
    // Cleanup keyboard listener
    if (this.keyboardListener) {
      try {
        this.keyboardListener.kill();
        this.keyboardListener = null;
        console.log('🔌 Keyboard listener destroyed');
      } catch (error) {
        console.error('❌ Error destroying keyboard listener:', error);
      }
    }

    // Unregister all global shortcuts (if any were registered)
    try {
      globalShortcut.unregisterAll();
    } catch (e) {
      // Ignore errors if no shortcuts were registered
    }
  }

  // Public methods for external control
  pause() {
    this.isTracking = false;
    console.log('⏸️ Keystroke tracking paused');
  }

  resume() {
    this.isTracking = true;
    console.log('▶️ Keystroke tracking resumed');
  }

  getBufferStatus() {
    return {
      isTracking: this.isTracking,
      bufferSize: this.buffer.length,
      sequenceAge: this.sequenceStart ? Date.now() - this.sequenceStart : 0,
      currentContext: this.currentContext
    };
  }
}

module.exports = EfficientKeystrokeCollector;

import { globalShortcut, app } from 'electron'
import { GlobalKeyboardListener } from 'node-global-key-listener'

class EfficientKeystrokeCollector {
  constructor(onSequenceReady) {
    this.buffer = [];
    this.sequenceStart = null;
    this.lastKeystroke = null;
    this.onSequenceReady = onSequenceReady;
    this.currentContext = null;
    this.isTracking = false;

    this.maxBufferSize = 100;
    this.flushInterval = 30000;
    this.naturalBreakThreshold = 5000;
    this.minSequenceLength = 5;

    this.flushTimer = null;
    this.naturalBreakTimer = null;

    this.keyboardListener = null;

    this.activeModifiers = new Set();

  }


  startTracking() {
    if (this.isTracking) {
      return;
    }

    this.isTracking = true;

    try {
      this.registerKeystrokeListeners();
    } catch (error) {
      this.isTracking = false;
      console.error('❌ Failed to start keystroke tracking:', error);
    }
  }


  stopTracking() {
    if (!this.isTracking) return;

    this.flushBufferIfNeeded();
    this.clearTimers();
    this.unregisterKeystrokeListeners();
    this.isTracking = false;
  }

  registerKeystrokeListeners() {

    this.setupKeystrokeCapture();
  }




  setupKeystrokeCapture() {
    try {
      if (this.keyboardListener) {
        try { this.keyboardListener.kill(); } catch {}
        this.keyboardListener = null;
      }

      this.keyboardListener = new GlobalKeyboardListener();

      this.lastPhysicalByScan = new Map();
      this.lastPhysicalByKey = new Map();
      this.lastAcceptedByKey = new Map();

      const SCAN_DUP_WINDOW_MS = 35;
      const KEY_MIN_SPACING_MS = 5;

      this.keyboardListener.addListener((e) => {
        if (!this.isTracking) return;

        const now = Date.now();
        let key = e.name || "";
        const state = e.state;


        if (key.startsWith("MOUSE")) {
          
          this.captureKeystroke(key, [], Date.now(), state);

          return;
        }

        if (key === "Space") key = "SPACE";
        if (key === "Return" || key === "Enter") key = "ENTER";
        if (key === "Backspace") key = "BACKSPACE";
        if (key === "Tab") key = "TAB";

        if (key === "LEFT CTRL" || key === "RIGHT CTRL") key = "CTRL";
        if (key === "LEFT SHIFT" || key === "RIGHT SHIFT") key = "SHIFT";
        if (key === "LEFT META" || key === "RIGHT META") key = "CMD";
        if (key === "LEFT ALT" || key === "RIGHT ALT") key = "ALT";

        if (key.length === 1) {
          key = e.shift ? key.toUpperCase() : key.toLowerCase();
        }

        if (["CTRL", "SHIFT", "CMD", "ALT"].includes(key)) {
          if (state === "DOWN") {
            this.activeModifiers.add(key);
          } else if (state === "UP") {
            this.activeModifiers.delete(key);
          }
        }

        const currentModifiers = Array.from(this.activeModifiers);
        const hasScan = Number.isInteger(e.scanCode) && e.scanCode > 0;

        if (state === "DOWN" && hasScan) {
          const lastScanT = this.lastPhysicalByScan.get(e.scanCode) || 0;
          if (now - lastScanT < SCAN_DUP_WINDOW_MS) return;

          const lastKeyT = this.lastAcceptedByKey.get(key) || 0;
          if (now - lastKeyT < KEY_MIN_SPACING_MS) return;

          this.lastPhysicalByScan.set(e.scanCode, now);
          this.lastPhysicalByKey.set(key, now);
          this.lastAcceptedByKey.set(key, now);
        }

        this.captureKeystroke(key, currentModifiers, now, state);
      });

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
      app_name: this.currentContext?.app_name || 'Unknown',
      window_title: this.currentContext?.window_title || ''
    };
  }

  updateContext(context) {
    this.currentContext = context;

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
      this.resetBuffer();
      return;
    }


    const compressedSequence = this.compressSequence(this.buffer);

    if (this.onSequenceReady) {
      this.onSequenceReady(compressedSequence);
    }

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

      keys,
      timings,
      modifiers,
      states,
      down_keys,

      patterns,
      metadata,
      context_data: contextData,

      flush_reason: 'normal',
      created_at: new Date().toISOString()
    };
  }


  detectPatterns(buffer) {
    const repetitivePatterns = this.findRepetitiveSequences(buffer);

    const timingPatterns = this.analyzeTimingPatterns(buffer);

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

    let currentSequence = { key: keys[0], count: 1, start_index: 0 };

    for (let i = 1; i < keys.length; i++) {
      if (keys[i] === currentSequence.key) {
        currentSequence.count++;
      } else {
        if (currentSequence.count >= 3) {
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
        if (currentNav.length >= 2) {
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
    this.activeModifiers.clear();
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
    if (this.keyboardListener) {
      try {
        this.keyboardListener.kill();
        this.keyboardListener = null;
      } catch (error) {
        console.error('❌ Error destroying keyboard listener:', error);
      }
    }

    try {
      globalShortcut.unregisterAll();
    } catch (e) {
    }
  }

  pause() {
    this.isTracking = false;
  }

  resume() {
    this.isTracking = true;
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

export default EfficientKeystrokeCollector

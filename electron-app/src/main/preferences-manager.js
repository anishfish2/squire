/**
 * Local Preferences Manager
 * Stores app-specific preferences locally in userData folder
 * Much faster than database queries and works offline
 */

import { app } from 'electron'
import fs from 'fs'
import path from 'path'

class PreferencesManager {
  constructor() {
    this.preferencesPath = path.join(app.getPath('userData'), 'app-preferences.json')
    this.preferences = this.loadPreferences()
  }

  /**
   * Load preferences from disk
   */
  loadPreferences() {
    try {
      if (fs.existsSync(this.preferencesPath)) {
        const data = fs.readFileSync(this.preferencesPath, 'utf8')
        const prefs = JSON.parse(data)
        console.log(`⚙️  [PreferencesManager] Loaded ${Object.keys(prefs.apps || {}).length} app preferences`)
        console.log(`⚙️  [PreferencesManager] Loaded ${(prefs.detectedApps || []).length} detected apps`)
        return prefs
      }
    } catch (error) {
      console.error('⚙️  [PreferencesManager] Error loading preferences:', error)
    }

    console.log('⚙️  [PreferencesManager] No preferences file, using defaults')
    return { apps: {}, detectedApps: [] }
  }

  /**
   * Save preferences to disk
   */
  savePreferences() {
    try {
      fs.writeFileSync(
        this.preferencesPath,
        JSON.stringify(this.preferences, null, 2),
        'utf8'
      )
      console.log(`⚙️  [PreferencesManager] Saved ${Object.keys(this.preferences.apps || {}).length} app preferences`)
      console.log(`⚙️  [PreferencesManager] Saved ${(this.preferences.detectedApps || []).length} detected apps`)
    } catch (error) {
      console.error('⚙️  [PreferencesManager] Error saving preferences:', error)
    }
  }

  /**
   * Get preference for a specific app
   * Returns default values if not set
   */
  getAppPreference(appName) {
    const normalizedName = appName.toLowerCase()
    const apps = this.preferences.apps || {}

    if (apps[normalizedName]) {
      return {
        ...this.getDefaultPreference(appName),
        ...apps[normalizedName],
        app_name: appName
      }
    }

    return this.getDefaultPreference(appName)
  }

  /**
   * Get all preferences
   */
  getAllPreferences() {
    const apps = this.preferences.apps || {}
    return Object.keys(apps).map(appName => ({
      app_name: appName,
      ...apps[appName]
    }))
  }

  /**
   * Update preference for a specific app
   */
  updateAppPreference(appName, updates) {
    const normalizedName = appName.toLowerCase()

    // Ensure apps object exists
    if (!this.preferences.apps) {
      this.preferences.apps = {}
    }

    // Get existing or create new
    const existing = this.preferences.apps[normalizedName] || this.getDefaultPreference(appName)

    // Merge updates
    this.preferences.apps[normalizedName] = {
      ...existing,
      ...updates,
      updated_at: new Date().toISOString()
    }

    // Save to disk
    this.savePreferences()

    console.log(`⚙️  [PreferencesManager] Updated ${appName}:`, updates)

    return this.preferences.apps[normalizedName]
  }

  /**
   * Delete preference for an app (revert to defaults)
   */
  deleteAppPreference(appName) {
    const normalizedName = appName.toLowerCase()

    if (this.preferences.apps && this.preferences.apps[normalizedName]) {
      delete this.preferences.apps[normalizedName]
      this.savePreferences()
      console.log(`⚙️  [PreferencesManager] Deleted preference for ${appName}`)
    }
  }

  /**
   * Bulk update preferences
   */
  bulkUpdate(updates) {
    updates.forEach(update => {
      const { app_name, ...prefs } = update
      if (app_name) {
        this.updateAppPreference(app_name, prefs)
      }
    })
  }

  /**
   * Add a detected app (stores it for persistence)
   */
  addDetectedApp(appName) {
    if (!this.preferences.detectedApps) {
      this.preferences.detectedApps = []
    }

    const wasNew = !this.preferences.detectedApps.includes(appName)

    if (wasNew) {
      this.preferences.detectedApps.push(appName)

      // Also create default preference entry if it doesn't exist
      const normalizedName = appName.toLowerCase()
      if (!this.preferences.apps) {
        this.preferences.apps = {}
      }

      if (!this.preferences.apps[normalizedName]) {
        this.preferences.apps[normalizedName] = this.getDefaultPreference(appName)
        console.log(`⚙️  [PreferencesManager] Created default preference for: ${appName}`)
      }

      this.savePreferences()
      console.log(`⚙️  [PreferencesManager] Added detected app: ${appName}`)
      return true
    }
    return false
  }

  /**
   * Get all detected apps
   */
  getDetectedApps() {
    return this.preferences.detectedApps || []
  }

  /**
   * Clear all detected apps
   */
  clearDetectedApps() {
    this.preferences.detectedApps = []
    this.savePreferences()
    console.log(`⚙️  [PreferencesManager] Cleared all detected apps`)
  }

  /**
   * Ensure all detected apps have preference entries
   * Call this on startup to sync detected apps with preferences
   */
  syncDetectedAppsWithPreferences() {
    const detectedApps = this.getDetectedApps()
    let created = 0

    detectedApps.forEach(appName => {
      const normalizedName = appName.toLowerCase()

      if (!this.preferences.apps) {
        this.preferences.apps = {}
      }

      if (!this.preferences.apps[normalizedName]) {
        this.preferences.apps[normalizedName] = this.getDefaultPreference(appName)
        created++
      }
    })

    if (created > 0) {
      this.savePreferences()
      console.log(`⚙️  [PreferencesManager] Created ${created} missing preference entries`)
    }
  }

  /**
   * Get default preference values
   */
  getDefaultPreference(appName) {
    return {
      app_name: appName,
      allow_ocr: true,
      allow_vision: true,  // Default to enabled
      allow_screenshots: false,
      ocr_frequency: 'normal',
      vision_frequency: 'normal',
      mask_sensitive_content: false,
      screenshot_retention_days: 30,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
    }
  }

  /**
   * Check if vision is enabled for an app
   */
  isVisionEnabled(appName) {
    const pref = this.getAppPreference(appName)
    return pref.allow_vision === true
  }

  /**
   * Check if screenshots are allowed for an app
   */
  areScreenshotsAllowed(appName) {
    const pref = this.getAppPreference(appName)
    return pref.allow_screenshots === true
  }

  /**
   * Get vision frequency for an app
   */
  getVisionFrequency(appName) {
    const pref = this.getAppPreference(appName)
    return pref.vision_frequency || 'normal'
  }
}

// Singleton instance
const preferencesManager = new PreferencesManager()

export default preferencesManager

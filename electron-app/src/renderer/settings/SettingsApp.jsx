import React, { useState, useEffect, useCallback } from 'react'

const { ipcRenderer } = window.require('electron')

function SettingsApp() {
  const [appPreferences, setAppPreferences] = useState([])
  const [detectedApps, setDetectedApps] = useState(new Set())
  const [searchTerm, setSearchTerm] = useState('')
  const [globalVisionEnabled, setGlobalVisionEnabled] = useState(false)
  const [lastUpdated, setLastUpdated] = useState('Never')
  const [isRefreshing, setIsRefreshing] = useState(false)
  const [preferencesLoaded, setPreferencesLoaded] = useState(false)

  // Load initial data
  useEffect(() => {
    // Request app preferences
    ipcRenderer.send('load-app-preferences')

    // IPC listeners
    const handleDetectedApps = (event, apps) => {
      setDetectedApps(new Set(apps))
    }

    const handleAppPreferencesLoaded = (event, preferences) => {
      setAppPreferences(preferences.sort((a, b) => a.app_name.localeCompare(b.app_name)))
      setPreferencesLoaded(true)

      // Mark all apps from database as detected
      const apps = new Set(preferences.map(p => p.app_name))
      setDetectedApps(apps)

      // Request detected apps
      ipcRenderer.send('get-detected-apps')
    }

    const handlePreferenceUpdated = (event, { appName, updates }) => {
      setAppPreferences(prev => {
        const newPrefs = prev.map(pref =>
          pref.app_name === appName ? { ...pref, ...updates } : pref
        )
        return newPrefs
      })
    }

    const handleAppDetected = (event, { appName, allApps }) => {
      setDetectedApps(new Set(allApps))

      setAppPreferences(prev => {
        const exists = prev.find(p => p.app_name === appName)
        if (!exists && preferencesLoaded) {
          const newPref = {
            app_name: appName,
            allow_ocr: true,
            allow_vision: false,
            allow_screenshots: false,
            ocr_frequency: 'normal',
            vision_frequency: 'low'
          }

          // Save to database
          ipcRenderer.send('update-app-preference', { appName, updates: newPref })

          return [...prev, newPref].sort((a, b) => a.app_name.localeCompare(b.app_name))
        }
        return prev
      })

      updateLastUpdated()
    }

    ipcRenderer.on('detected-apps', handleDetectedApps)
    ipcRenderer.on('app-preferences-loaded', handleAppPreferencesLoaded)
    ipcRenderer.on('preference-updated', handlePreferenceUpdated)
    ipcRenderer.on('app-detected', handleAppDetected)

    return () => {
      ipcRenderer.removeListener('detected-apps', handleDetectedApps)
      ipcRenderer.removeListener('app-preferences-loaded', handleAppPreferencesLoaded)
      ipcRenderer.removeListener('preference-updated', handlePreferenceUpdated)
      ipcRenderer.removeListener('app-detected', handleAppDetected)
    }
  }, [preferencesLoaded])

  const updateLastUpdated = useCallback(() => {
    const now = new Date()
    setLastUpdated(now.toLocaleTimeString())
  }, [])

  const handleClose = () => {
    ipcRenderer.send('close-settings')
  }

  const handleEnableAll = (feature = 'ocr') => {
    appPreferences.forEach(pref => {
      if (feature === 'ocr') {
        ipcRenderer.send('update-app-preference', {
          appName: pref.app_name,
          updates: { allow_ocr: true }
        })
      } else if (feature === 'vision') {
        ipcRenderer.send('update-app-preference', {
          appName: pref.app_name,
          updates: { allow_vision: true, allow_screenshots: true }
        })
      }
    })
  }

  const handleDisableAll = () => {
    appPreferences.forEach(pref => {
      ipcRenderer.send('update-app-preference', {
        appName: pref.app_name,
        updates: { allow_ocr: false, allow_vision: false, allow_screenshots: false }
      })
    })
  }

  const handleRefresh = () => {
    setIsRefreshing(true)
    ipcRenderer.send('get-detected-apps')
    ipcRenderer.send('load-app-preferences')

    setTimeout(() => {
      setIsRefreshing(false)
      updateLastUpdated()
    }, 1000)
  }

  const handleGlobalVisionToggle = (e) => {
    const enabled = e.target.checked
    setGlobalVisionEnabled(enabled)
    ipcRenderer.send('toggle-global-vision', enabled)
  }

  const handleTogglePreference = (appName, key, value) => {
    ipcRenderer.send('update-app-preference', {
      appName,
      updates: { [key]: value }
    })
  }

  const filteredPreferences = appPreferences.filter(pref =>
    pref.app_name.toLowerCase().includes(searchTerm.toLowerCase())
  )

  const stats = {
    total: appPreferences.length,
    ocrEnabled: appPreferences.filter(p => p.allow_ocr).length,
    visionEnabled: appPreferences.filter(p => p.allow_vision).length
  }

  return (
    <div className="w-full h-screen flex flex-col bg-white/[0.08] backdrop-blur-3xl border border-white/20 rounded-2xl shadow-[0_20px_60px_rgba(0,0,0,0.5)]">
      {/* Header */}
      <div className="flex items-center justify-between p-5 border-b border-white/10 [-webkit-app-region:drag]">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 bg-white/10 rounded-lg flex items-center justify-center border border-white/20">
            <span className="text-white text-base font-semibold">S</span>
          </div>
          <div>
            <h1 className="text-white text-base font-semibold m-0">Settings</h1>
            <p className="text-white/50 text-xs m-0">App permissions</p>
          </div>
        </div>
        <button
          onClick={handleClose}
          className="[-webkit-app-region:no-drag] w-7 h-7 rounded-lg bg-white/5 hover:bg-white/10 border border-white/10 flex items-center justify-center text-white/70 hover:text-white transition-all cursor-pointer"
        >
          ✕
        </button>
      </div>

      {/* Main Content */}
      <div className="flex-1 overflow-y-auto p-5 custom-scrollbar">
        {/* Global Controls */}
        <div className="mb-4 bg-white/[0.06] rounded-xl p-4 border border-white/10">
          <h2 className="text-white text-sm font-semibold mb-3 m-0">Quick Actions</h2>

          <div className="flex gap-2 flex-wrap">
            <button
              onClick={() => handleEnableAll('ocr')}
              className="px-3 py-1.5 bg-white/[0.06] hover:bg-white/[0.09] text-white/80 border border-white/10 hover:border-white/20 rounded-lg text-xs font-medium transition-all cursor-pointer"
            >
              Enable All OCR
            </button>
            <button
              onClick={handleDisableAll}
              className="px-3 py-1.5 bg-white/[0.06] hover:bg-white/[0.09] text-white/80 border border-white/10 hover:border-white/20 rounded-lg text-xs font-medium transition-all cursor-pointer"
            >
              Disable All
            </button>
            <button
              onClick={() => handleEnableAll('vision')}
              className="px-3 py-1.5 bg-white/[0.06] hover:bg-white/[0.09] text-white/80 border border-white/10 hover:border-white/20 rounded-lg text-xs font-medium transition-all cursor-pointer"
            >
              Enable Vision (All)
            </button>
            <button
              onClick={handleRefresh}
              disabled={isRefreshing}
              className="px-3 py-1.5 bg-white/[0.06] hover:bg-white/[0.09] text-white/80 border border-white/10 hover:border-white/20 rounded-lg text-xs font-medium transition-all cursor-pointer disabled:opacity-50"
            >
              {isRefreshing ? '🔄 Refreshing...' : '🔄 Refresh Apps'}
            </button>
          </div>

          <div className="mt-3 pt-3 border-t border-white/10">
            <div className="flex items-center justify-between text-xs">
              <span className="text-white/70">Vision Feature</span>
              <label className="relative inline-block w-11 h-6 [-webkit-app-region:no-drag] cursor-pointer">
                <input
                  type="checkbox"
                  checked={globalVisionEnabled}
                  onChange={handleGlobalVisionToggle}
                  className="sr-only peer"
                />
                <div className="w-full h-full bg-white/10 peer-checked:bg-white/20 rounded-full transition-all border border-white/20"></div>
                <div className="absolute left-0.5 top-0.5 w-5 h-5 bg-white rounded-full transition-transform peer-checked:translate-x-5"></div>
              </label>
            </div>
            <p className="text-white/40 text-xs mt-1.5 m-0">Enable vision analysis globally</p>
          </div>
        </div>

        {/* Search Bar */}
        <div className="mb-3">
          <input
            type="text"
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            placeholder="Search apps..."
            className="w-full px-3 py-2 bg-white/[0.06] border border-white/10 rounded-lg text-white text-sm placeholder-white/40 focus:outline-none focus:border-white/20 focus:bg-white/[0.09] transition-all"
          />
        </div>

        {/* App List */}
        <div className="space-y-2">
          {filteredPreferences.length === 0 && appPreferences.length === 0 ? (
            <div className="text-center py-12 text-white/40">
              <div className="text-4xl mb-3">📱</div>
              <p className="text-sm">No apps detected yet</p>
              <p className="text-xs mt-2">Switch between apps to populate this list</p>
            </div>
          ) : filteredPreferences.length === 0 ? (
            <div className="text-center py-8 text-white/40">
              <p className="text-sm">No apps match "{searchTerm}"</p>
            </div>
          ) : (
            filteredPreferences.map(pref => (
              <AppCard
                key={pref.app_name}
                preference={pref}
                isActive={detectedApps.has(pref.app_name)}
                onToggle={handleTogglePreference}
              />
            ))
          )}
        </div>
      </div>

      {/* Footer Stats */}
      <div className="p-3 border-t border-white/10 flex items-center justify-between text-xs">
        <div className="flex gap-3 text-white/50">
          <span>Total: <span className="text-white/80 font-medium">{stats.total}</span></span>
          <span>OCR: <span className="text-white/80 font-medium">{stats.ocrEnabled}</span></span>
          <span>Vision: <span className="text-white/80 font-medium">{stats.visionEnabled}</span></span>
        </div>
        <div className="text-white/30 text-xs">
          <span>Last updated: {lastUpdated}</span>
        </div>
      </div>
    </div>
  )
}

function AppCard({ preference, isActive, onToggle }) {
  return (
    <div className="app-card bg-white/[0.06] hover:bg-white/[0.09] rounded-xl p-3 border border-white/10 transition-all">
      <div className="flex items-center justify-between mb-2.5">
        <div className="flex items-center gap-2">
          <div className="w-7 h-7 bg-white/10 rounded-lg flex items-center justify-center text-sm border border-white/20">
            📱
          </div>
          <div>
            <h3 className="text-white font-medium text-sm m-0">{preference.app_name}</h3>
            {isActive ? (
              <span className="text-white/50 text-xs">● Active</span>
            ) : (
              <span className="text-white/30 text-xs">○</span>
            )}
          </div>
        </div>
      </div>

      <div className="space-y-2">
        {/* OCR Toggle */}
        <div className="flex items-center justify-between">
          <span className="text-white/70 text-xs">OCR</span>
          <label className="relative inline-block w-11 h-6 cursor-pointer">
            <input
              type="checkbox"
              checked={preference.allow_ocr}
              onChange={(e) => onToggle(preference.app_name, 'allow_ocr', e.target.checked)}
              className="sr-only peer"
            />
            <div className="w-full h-full bg-white/10 peer-checked:bg-white/20 rounded-full transition-all border border-white/20"></div>
            <div className="absolute left-0.5 top-0.5 w-5 h-5 bg-white rounded-full transition-transform peer-checked:translate-x-5"></div>
          </label>
        </div>

        {/* Vision Toggle */}
        <div className="flex items-center justify-between">
          <span className="text-white/70 text-xs">Vision</span>
          <label className="relative inline-block w-11 h-6 cursor-pointer">
            <input
              type="checkbox"
              checked={preference.allow_vision}
              onChange={(e) => onToggle(preference.app_name, 'allow_vision', e.target.checked)}
              className="sr-only peer"
            />
            <div className="w-full h-full bg-white/10 peer-checked:bg-white/20 rounded-full transition-all border border-white/20"></div>
            <div className="absolute left-0.5 top-0.5 w-5 h-5 bg-white rounded-full transition-transform peer-checked:translate-x-5"></div>
          </label>
        </div>

        {/* Screenshot Storage Toggle */}
        <div className="flex items-center justify-between">
          <span className="text-white/70 text-xs">Screenshots</span>
          <label className="relative inline-block w-11 h-6 cursor-pointer">
            <input
              type="checkbox"
              checked={preference.allow_screenshots}
              onChange={(e) => onToggle(preference.app_name, 'allow_screenshots', e.target.checked)}
              className="sr-only peer"
            />
            <div className="w-full h-full bg-white/10 peer-checked:bg-white/20 rounded-full transition-all border border-white/20"></div>
            <div className="absolute left-0.5 top-0.5 w-5 h-5 bg-white rounded-full transition-transform peer-checked:translate-x-5"></div>
          </label>
        </div>
      </div>

      {preference.allow_vision && (
        <div className="mt-2 pt-2 border-t border-white/10 text-xs text-white/40">
          Vision costs: ~$0.01-0.03/image
        </div>
      )}
    </div>
  )
}

export default SettingsApp

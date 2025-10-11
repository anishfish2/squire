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
  const [user, setUser] = useState(null)
  const [googleConnected, setGoogleConnected] = useState(false)

  // Check Google connection status
  const checkGoogleConnection = async () => {
    try {
      const token = await ipcRenderer.invoke('get-auth-token')
      if (!token) return

      const response = await fetch('http://127.0.0.1:8000/api/auth/google/status', {
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${token}`
        }
      })

      if (response.ok) {
        const data = await response.json()
        setGoogleConnected(data.connected && data.has_calendar && data.has_gmail)
      }
    } catch (error) {
      console.error('Failed to check Google connection:', error)
    }
  }

  // Load initial data
  useEffect(() => {
    // Request app preferences
    ipcRenderer.send('load-app-preferences')

    // Check Google connection status
    checkGoogleConnection()

    // IPC listeners
    const handleDetectedApps = (event, apps) => {
      setDetectedApps(new Set(apps))
    }

    const handleAppPreferencesLoaded = (event, preferences) => {
      console.log('[Settings] Loaded preferences from backend:', preferences)
      console.log('[Settings] Number of apps:', preferences?.length || 0)

      if (preferences && preferences.length > 0) {
        setAppPreferences(preferences.sort((a, b) => a.app_name.localeCompare(b.app_name)))
        setPreferencesLoaded(true)

        // Mark all apps from database as detected
        const apps = new Set(preferences.map(p => p.app_name))
        setDetectedApps(apps)
      } else {
        console.log('[Settings] No preferences received from backend')
        setPreferencesLoaded(true)
      }

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

  // Load user data and global vision state
  useEffect(() => {
    ipcRenderer.invoke('auth-check').then(({ user }) => {
      setUser(user)
    })

    // Load current global vision state
    ipcRenderer.invoke('get-vision-state').then(state => {
      setGlobalVisionEnabled(state)
    }).catch(err => {
      console.error('[Settings] Failed to get vision state:', err)
    })
  }, [])

  const handleLogout = () => {
    if (confirm('Are you sure you want to log out?')) {
      ipcRenderer.send('auth-signout')
    }
  }

  const handleConnectGoogle = async () => {
    try {
      // Get access token from IPC
      const token = await ipcRenderer.invoke('get-auth-token')
      console.log('🔑 Got token from IPC:', token ? `${token.substring(0, 20)}...` : 'null')

      if (!token) {
        alert('Not logged in. Please log in first.')
        return
      }

      // Request Google OAuth URL from backend
      console.log('📤 Sending request to /api/auth/google/connect')
      const response = await fetch('http://127.0.0.1:8000/api/auth/google/connect', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        }
      })

      console.log('📥 Response status:', response.status)

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${await response.text()}`)
      }

      const data = await response.json()

      if (data.url) {
        // Open OAuth window
        const { shell } = window.require('electron')
        shell.openExternal(data.url)

        // Show notification
        alert('Opening Google consent screen in browser...\nGrant permissions for Calendar and Gmail\n\nAfter completing the flow, this will update automatically.')

        // Poll for connection status after OAuth
        setTimeout(() => checkGoogleConnection(), 3000)
        setTimeout(() => checkGoogleConnection(), 6000)
        setTimeout(() => checkGoogleConnection(), 10000)
      }
    } catch (error) {
      console.error('Failed to connect Google:', error)
      alert(`Failed to connect Google services: ${error.message}`)
    }
  }

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
    <div className="w-full h-screen flex flex-col bg-[#1a1a1a] text-white">
      {/* Header */}
      <div className="flex items-center justify-between px-12 py-4 border-b border-white/10 [-webkit-app-region:drag]">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 bg-white/5 rounded-lg flex items-center justify-center border border-white/10">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-white/80">
              <path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z"></path>
              <circle cx="12" cy="12" r="3"></circle>
            </svg>
          </div>
          <div>
            <h1 className="text-white text-base font-semibold m-0">Settings</h1>
            <p className="text-white/40 text-xs m-0 mt-0.5">App permissions</p>
          </div>
        </div>
        <button
          onClick={handleClose}
          className="[-webkit-app-region:no-drag] w-8 h-8 rounded-lg bg-white/5 hover:bg-white/10 border border-white/10 flex items-center justify-center text-white/50 hover:text-white/90 transition-all cursor-pointer"
        >
          ✕
        </button>
      </div>

      {/* Main Content */}
      <div className="flex-1 overflow-y-auto overflow-x-hidden px-12 py-6 custom-scrollbar max-w-4xl mx-auto w-full">
        {/* User Profile Section */}
        {user ? (
          <>
            <div className="mb-5 bg-white/5 rounded-xl p-5 border border-white/10">
              <div className="flex items-center justify-between">
                <div>
                  <h3 className="text-white font-semibold text-sm m-0">
                    {user.user_metadata?.name || user.email}
                  </h3>
                  <p className="text-white/60 text-xs m-0 mt-1">{user.email}</p>
                </div>
                <button
                  onClick={handleLogout}
                  className="[-webkit-app-region:no-drag] px-4 py-2 text-sm text-red-400 hover:bg-red-500/10 rounded-lg transition-all cursor-pointer border border-red-500/20 hover:border-red-500/40"
                >
                  Log Out
                </button>
              </div>
            </div>

            {/* Google Services Connection */}
            <div className="mb-5 bg-white/5 rounded-xl p-5 border border-white/10">
              <div className="flex items-center justify-between">
                <div>
                  <h3 className="text-white font-semibold text-sm m-0 flex items-center gap-2">
                    📅 Google Calendar & Gmail
                  </h3>
                  <p className="text-white/60 text-xs m-0 mt-1">
                    {googleConnected ? 'Connected - Calendar and Gmail actions enabled' : 'Connect to enable calendar events and email drafts'}
                  </p>
                </div>
                <button
                  onClick={handleConnectGoogle}
                  className={`[-webkit-app-region:no-drag] px-4 py-2 text-sm text-white rounded-lg transition-all cursor-pointer ${
                    googleConnected
                      ? 'bg-green-600 hover:bg-green-700'
                      : 'bg-blue-500 hover:bg-blue-600'
                  }`}
                >
                  {googleConnected ? '✓ Connected' : 'Connect Google'}
                </button>
              </div>
            </div>
          </>
        ) : (
          <div className="mb-5 bg-white/5 rounded-xl p-5 border border-white/10">
            <div className="text-center py-4">
              <h3 className="text-white font-semibold text-sm m-0 mb-2">Not Logged In</h3>
              <p className="text-white/60 text-xs mb-4">Please log in to use Squire</p>
              <button
                onClick={() => ipcRenderer.send('show-login')}
                className="[-webkit-app-region:no-drag] px-6 py-2 text-sm bg-blue-500 hover:bg-blue-600 text-white rounded-lg transition-all cursor-pointer"
              >
                Log In
              </button>
            </div>
          </div>
        )}

        {/* Global Controls */}
        <div className="mb-5 bg-white/5 rounded-xl p-5 border border-white/10">
          <h2 className="text-white text-xs font-semibold mb-4 m-0 uppercase tracking-wide">Quick Actions</h2>

          <div className="grid grid-cols-2 gap-3 mb-4">
            <button
              onClick={() => handleEnableAll('ocr')}
              className="px-3 py-2 bg-white/5 hover:bg-white/10 text-white/70 hover:text-white/90 border border-white/10 hover:border-white/20 rounded-lg text-xs font-medium transition-all cursor-pointer"
            >
              Enable All OCR
            </button>
            <button
              onClick={handleDisableAll}
              className="px-3 py-2 bg-white/5 hover:bg-white/10 text-white/70 hover:text-white/90 border border-white/10 hover:border-white/20 rounded-lg text-xs font-medium transition-all cursor-pointer"
            >
              Disable All
            </button>
            <button
              onClick={() => handleEnableAll('vision')}
              className="px-3 py-2 bg-white/5 hover:bg-white/10 text-white/70 hover:text-white/90 border border-white/10 hover:border-white/20 rounded-lg text-xs font-medium transition-all cursor-pointer"
            >
              Enable Vision (All)
            </button>
            <button
              onClick={handleRefresh}
              disabled={isRefreshing}
              className="px-3 py-2 bg-white/5 hover:bg-white/10 text-white/70 hover:text-white/90 border border-white/10 hover:border-white/20 rounded-lg text-xs font-medium transition-all cursor-pointer disabled:opacity-50"
            >
              {isRefreshing ? '🔄 Refreshing...' : '🔄 Refresh Apps'}
            </button>
          </div>

          <div className="pt-4 border-t border-white/10">
            <div className="flex items-center justify-between text-xs">
              <span className="text-white/60 font-medium">Vision Feature</span>
              <label className="relative inline-block w-9 h-5 [-webkit-app-region:no-drag] cursor-pointer">
                <input
                  type="checkbox"
                  checked={globalVisionEnabled}
                  onChange={handleGlobalVisionToggle}
                  className="sr-only peer"
                />
                <div className="w-full h-full bg-white/10 peer-checked:bg-blue-500/50 rounded-full transition-all border border-white/20"></div>
                <div className="absolute left-0.5 top-0.5 w-4 h-4 bg-white rounded-full transition-transform peer-checked:translate-x-4"></div>
              </label>
            </div>
            <p className="text-white/30 text-xs mt-2 m-0">Enable vision analysis globally</p>
          </div>
        </div>

        {/* Search Bar */}
        <div className="mb-5">
          <input
            type="text"
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            placeholder="Search apps..."
            className="w-full px-4 py-2.5 bg-white/5 border border-white/10 rounded-lg text-white text-sm placeholder-white/30 focus:outline-none focus:border-white/20 focus:bg-white/10 transition-all"
          />
        </div>

        {/* App List */}
        <div className="space-y-4 w-full">
          {filteredPreferences.length === 0 && appPreferences.length === 0 ? (
            <div className="text-center py-12 text-white/30">
              <div className="text-4xl mb-3">📱</div>
              <p className="text-sm font-medium">No apps detected yet</p>
              <p className="text-xs mt-2 text-white/20">Switch between apps to populate this list</p>
            </div>
          ) : filteredPreferences.length === 0 ? (
            <div className="text-center py-8 text-white/30">
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
      <div className="px-12 py-4 border-t border-white/10 flex items-center justify-between text-xs max-w-4xl mx-auto w-full">
        <div className="flex gap-3 text-white/40">
          <span>Total: <span className="text-white/70 font-medium">{stats.total}</span></span>
          <span>OCR: <span className="text-white/70 font-medium">{stats.ocrEnabled}</span></span>
          <span>Vision: <span className="text-white/70 font-medium">{stats.visionEnabled}</span></span>
        </div>
        <div className="text-white/20 text-xs">
          <span>Last updated: {lastUpdated}</span>
        </div>
      </div>
    </div>
  )
}

function AppCard({ preference, isActive, onToggle }) {
  return (
    <div className="app-card bg-white/5 hover:bg-white/[0.08] rounded-xl p-6 border border-white/10 transition-all">
      {/* Header */}
      <div className="flex items-center gap-3 mb-5 pb-4 border-b border-white/10">
        <div className="w-10 h-10 bg-white/5 rounded-lg flex items-center justify-center text-lg border border-white/10 flex-shrink-0">
          📱
        </div>
        <div className="flex-1 min-w-0">
          <h3 className="text-white font-semibold text-base m-0 truncate">{preference.app_name}</h3>
          {isActive ? (
            <span className="text-green-400 text-xs font-medium">● Active</span>
          ) : (
            <span className="text-white/40 text-xs">○ Inactive</span>
          )}
        </div>
      </div>

      {/* Toggles - Vertical Stack */}
      <div className="space-y-3 px-4">
        {/* OCR Toggle */}
        <div className="flex items-center justify-between py-4 px-6 bg-slate-600/30 hover:bg-slate-600/40 rounded-lg transition-all">
          <span className="text-white font-medium text-sm">OCR</span>
          <label className="relative inline-block w-11 h-6 cursor-pointer flex-shrink-0 [-webkit-app-region:no-drag] ml-8">
            <input
              type="checkbox"
              checked={preference.allow_ocr}
              onChange={(e) => onToggle(preference.app_name, 'allow_ocr', e.target.checked)}
              className="sr-only peer"
            />
            <div className="w-full h-full bg-slate-700 peer-checked:bg-slate-500 rounded-full transition-all border-2 border-white/30"></div>
            <div className="absolute left-0.5 top-0.5 w-5 h-5 bg-white rounded-full transition-transform peer-checked:translate-x-5 shadow-lg"></div>
          </label>
        </div>

        {/* Vision Toggle */}
        <div className="flex items-center justify-between py-4 px-6 bg-slate-600/30 hover:bg-slate-600/40 rounded-lg transition-all">
          <span className="text-white font-medium text-sm">Vision</span>
          <label className="relative inline-block w-11 h-6 cursor-pointer flex-shrink-0 [-webkit-app-region:no-drag] ml-8">
            <input
              type="checkbox"
              checked={preference.allow_vision}
              onChange={(e) => onToggle(preference.app_name, 'allow_vision', e.target.checked)}
              className="sr-only peer"
            />
            <div className="w-full h-full bg-slate-700 peer-checked:bg-slate-500 rounded-full transition-all border-2 border-white/30"></div>
            <div className="absolute left-0.5 top-0.5 w-5 h-5 bg-white rounded-full transition-transform peer-checked:translate-x-5 shadow-lg"></div>
          </label>
        </div>

        {/* Screenshots Toggle */}
        <div className="flex items-center justify-between py-4 px-6 bg-slate-600/30 hover:bg-slate-600/40 rounded-lg transition-all">
          <span className="text-white font-medium text-sm">Screenshots</span>
          <label className="relative inline-block w-11 h-6 cursor-pointer flex-shrink-0 [-webkit-app-region:no-drag] ml-8">
            <input
              type="checkbox"
              checked={preference.allow_screenshots}
              onChange={(e) => onToggle(preference.app_name, 'allow_screenshots', e.target.checked)}
              className="sr-only peer"
            />
            <div className="w-full h-full bg-slate-700 peer-checked:bg-slate-500 rounded-full transition-all border-2 border-white/30"></div>
            <div className="absolute left-0.5 top-0.5 w-5 h-5 bg-white rounded-full transition-transform peer-checked:translate-x-5 shadow-lg"></div>
          </label>
        </div>
      </div>

      {preference.allow_vision && (
        <div className="mt-4 pt-4 border-t border-white/10 text-xs text-white/40 text-center">
          💰 Vision costs: ~$0.01-0.03/image
        </div>
      )}
    </div>
  )
}

export default SettingsApp

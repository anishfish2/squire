/**
 * Auth Store - Manages authentication tokens securely using Electron's safeStorage
 */
import { safeStorage, app } from 'electron'
import axios from 'axios'
import fs from 'fs'
import path from 'path'

const API_BASE_URL = process.env.API_BASE_URL || 'http://127.0.0.1:8000'

class AuthStore {
  constructor() {
    this.storePath = path.join(app.getPath('userData'), 'squire-auth.json')
    this.store = {}
    this.currentUser = null
    this.accessToken = null
    this.refreshToken = null
    this.refreshInterval = null  // Periodic token refresh

    // Load existing data
    this.loadStore()
  }

  loadStore() {
    try {
      if (fs.existsSync(this.storePath)) {
        const data = fs.readFileSync(this.storePath, 'utf8')
        this.store = JSON.parse(data)

        // Initialize memory variables from stored data
        if (this.store.user) {
          this.currentUser = this.store.user
          console.log('✅ [AuthStore] Loaded user from disk:', this.currentUser.email)
        }

        // Don't decrypt tokens here - let getAccessToken() and getRefreshToken() do it lazily
        // This avoids issues with safeStorage not being ready yet

        // Schedule initial token refresh check after app is ready
        setTimeout(() => {
          this.checkAndRefreshToken().catch(err => {
            console.error('❌ [AuthStore] Failed to refresh token on startup:', err)
          })
        }, 1000)

        // Start periodic token refresh (every 4 minutes)
        this.startPeriodicRefresh()
      }
    } catch (error) {
      console.error('Failed to load auth store:', error)
      this.store = {}
    }
  }

  /**
   * Check if token needs refresh and refresh if necessary
   */
  async checkAndRefreshToken() {
    const token = this.getAccessToken()
    if (!token) {
      console.log('⚠️ [AuthStore] No token to check')
      return
    }

    try {
      // Try to decode the token to check expiration
      // Note: This is a simple check, not cryptographically secure
      const parts = token.split('.')
      if (parts.length === 3) {
        const payload = JSON.parse(Buffer.from(parts[1], 'base64').toString())
        const expiresAt = payload.exp * 1000 // Convert to milliseconds
        const now = Date.now()
        const timeUntilExpiry = expiresAt - now

        console.log(`🔍 [AuthStore] Token expires in ${Math.round(timeUntilExpiry / 1000)}s`)

        // Refresh if token expires in less than 5 minutes or is already expired
        if (timeUntilExpiry < 5 * 60 * 1000) {
          console.log('🔄 [AuthStore] Token expiring soon, refreshing...')
          await this.refreshAccessToken()
          console.log('✅ [AuthStore] Token refreshed successfully')
        }
      }
    } catch (error) {
      console.error('❌ [AuthStore] Error checking token expiry:', error)
      // If we can't decode the token, try to refresh it anyway
      try {
        console.log('🔄 [AuthStore] Attempting token refresh anyway...')
        await this.refreshAccessToken()
        console.log('✅ [AuthStore] Token refreshed successfully')
      } catch (refreshError) {
        console.error('❌ [AuthStore] Token refresh failed:', refreshError)
      }
    }
  }

  /**
   * Start periodic token refresh (every 4 minutes)
   */
  startPeriodicRefresh() {
    // Clear any existing interval
    if (this.refreshInterval) {
      clearInterval(this.refreshInterval)
    }

    // Check token every 4 minutes
    this.refreshInterval = setInterval(() => {
      console.log('⏰ [AuthStore] Periodic token check...')
      this.checkAndRefreshToken().catch(err => {
        console.error('❌ [AuthStore] Periodic refresh failed:', err)
      })
    }, 4 * 60 * 1000) // 4 minutes

    console.log('✅ [AuthStore] Started periodic token refresh (every 4 minutes)')
  }

  /**
   * Stop periodic token refresh
   */
  stopPeriodicRefresh() {
    if (this.refreshInterval) {
      clearInterval(this.refreshInterval)
      this.refreshInterval = null
      console.log('🛑 [AuthStore] Stopped periodic token refresh')
    }
  }

  saveStore() {
    try {
      fs.writeFileSync(this.storePath, JSON.stringify(this.store, null, 2))
    } catch (error) {
      console.error('Failed to save auth store:', error)
    }
  }

  get(key) {
    return this.store[key]
  }

  set(key, value) {
    this.store[key] = value
    this.saveStore()
  }

  delete(key) {
    delete this.store[key]
    this.saveStore()
  }

  /**
   * Save tokens securely
   */
  setTokens(accessToken, refreshToken, user) {
    try {
      // Encrypt tokens using Electron's safeStorage (only works on macOS/Windows)
      if (safeStorage.isEncryptionAvailable()) {
        const encryptedAccess = safeStorage.encryptString(accessToken)
        const encryptedRefresh = safeStorage.encryptString(refreshToken)

        this.set('access_token', encryptedAccess.toString('base64'))
        this.set('refresh_token', encryptedRefresh.toString('base64'))
      } else {
        // Fallback for Linux or if encryption not available
        this.set('access_token', accessToken)
        this.set('refresh_token', refreshToken)
      }

      this.set('user', user)

      this.accessToken = accessToken
      this.refreshToken = refreshToken
      this.currentUser = user

      // Start periodic refresh for new tokens
      this.startPeriodicRefresh()

      console.log('✅ Tokens saved securely')
      return true
    } catch (error) {
      console.error('❌ Error saving tokens:', error)
      return false
    }
  }

  /**
   * Get access token (decrypt if needed)
   */
  getAccessToken() {
    try {
      if (this.accessToken) {
        console.log('✅ [AuthStore] Returning cached token:', this.accessToken.substring(0, 20) + '...');
        return this.accessToken;
      }

      const stored = this.get('access_token')
      if (!stored) {
        console.error('❌ [AuthStore] No access token stored!');
        console.error('❌ [AuthStore] Store keys:', Object.keys(this.store));
        console.error('❌ [AuthStore] Current user:', this.currentUser);
        return null;
      }

      console.log('🔓 [AuthStore] Decrypting stored token...');

      if (safeStorage.isEncryptionAvailable()) {
        try {
          const buffer = Buffer.from(stored, 'base64')
          this.accessToken = safeStorage.decryptString(buffer)
          console.log('✅ [AuthStore] Token decrypted successfully');
        } catch (decryptError) {
          console.error('❌ [AuthStore] Decryption failed:', decryptError);
          return null;
        }
      } else {
        this.accessToken = stored
        console.log('✅ [AuthStore] Using unencrypted token');
      }

      return this.accessToken
    } catch (error) {
      console.error('❌ [AuthStore] Error getting access token:', error)
      return null
    }
  }

  /**
   * Get refresh token (decrypt if needed)
   */
  getRefreshToken() {
    try {
      if (this.refreshToken) return this.refreshToken

      const stored = this.get('refresh_token')
      if (!stored) return null

      if (safeStorage.isEncryptionAvailable()) {
        const buffer = Buffer.from(stored, 'base64')
        this.refreshToken = safeStorage.decryptString(buffer)
      } else {
        this.refreshToken = stored
      }

      return this.refreshToken
    } catch (error) {
      console.error('❌ Error getting refresh token:', error)
      return null
    }
  }

  /**
   * Get current user
   */
  getUser() {
    if (this.currentUser) return this.currentUser
    this.currentUser = this.get('user')
    return this.currentUser
  }

  /**
   * Check if user is authenticated
   */
  isAuthenticated() {
    return !!this.getAccessToken()
  }

  /**
   * Clear all auth data (logout)
   */
  clearAuth() {
    this.delete('access_token')
    this.delete('refresh_token')
    this.delete('user')

    this.accessToken = null
    this.refreshToken = null
    this.currentUser = null

    // Stop periodic refresh on logout
    this.stopPeriodicRefresh()

    console.log('✅ Auth data cleared')
  }

  /**
   * Refresh access token if expired
   */
  async refreshAccessToken() {
    try {
      const refreshToken = this.getRefreshToken()
      if (!refreshToken) {
        throw new Error('No refresh token available')
      }

      const response = await axios.post(`${API_BASE_URL}/api/auth/refresh`, {
        refresh_token: refreshToken
      })

      if (response.data.access_token) {
        this.setTokens(response.data.access_token, response.data.refresh_token, response.data.user)
        return response.data.access_token
      }

      throw new Error('No access token in refresh response')
    } catch (error) {
      console.error('❌ Token refresh failed:', error.message)
      // If refresh fails, clear auth and require re-login
      this.clearAuth()
      throw error
    }
  }

  /**
   * Sign in with email/password
   */
  async signin(email, password) {
    try {
      console.log('🔐 Signing in...', email)

      const response = await axios.post(`${API_BASE_URL}/api/auth/signin`, {
        email,
        password
      })

      if (response.data.access_token) {
        this.setTokens(
          response.data.access_token,
          response.data.refresh_token,
          response.data.user
        )

        return {
          success: true,
          user: response.data.user
        }
      }

      throw new Error('No access token in response')
    } catch (error) {
      console.error('❌ Signin failed:', error.message)
      throw new Error(error.response?.data?.error || 'Sign in failed')
    }
  }

  /**
   * Sign up with email/password
   */
  async signup(email, password, name) {
    try {
      console.log('📝 Creating account...', email)

      const response = await axios.post(`${API_BASE_URL}/api/auth/signup`, {
        email,
        password,
        name
      })

      if (response.data.access_token) {
        this.setTokens(
          response.data.access_token,
          response.data.refresh_token,
          response.data.user
        )

        return {
          success: true,
          user: response.data.user
        }
      }

      // If confirmation required
      if (response.status === 202) {
        return {
          success: true,
          requiresConfirmation: true,
          message: 'Please check your email to confirm your account'
        }
      }

      throw new Error('Unexpected signup response')
    } catch (error) {
      console.error('❌ Signup failed:', error.message)
      throw new Error(error.response?.data?.error || 'Sign up failed')
    }
  }

  /**
   * Get authenticated axios instance with auto token refresh
   */
  getAuthenticatedAxios() {
    const instance = axios.create({
      baseURL: API_BASE_URL
    })

    // Add token to requests
    instance.interceptors.request.use(
      (config) => {
        const token = this.getAccessToken()
        if (token) {
          config.headers.Authorization = `Bearer ${token}`
        }
        return config
      },
      (error) => Promise.reject(error)
    )

    // Handle token refresh on 401
    instance.interceptors.response.use(
      (response) => response,
      async (error) => {
        const originalRequest = error.config

        if (error.response?.status === 401 && !originalRequest._retry) {
          originalRequest._retry = true

          try {
            const newToken = await this.refreshAccessToken()
            originalRequest.headers.Authorization = `Bearer ${newToken}`
            return instance(originalRequest)
          } catch (refreshError) {
            // Refresh failed, user needs to re-login
            return Promise.reject(refreshError)
          }
        }

        return Promise.reject(error)
      }
    )

    return instance
  }
}

// Export singleton instance
export default new AuthStore()
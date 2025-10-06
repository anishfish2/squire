import React from 'react'
import { createRoot } from 'react-dom/client'
import SettingsApp from './SettingsApp'
import '@/styles.css'

const root = createRoot(document.getElementById('root'))
root.render(<SettingsApp />)

import React from 'react'
import { createRoot } from 'react-dom/client'
import SuggestionsApp from './SuggestionsApp'
import '@/styles.css'

const root = createRoot(document.getElementById('root'))
root.render(<SuggestionsApp />)

import React, { useState, useEffect } from 'react'

const { ipcRenderer } = window.require('electron')

function DebugApp() {
  const [debugData, setDebugData] = useState({
    appName: '-',
    windowTitle: '-',
    ocrLines: '-',
    backendStatus: 'Waiting for app switch...',
    statusType: 'waiting',
    suggestions: '-'
  })

  useEffect(() => {
    const handleDebugUpdate = (event, data) => {
      setDebugData(prev => ({
        appName: data.appName !== undefined ? data.appName : prev.appName,
        windowTitle: data.windowTitle !== undefined ? (data.windowTitle || 'No Title') : prev.windowTitle,
        ocrLines: data.ocrLines !== undefined ? data.ocrLines : prev.ocrLines,
        backendStatus: data.backendStatus !== undefined ? data.backendStatus : prev.backendStatus,
        statusType: data.statusType !== undefined ? data.statusType : prev.statusType,
        suggestions: data.suggestions !== undefined ? data.suggestions : prev.suggestions
      }))
    }

    ipcRenderer.on('debug-update', handleDebugUpdate)

    return () => {
      ipcRenderer.removeListener('debug-update', handleDebugUpdate)
    }
  }, [])

  const handleMouseEnter = () => {
    ipcRenderer.send('debug-set-ignore-mouse-events', false)
  }

  const handleMouseLeave = () => {
    ipcRenderer.send('debug-set-ignore-mouse-events', true, { forward: true })
  }

  return (
    <div
      className="debug-panel bg-gray-900/95 text-white p-5 rounded-xl text-sm font-mono min-w-[280px] border-2 border-white/30 backdrop-blur-xl shadow-[0_12px_40px_rgba(0,0,0,0.8)] [-webkit-app-region:drag]"
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
    >
      <div className="debug-header font-bold text-base mb-3 text-emerald-400 border-b-2 border-white/30 pb-2 cursor-move">
        Squire Debug
      </div>

      <div className="debug-item mb-2 flex justify-between items-center [-webkit-app-region:no-drag]">
        <span className="debug-label text-gray-300 font-medium min-w-[110px]">Current App:</span>
        <span className="debug-value text-white font-semibold text-right max-w-[150px] overflow-hidden text-ellipsis whitespace-nowrap">
          {debugData.appName}
        </span>
      </div>

      <div className="debug-item mb-2 flex justify-between items-center [-webkit-app-region:no-drag]">
        <span className="debug-label text-gray-300 font-medium min-w-[110px]">Window:</span>
        <span className="debug-value text-white font-semibold text-right max-w-[150px] overflow-hidden text-ellipsis whitespace-nowrap">
          {debugData.windowTitle}
        </span>
      </div>

      <div className="debug-item mb-2 flex justify-between items-center [-webkit-app-region:no-drag]">
        <span className="debug-label text-gray-300 font-medium min-w-[110px]">OCR Lines:</span>
        <span className="debug-value text-white font-semibold text-right max-w-[150px] overflow-hidden text-ellipsis whitespace-nowrap">
          {debugData.ocrLines}
        </span>
      </div>

      <div className="debug-item mb-2 flex justify-between items-center [-webkit-app-region:no-drag]">
        <span className="debug-label text-gray-300 font-medium min-w-[110px]">Backend Call:</span>
        <span className={`debug-value text-white font-semibold text-right max-w-[150px] overflow-hidden text-ellipsis whitespace-nowrap status-${debugData.statusType}`}>
          {debugData.backendStatus}
        </span>
      </div>

      <div className="debug-item mb-2 flex justify-between items-center [-webkit-app-region:no-drag]">
        <span className="debug-label text-gray-300 font-medium min-w-[110px]">Suggestions:</span>
        <span className="debug-value text-white font-semibold text-right max-w-[150px] overflow-hidden text-ellipsis whitespace-nowrap">
          {debugData.suggestions}
        </span>
      </div>
    </div>
  )
}

export default DebugApp

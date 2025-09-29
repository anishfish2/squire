// renderer.js
const { ipcRenderer } = require('electron');

// Wait for DOM to load
document.addEventListener('DOMContentLoaded', () => {
  // Get debug panel elements
  window.debugApp = document.getElementById('debug-app');
  window.debugWindow = document.getElementById('debug-window');
  window.debugOcrLines = document.getElementById('debug-ocr-lines');
  window.debugBackendStatus = document.getElementById('debug-backend-status');
  window.debugSuggestions = document.getElementById('debug-suggestions');

  // Initialize debug display
  updateDebugStatus('Waiting for app switch...');
});

// Listen for OCR results from main process
ipcRenderer.on('ocr-results', (event, data) => {
  console.log('Received OCR results:', data);
  handleOCRResults(data.textLines, data.appName, data.windowTitle, data.aiSuggestions);
});

// Listen for debug updates from main process
ipcRenderer.on('debug-update', (event, data) => {
  updateDebugDisplay(data);
});

// Listen for debug panel toggle
ipcRenderer.on('toggle-debug-panel', () => {
  toggleDebugPanel();
});

function handleOCRResults(textLines, appName, windowTitle, aiSuggestions = []) {
  console.log(`OCR for ${appName}: ${textLines.length} lines detected`);

  if (aiSuggestions && aiSuggestions.length > 0) {
    console.log(`🤖 Received ${aiSuggestions.length} AI suggestions:`, aiSuggestions);
    updateOCRText(textLines, aiSuggestions, appName);
    showTextBox();
  } else {
    console.log(`No suggestions received - keeping UI as dot`);
    showDot();
  }
}

function showDot() {
  textBox.classList.add('hidden');
  textBox.classList.remove('visible');
  dot.style.display = 'block';
  isExpanded = false;
}

function showTextBox() {
  dot.style.display = 'none';
  textBox.classList.remove('hidden');
  textBox.classList.add('visible');
  isExpanded = true;
  startIdleTimer();
}

function updateOCRText(textLines, aiSuggestions = [], appName = '') {
  ocrResults.innerHTML = '';

  if (aiSuggestions && aiSuggestions.length > 0) {
    aiSuggestions.forEach((suggestion, index) => {
      const suggestionDiv = document.createElement('div');
      suggestionDiv.className = 'plain-suggestion';
      suggestionDiv.onclick = () => {
        console.log('Clicked suggestion:', suggestion.title);
      };

      const needsGuide = suggestion.content.requires_detailed_guide;
      const guideButton = needsGuide
        ? `<button class="guide-button" onclick="showDetailedGuide(this, ${JSON.stringify(suggestion).replace(/"/g, '&quot;')})">📋 Step-by-step guide</button>`
        : '';

      suggestionDiv.innerHTML = `
        <div class="suggestion-text">${suggestion.content.description}</div>
        ${guideButton}
        <div class="detailed-guide hidden" id="guide-${index}"></div>
      `;
      ocrResults.appendChild(suggestionDiv);
    });
  }
}

function startIdleTimer() {
  clearTimeout(idleTimer);
  idleTimer = setTimeout(() => {
    if (!isHovered && isExpanded) {
      showDot();
    }
  }, 5000);
}

function resetIdleTimer() {
  if (isExpanded) {
    startIdleTimer();
  }
}

// Event listeners with mouse event control
textBox.addEventListener('mouseenter', () => {
  isHovered = true;
  ipcRenderer.send('set-ignore-mouse-events', false);
  resetIdleTimer();
});

textBox.addEventListener('mouseleave', () => {
  isHovered = false;
  ipcRenderer.send('set-ignore-mouse-events', true, { forward: true });
  resetIdleTimer();
});

textBox.addEventListener('click', () => {
  resetIdleTimer();
});

dot.addEventListener('mouseenter', () => {
  ipcRenderer.send('set-ignore-mouse-events', false);
});

dot.addEventListener('mouseleave', () => {
  ipcRenderer.send('set-ignore-mouse-events', true, { forward: true });
});

dot.addEventListener('click', (e) => {
  e.stopPropagation();
  if (ocrResults.innerHTML.trim()) {
    showTextBox();
  }
});

// Function to show detailed implementation guide
async function showDetailedGuide(button, suggestion) {
  console.log('Requesting detailed guide for:', suggestion.title);

  const guideContainer = button.parentElement.querySelector('.detailed-guide');

  if (!guideContainer.classList.contains('hidden')) {
    guideContainer.classList.add('hidden');
    button.textContent = '📋 Step-by-step guide';
    return;
  }

  button.textContent = '⏳ Loading guide...';
  button.disabled = true;

  try {
    const response = await fetch('http://localhost:8000/api/ai/detailed-guide', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ suggestion: suggestion, platform: 'macOS' })
    });

    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }

    const data = await response.json();
    const guide = data.detailed_guide;

    guideContainer.innerHTML = renderDetailedGuide(guide);
    guideContainer.classList.remove('hidden');
    button.textContent = '📋 Hide guide';
  } catch (error) {
    console.error('Error loading detailed guide:', error);
    guideContainer.innerHTML = `
      <div class="guide-error">
        <p>❌ Unable to load detailed guide at this time.</p>
        <p>Please try again or search online for "${suggestion.title}"</p>
      </div>
    `;
    guideContainer.classList.remove('hidden');
    button.textContent = '❌ Guide unavailable';
  } finally {
    button.disabled = false;
  }
}

function renderDetailedGuide(guide) {
  const downloads = guide.preparation?.downloads || [];
  const steps = guide.steps || [];
  const testing = guide.testing || {};
  const optimization = guide.optimization || {};

  let html = `<div class="implementation-guide">`;

  if (downloads.length > 0 || guide.preparation?.prerequisites?.length > 0) {
    html += `
      <div class="guide-section">
        <h4>📋 Preparation</h4>
        ${downloads.map(download => `
          <div class="download-item">
            <strong>${download.name}</strong> (${download.size || 'Unknown size'})
            <br><a href="${download.url}" target="_blank" class="download-link">${download.url}</a>
            <br><small>${download.requirements || ''}</small>
          </div>
        `).join('')}
        ${guide.preparation.prerequisites?.length > 0 ? `
          <div class="prerequisites">
            <strong>Prerequisites:</strong>
            <ul>${guide.preparation.prerequisites.map(req => `<li>${req}</li>`).join('')}</ul>
          </div>
        ` : ''}
      </div>
    `;
  }

  html += `
    <div class="guide-section">
      <h4>🔧 Implementation Steps</h4>
      <div class="estimated-time">⏱️ Estimated time: ${guide.estimated_time || 'Unknown'}</div>
  `;

  steps.forEach(step => {
    html += `
      <div class="implementation-step">
        <div class="step-header">
          <span class="step-number">${step.step_number}</span>
          <span class="step-title">${step.title}</span>
        </div>
        <div class="step-description">${step.description}</div>
        <div class="step-actions">
          ${step.actions?.map(action => `
            <div class="action-item">
              <span class="action-type">${action.type}</span>
              <span class="action-instruction">${action.instruction}</span>
              ${action.details ? `<div class="action-details">${action.details}</div>` : ''}
              ${action.shortcut ? `<div class="action-shortcut">💻 ${action.shortcut}</div>` : ''}
            </div>
          `).join('') || ''}
        </div>
        ${step.verification ? `<div class="step-verification">✅ Verify: ${step.verification}</div>` : ''}
        ${step.troubleshooting ? `<div class="step-troubleshooting">⚠️ Troubleshooting: ${step.troubleshooting}</div>` : ''}
      </div>
    `;
  });

  html += `</div>`;

  if (testing.how_to_test) {
    html += `
      <div class="guide-section">
        <h4>🧪 Testing & Verification</h4>
        <div class="testing-info">
          <p><strong>How to test:</strong> ${testing.how_to_test}</p>
          <p><strong>Expected result:</strong> ${testing.expected_result}</p>
          ${testing.common_issues?.length > 0 ? `
            <p><strong>Common issues:</strong></p>
            <ul>${testing.common_issues.map(issue => `<li>${issue}</li>`).join('')}</ul>
          ` : ''}
        </div>
      </div>
    `;
  }

  if (optimization.power_tips?.length > 0 || optimization.advanced_settings?.length > 0) {
    html += `
      <div class="guide-section">
        <h4>⚡ Optimization Tips</h4>
        ${optimization.power_tips?.length > 0 ? `
          <div class="power-tips">
            <strong>Power Tips:</strong>
            <ul>${optimization.power_tips.map(tip => `<li>${tip}</li>`).join('')}</ul>
          </div>
        ` : ''}
        ${optimization.advanced_settings?.length > 0 ? `
          <div class="advanced-settings">
            <strong>Advanced Settings:</strong>
            <ul>${optimization.advanced_settings.map(setting => `<li>${setting}</li>`).join('')}</ul>
          </div>
        ` : ''}
      </div>
    `;
  }

  html += `</div>`;
  return html;
}

// Debug display functions
function updateDebugDisplay(data) {
  if (data.appName && window.debugApp) {
    window.debugApp.textContent = data.appName;
    window.debugApp.className = 'debug-value';
  }
  if (data.windowTitle && window.debugWindow) {
    window.debugWindow.textContent = data.windowTitle || 'No Title';
    window.debugWindow.className = 'debug-value';
  }
  if (data.ocrLines !== undefined && window.debugOcrLines) {
    window.debugOcrLines.textContent = data.ocrLines;
    window.debugOcrLines.className = 'debug-value';
  }
  if (data.backendStatus) {
    updateDebugStatus(data.backendStatus, data.statusType);
  }
  if (data.suggestions !== undefined && window.debugSuggestions) {
    window.debugSuggestions.textContent = data.suggestions;
    window.debugSuggestions.className = 'debug-value';
  }
}

function updateDebugStatus(status, type = 'waiting') {
  if (window.debugBackendStatus) {
    window.debugBackendStatus.textContent = status;
    window.debugBackendStatus.className = `debug-value status-${type}`;
  }
}

function toggleDebugPanel() {
  const debugPanel = document.getElementById('debug-panel');
  debugPanel.style.display = (debugPanel.style.display === 'none') ? 'block' : 'none';
}



// Make function available globally
window.showDetailedGuide = showDetailedGuide;

// Initialize when DOM is loaded
document.addEventListener('DOMContentLoaded', () => {
  init();

});


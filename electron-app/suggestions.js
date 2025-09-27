// suggestions.js
const { ipcRenderer } = require('electron');

// UI state variables
let isExpanded = false;
let isHovered = false;
let idleTimer;

// DOM elements
let dot, textBox, ocrResults;

// Wait for DOM to load
document.addEventListener('DOMContentLoaded', () => {
  dot = document.getElementById('dot');
  textBox = document.getElementById('text-box');
  ocrResults = document.getElementById('ocr-results');
});

// Listen for OCR results from main process
ipcRenderer.on('ocr-results', (event, data) => {
  console.log('Received OCR results:', data);
  handleOCRResults(data.textLines, data.appName, data.windowTitle, data.aiSuggestions);
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
  if (textBox && dot) {
    textBox.classList.add('hidden');
    textBox.classList.remove('visible');
    dot.style.display = 'block';
    isExpanded = false;
  }
}

function showTextBox() {
  if (textBox && dot) {
    dot.style.display = 'none';
    textBox.classList.remove('hidden');
    textBox.classList.add('visible');
    isExpanded = true;
    startIdleTimer();
  }
}

function updateOCRText(textLines, aiSuggestions = [], appName = '') {
  if (!ocrResults) return;

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

// Set up event listeners after DOM load
document.addEventListener('DOMContentLoaded', () => {
  // Text box event listeners
  if (textBox) {
    textBox.addEventListener('mouseenter', () => {
      isHovered = true;
      ipcRenderer.send('suggestions-set-ignore-mouse-events', false);
      resetIdleTimer();
    });

    textBox.addEventListener('mouseleave', () => {
      isHovered = false;
      ipcRenderer.send('suggestions-set-ignore-mouse-events', true, { forward: true });
      resetIdleTimer();
    });

    textBox.addEventListener('click', () => {
      resetIdleTimer();
    });
  }

  // Dot event listeners
  if (dot) {
    dot.addEventListener('mouseenter', () => {
      ipcRenderer.send('suggestions-set-ignore-mouse-events', false);
    });

    dot.addEventListener('mouseleave', () => {
      ipcRenderer.send('suggestions-set-ignore-mouse-events', true, { forward: true });
    });

    dot.addEventListener('click', (e) => {
      e.stopPropagation();
      if (ocrResults && ocrResults.innerHTML.trim()) {
        showTextBox();
      }
    });
  }
});

// Global function for guide buttons
window.showDetailedGuide = function(button, suggestion) {
  console.log('Showing detailed guide for:', suggestion.title);
  // Add your detailed guide implementation here
};
// suggestions.js
const { ipcRenderer } = require('electron');

// UI state variables
let isExpanded = false;
let isHovered = false;
let idleTimer;

// Drag state
let isDragging = false;

// DOM elements
let dot, textBox, ocrResults;

// Wait for DOM to load
document.addEventListener('DOMContentLoaded', () => {
  dot = document.getElementById('dot');
  textBox = document.getElementById('text-box');
  ocrResults = document.getElementById('ocr-results');

  console.log('DOM loaded. Elements found:', {
    dot: !!dot,
    textBox: !!textBox,
    ocrResults: !!ocrResults
  });

  console.log('TextBox element:', textBox);
  console.log('TextBox classes:', textBox?.className);
  console.log('TextBox style display:', textBox?.style.display);

  // Initialize drag listeners
  if (textBox) {
    textBox.addEventListener('mousedown', onBoxMouseDown);
  }

  if (dot) {
    dot.addEventListener('mousedown', onDotMouseDown);
  }

  document.addEventListener('mousemove', onMouseMove);
  document.addEventListener('mouseup', onMouseUp);
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
      suggestionDiv.className = 'bg-white/[0.06] text-white p-3 mb-3 rounded-xl font-sans border border-white/10 shadow-[0_4px_12px_rgba(0,0,0,0.2),inset_0_1px_1px_rgba(255,255,255,0.08)] backdrop-blur-xl max-w-[380px] transition-all duration-200 ease-out';

      const shortDesc = suggestion.content.short_description || suggestion.title;
      const needsGuide = suggestion.content.requires_detailed_guide;

      // Create collapsible suggestion UI
      suggestionDiv.innerHTML = `
        <div class="short-view cursor-pointer" onclick="toggleSuggestion(${index})">
          <div class="flex items-start justify-between gap-2">
            <p class="text-sm text-white/90 leading-snug flex-1">${shortDesc}</p>
            <span class="expand-icon text-white/50 text-xs">▼</span>
          </div>
        </div>

        <div class="full-view hidden mt-3 pt-3 border-t border-white/10" id="suggestion-details-${index}">
          <h3 class="m-0 mb-2 text-base font-semibold text-white/95">${suggestion.title}</h3>
          <p class="text-sm mb-3 text-white/75 leading-snug">${suggestion.content.description}</p>

          <div class="text-xs space-y-1 text-white/70 mb-3">
            <div class="flex gap-1.5"><span class="text-white/50 min-w-[70px]">Benefit:</span><span class="text-white/80">${suggestion.content.expected_benefit || '—'}</span></div>
            <div class="flex gap-1.5"><span class="text-white/50 min-w-[70px]">Difficulty:</span><span class="text-white/80">${suggestion.content.difficulty || '—'}</span></div>
            <div class="flex gap-1.5"><span class="text-white/50 min-w-[70px]">Time:</span><span class="text-white/80">${suggestion.content.time_investment || '—'}</span></div>
            ${(suggestion.content.platforms || []).length > 0 ? `<div class="flex gap-1.5"><span class="text-white/50 min-w-[70px]">Platforms:</span><span class="text-white/80">${suggestion.content.platforms.join(', ')}</span></div>` : ''}
            ${(suggestion.content.tools_needed || []).length > 0 ? `<div class="flex gap-1.5"><span class="text-white/50 min-w-[70px]">Tools:</span><span class="text-white/80">${suggestion.content.tools_needed.join(', ')}</span></div>` : ''}
          </div>

          ${(suggestion.content.action_steps || []).length > 0 ? `
            <div class="text-xs mb-3">
              <div class="font-medium text-white/90 mb-1">Action Steps:</div>
              <ul class="ml-4 space-y-0.5 text-white/75">
                ${suggestion.content.action_steps.map(step => `<li class="leading-snug">${step}</li>`).join('')}
              </ul>
            </div>
          ` : ''}

          ${needsGuide ? `<button class="mt-2 px-3 py-1.5 text-xs bg-white/10 text-white/90 border border-white/20 rounded-lg cursor-pointer hover:bg-white/15 hover:border-white/30 font-medium shadow-sm transition-all hover:shadow-md" onclick="event.stopPropagation(); showDetailedGuide(this, ${JSON.stringify(suggestion).replace(/"/g, '&quot;')})">📋 Step-by-step guide</button>` : ''}

          <div class="hidden mt-2.5 p-2.5 bg-white/5 rounded-lg border-l-2 border-l-white/20 max-h-[300px] overflow-y-auto" id="guide-${index}"></div>
        </div>
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

// Toggle suggestion expansion
window.toggleSuggestion = function(index) {
  const detailsDiv = document.getElementById(`suggestion-details-${index}`);
  const shortView = detailsDiv.previousElementSibling;
  const icon = shortView.querySelector('.expand-icon');

  if (detailsDiv.classList.contains('hidden')) {
    detailsDiv.classList.remove('hidden');
    icon.textContent = '▲';
  } else {
    detailsDiv.classList.add('hidden');
    icon.textContent = '▼';
  }
};

// Global function for guide buttons
window.showDetailedGuide = function(button, suggestion) {
  console.log('Showing detailed guide for:', suggestion.title);
  // Add your detailed guide implementation here
};

// ===== SIMPLE DRAG FUNCTIONALITY =====

let dragState = {
  isDragging: false,
  startX: 0,
  startY: 0,
  startBoxX: 0,
  startBoxY: 0,
  clickStartTime: 0,
  clickStartPos: { x: 0, y: 0 }
};

function onBoxMouseDown(e) {
  // Only allow dragging if not clicking on interactive elements or content
  if (e.target.tagName === 'BUTTON' || e.target.closest('button')) return;
  if (e.target.closest('.short-view')) return; // Allow clicking to expand
  if (e.target.closest('.full-view')) return; // Allow interaction with expanded details

  // Allow all interaction within text-content area (clicking, scrolling, selecting text)
  if (e.target.closest('.text-content')) {
    // Check if this is specifically on a scrollable container
    const scrollContainer = e.target.closest('.text-content');
    if (scrollContainer && scrollContainer.scrollHeight > scrollContainer.clientHeight) {
      return; // Allow scrolling
    }
  }

  // Ensure mouse events are not ignored during drag
  ipcRenderer.send('suggestions-set-ignore-mouse-events', false);

  dragState.isDragging = true;
  dragState.startX = e.screenX;
  dragState.startY = e.screenY;
  dragState.clickStartTime = Date.now();
  dragState.clickStartPos = { x: e.screenX, y: e.screenY };

  // Get the actual screen position of the window
  dragState.startBoxX = e.screenX - e.clientX;
  dragState.startBoxY = e.screenY - e.clientY;

  e.preventDefault();
  e.stopPropagation();
}

function onDotMouseDown(e) {
  // Ensure mouse events are not ignored during drag
  ipcRenderer.send('suggestions-set-ignore-mouse-events', false);

  dragState.isDragging = true;
  dragState.startX = e.screenX;
  dragState.startY = e.screenY;
  dragState.clickStartTime = Date.now();
  dragState.clickStartPos = { x: e.screenX, y: e.screenY };

  // Get the actual screen position of the window
  dragState.startBoxX = e.screenX - e.clientX;
  dragState.startBoxY = e.screenY - e.clientY;

  e.preventDefault();
  e.stopPropagation();
}

function onMouseMove(e) {
  if (!dragState.isDragging) return;

  const deltaX = e.screenX - dragState.startX;
  const deltaY = e.screenY - dragState.startY;

  // Calculate new window position in screen coordinates
  const newScreenX = dragState.startBoxX + deltaX;
  const newScreenY = dragState.startBoxY + deltaY;

  // Move the actual Electron window
  ipcRenderer.send('move-suggestions-window', newScreenX, newScreenY);
}

function onMouseUp(e) {
  if (!dragState.isDragging) return;

  // Check if it was a click (not a drag)
  const timeDiff = Date.now() - dragState.clickStartTime;
  const distance = Math.sqrt(
    Math.pow(e.screenX - dragState.clickStartPos.x, 2) +
    Math.pow(e.screenY - dragState.clickStartPos.y, 2)
  );

  dragState.isDragging = false;

  // If it was a quick click with minimal movement, treat as click
  if (timeDiff < 200 && distance < 5) {
    // Let the click event handler deal with it
    return;
  }
}

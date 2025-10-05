// suggestions.js
const { ipcRenderer } = require('electron');

// UI state variables
let isExpanded = false;
let isHovered = false;
let idleTimer;

// Drag state
let isDragging = false;

// DOM elements
let dot, textBox, aiSuggestionsElement;

// Wait for DOM to load
document.addEventListener('DOMContentLoaded', () => {
  console.log('🎬 DOM loaded - initializing suggestions window');

  dot = document.getElementById('dot');
  textBox = document.getElementById('text-box');
  aiSuggestionsElement = document.getElementById('ai-suggestions');

  console.log('   Elements found:', {
    dot: !!dot,
    textBox: !!textBox,
    aiSuggestionsElement: !!aiSuggestionsElement
  });

  // CRITICAL: Start with click-through ENABLED (dot mode)
  console.log('🔧 Initializing click-through: ENABLED (dot mode)');
  ipcRenderer.send('suggestions-set-ignore-mouse-events', true, { forward: true });

  // Add global mouse event listener for debugging
  document.body.addEventListener('mouseenter', () => {
    console.log('🌍 BODY mouseenter detected');
  });
  document.body.addEventListener('mousemove', (e) => {
    // Only log occasionally to avoid spam
    if (Math.random() < 0.01) {
      console.log('🌍 BODY mousemove at', e.clientX, e.clientY);
    }
  });

  console.log('TextBox element:', textBox);
  console.log('TextBox classes:', textBox?.className);
  console.log('TextBox style display:', textBox?.style.display);

  // Add debug listener to ai-suggestions
  if (aiSuggestionsElement) {
    aiSuggestionsElement.addEventListener('click', (e) => {
      console.log('🎯 AI Suggestions clicked!', e.target);
      console.log('  Target classes:', e.target.className);
      console.log('  Target closest .short-view:', e.target.closest('.short-view'));
    }, true); // Use capture phase
  }

  // Add mouse enter/leave to dot and textBox to control click-through
  if (dot) {
    dot.addEventListener('mouseenter', () => {
      console.log('🔵 Dot mouseenter - clickable');
      ipcRenderer.send('suggestions-set-ignore-mouse-events', false);
    });

    dot.addEventListener('mouseleave', () => {
      console.log('🔵 Dot mouseleave - click-through enabled');
      ipcRenderer.send('suggestions-set-ignore-mouse-events', true, { forward: true });
    });

    dot.addEventListener('click', (e) => {
      console.log('🔵 Dot clicked!');
      e.stopPropagation();
      if (aiSuggestionsElement && aiSuggestionsElement.innerHTML.trim()) {
        showTextBox();
      }
    });
  }

  if (textBox) {
    textBox.addEventListener('mouseenter', () => {
      console.log('📦 TextBox mouseenter - DISABLING click-through');
      isHovered = true;
      ipcRenderer.send('suggestions-set-ignore-mouse-events', false);
      console.log('   Sent IPC: suggestions-set-ignore-mouse-events = false');
      resetIdleTimer();
    });

    textBox.addEventListener('mousemove', () => {
      if (!isHovered) {
        console.log('📦 TextBox mousemove but not hovered - re-disabling click-through');
        isHovered = true;
        ipcRenderer.send('suggestions-set-ignore-mouse-events', false);
      }
      resetIdleTimer();
    });

    textBox.addEventListener('mouseleave', () => {
      console.log('📦 TextBox mouseleave - ENABLING click-through');
      isHovered = false;
      ipcRenderer.send('suggestions-set-ignore-mouse-events', true, { forward: true });
      console.log('   Sent IPC: suggestions-set-ignore-mouse-events = true');
      resetIdleTimer();
    });

    textBox.addEventListener('click', (e) => {
      console.log('📦 TextBox CLICKED!', e.target);
      resetIdleTimer();
    });

    // Add explicit test to see if clicks are being received
    textBox.addEventListener('mousedown', (e) => {
      // Only log if NOT starting a drag
      if (!e.target.closest('#ai-suggestions')) {
        console.log('📦 TextBox MOUSEDOWN (drag area)', e.target);
      }
    });
  }
  // Initialize drag listeners
  if (textBox) textBox.addEventListener('mousedown', onBoxMouseDown);
  if (dot) dot.addEventListener('mousedown', onDotMouseDown);

  document.addEventListener('mousemove', onMouseMove);
  document.addEventListener('mouseup', onMouseUp);
});

// Listen for AI suggestions from main process
ipcRenderer.on('ai-suggestions', (event, data) => {
  console.log('Received AI suggestions:', data);
  handleAISuggestions(data.textLines, data.appName, data.windowTitle, data.aiSuggestions);
});

function handleAISuggestions(textLines, appName, windowTitle, aiSuggestions = []) {
  console.log(`AI suggestions for ${appName}: ${textLines.length} OCR lines, ${aiSuggestions?.length || 0} suggestions`);

  if (aiSuggestions && aiSuggestions.length > 0) {
    console.log(`🤖 Received ${aiSuggestions.length} AI suggestions:`, aiSuggestions);
    updateSuggestionsDisplay(textLines, aiSuggestions, appName);
    showTextBox();
  } else {
    console.log(`No suggestions received - keeping UI as dot`);
    showDot();
  }
}

function showDot() {
  console.log('🔴 showDot() called');
  if (textBox && dot) {
    // Hide textbox, show dot
    textBox.style.display = 'none';
    dot.style.display = 'flex';

    // Enable click-through
    ipcRenderer.send('suggestions-set-ignore-mouse-events', true, { forward: true });

    isExpanded = false;
    console.log('  ✅ Dot visible, textbox hidden');
  }
}

function showTextBox() {
  console.log('🟢 showTextBox() called');
  if (textBox && dot) {
    // Hide dot, show textbox
    dot.style.display = 'none';
    textBox.style.display = 'block';
    textBox.style.visibility = 'visible';
    textBox.style.opacity = '1';
    textBox.style.transform = 'scale(1)';
    textBox.classList.remove('hidden');
    textBox.classList.add('visible');

    // Disable click-through
    ipcRenderer.send('suggestions-set-ignore-mouse-events', false);

    isExpanded = true;
    startIdleTimer();
    console.log('  ✅ Textbox visible, dot hidden');
  }
}


function updateSuggestionsDisplay(textLines, aiSuggestions = [], appName = '') {
  console.log('📝 updateSuggestionsDisplay called with', aiSuggestions.length, 'suggestions');
  if (!aiSuggestionsElement) {
    console.error('❌ aiSuggestionsElement not found!');
    return;
  }
  aiSuggestionsElement.innerHTML = '';

  if (aiSuggestions && aiSuggestions.length > 0) {
    aiSuggestions.forEach((suggestion, index) => {
      console.log(`📄 Creating suggestion ${index}:`, suggestion.title);
      const suggestionDiv = document.createElement('div');
      suggestionDiv.className = 'bg-white/[0.05] text-white p-3 rounded-xl border border-white/20 shadow-[0_8px_24px_rgba(0,0,0,0.4)] transition-all duration-200 ease-out';

      const shortDesc = suggestion.content.short_description || suggestion.title;
      const needsGuide = suggestion.content.requires_detailed_guide;
      console.log(`   Short desc: "${shortDesc}"`);
      console.log(`   Needs guide: ${needsGuide}`);

      // Create collapsible suggestion UI with better styling
      suggestionDiv.innerHTML = `
        <div class="short-view cursor-pointer rounded-lg p-2 -m-2 transition-all"
             style="background: rgba(59, 130, 246, 0.15); border: 2px solid rgba(96, 165, 250, 0.4);"
             onmouseenter="this.style.background='rgba(59, 130, 246, 0.25)'"
             onmouseleave="this.style.background='rgba(59, 130, 246, 0.15)'"
             data-index="${index}">
          <div class="flex items-center justify-between gap-3">
            <p class="text-[13px] text-white/95 leading-relaxed flex-1 font-medium">${shortDesc}</p>
            <span class="expand-icon text-xs shrink-0 font-bold" style="color: #60a5fa;">▼</span>
          </div>
        </div>

        <div class="full-view hidden mt-3 pt-3 border-t border-white/20" id="suggestion-details-${index}">
          <h3 class="m-0 mb-2 text-sm font-semibold text-white tracking-tight">${suggestion.title}</h3>
          <p class="text-[13px] mb-3 text-white/85 leading-relaxed">${suggestion.content.description}</p>

          <div class="text-[11px] space-y-1.5 text-white/70 mb-3 bg-white/[0.05] rounded-lg p-2.5">
            <div class="flex gap-2"><span class="text-white/50 min-w-[65px] font-medium">Benefit:</span><span class="text-white/85">${suggestion.content.expected_benefit || '—'}</span></div>
            <div class="flex gap-2"><span class="text-white/50 min-w-[65px] font-medium">Difficulty:</span><span class="text-white/85">${suggestion.content.difficulty || '—'}</span></div>
            <div class="flex gap-2"><span class="text-white/50 min-w-[65px] font-medium">Time:</span><span class="text-white/85">${suggestion.content.time_investment || '—'}</span></div>
            ${(suggestion.content.platforms || []).length > 0 ? `<div class="flex gap-2"><span class="text-white/50 min-w-[65px] font-medium">Platforms:</span><span class="text-white/85">${suggestion.content.platforms.join(', ')}</span></div>` : ''}
            ${(suggestion.content.tools_needed || []).length > 0 ? `<div class="flex gap-2"><span class="text-white/50 min-w-[65px] font-medium">Tools:</span><span class="text-white/85">${suggestion.content.tools_needed.join(', ')}</span></div>` : ''}
          </div>

          ${(suggestion.content.action_steps || []).length > 0 ? `
            <div class="text-[12px] mb-3">
              <div class="font-semibold text-white/90 mb-2">Steps:</div>
              <ul class="ml-4 space-y-1.5 text-white/80">
                ${suggestion.content.action_steps.map(step => `<li class="leading-relaxed">${step}</li>`).join('')}
              </ul>
            </div>
          ` : ''}

          ${needsGuide ? `<button class="guide-button mt-2 px-3 py-2 text-[11px] bg-white/15 text-white border border-white/25 rounded-lg cursor-pointer hover:bg-white/20 hover:border-white/35 font-medium shadow-sm transition-all hover:shadow-md" data-suggestion='${JSON.stringify(suggestion)}'>📋 Detailed Guide</button>` : ''}

          <div class="hidden mt-3 p-3 bg-white/[0.08] rounded-lg border border-white/20 max-h-[300px] overflow-y-auto" id="guide-${index}"></div>
        </div>
      `;

      // Add click event listener for toggle
      const shortView = suggestionDiv.querySelector('.short-view');
      if (shortView) {
        console.log('🔧 Attaching click listener to short-view', index);

        // Add multiple event listeners for debugging
        shortView.addEventListener('mousedown', (e) => {
          console.log('🖱️ Short-view MOUSEDOWN', index, 'target:', e.target.className);
        });

        shortView.addEventListener('mouseup', (e) => {
          console.log('🖱️ Short-view MOUSEUP', index, 'target:', e.target.className);
        });

        shortView.addEventListener('click', (e) => {
          console.log('🖱️ Short-view CLICK!', index, 'target:', e.target);
          console.log('   Event phase:', e.eventPhase);
          console.log('   Current target:', e.currentTarget);
          console.log('   Pointer events:', window.getComputedStyle(shortView).pointerEvents);
          e.preventDefault();
          e.stopPropagation();
          window.toggleSuggestion(index);
        });
      } else {
        console.error('❌ Could not find .short-view for suggestion', index);
      }

      // Add click event listener for guide button
      const guideButton = suggestionDiv.querySelector('.guide-button');
      if (guideButton) {
        guideButton.addEventListener('click', (e) => {
          e.stopPropagation();
          const suggestionData = JSON.parse(guideButton.getAttribute('data-suggestion'));
          window.showDetailedGuide(guideButton, suggestionData);
        });
      }

      aiSuggestionsElement.appendChild(suggestionDiv);
      console.log(`✅ Appended suggestion ${index} to DOM`);

      // Verify the element is actually in the DOM
      const verifyShortView = document.querySelector(`[data-index="${index}"]`);
      console.log(`   Verification: short-view in DOM?`, !!verifyShortView);
      if (verifyShortView) {
        console.log(`   Computed styles: display=${window.getComputedStyle(verifyShortView).display}, pointerEvents=${window.getComputedStyle(verifyShortView).pointerEvents}`);
      }
    });

    console.log(`📊 Total suggestions in aiSuggestionsElement:`, aiSuggestionsElement.children.length);
  }
}


function startIdleTimer() {
  clearTimeout(idleTimer);
  idleTimer = setTimeout(() => {
    console.log('⏱️ Idle timer fired. isHovered:', isHovered, 'isExpanded:', isExpanded);
    if (!isHovered && isExpanded) {
      console.log('  Hiding due to idle timeout');
      showDot();
    }
  }, 5000);
}

function resetIdleTimer() {
  console.log('🔄 Reset idle timer. isExpanded:', isExpanded);
  if (isExpanded) {
    startIdleTimer();
  }
}


// Toggle suggestion expansion
window.toggleSuggestion = function(index) {
  console.log('🔄 toggleSuggestion called for index:', index);
  const detailsDiv = document.getElementById(`suggestion-details-${index}`);
  const shortView = detailsDiv?.previousElementSibling;
  const icon = shortView?.querySelector('.expand-icon');

  console.log('  detailsDiv:', detailsDiv);
  console.log('  shortView:', shortView);
  console.log('  icon:', icon);
  console.log('  currently hidden:', detailsDiv?.classList.contains('hidden'));

  if (!detailsDiv) {
    console.error('  ❌ Could not find details div for index:', index);
    return;
  }

  if (detailsDiv.classList.contains('hidden')) {
    detailsDiv.classList.remove('hidden');
    if (icon) icon.textContent = '▲';
    console.log('  ✅ Expanded suggestion', index);
  } else {
    detailsDiv.classList.add('hidden');
    if (icon) icon.textContent = '▼';
    console.log('  ✅ Collapsed suggestion', index);
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
  console.log('📦 Box mousedown:', e.target);
  console.log('  Target element:', e.target.tagName, e.target.className);
  console.log('  Closest ai-suggestions:', e.target.closest('#ai-suggestions'));

  // Don't start dragging if clicking on suggestions or interactive elements
  if (e.target.closest('#ai-suggestions')) {
    console.log('  ⛔ Ignoring mousedown - inside suggestions area, allowing click');
    return; // Allow all interaction with suggestions
  }
  if (e.target.tagName === 'BUTTON' || e.target.closest('button')) {
    console.log('  ⛔ Ignoring mousedown - on button');
    return;
  }
  console.log('  ✅ Starting drag');

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

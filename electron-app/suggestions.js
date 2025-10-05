// suggestions.js (renderer)

const { ipcRenderer } = require('electron');

let dot, textBox, aiSuggestionsElement;
let idleTimer = null;
let idleTimeoutMs = 5000;
let isHovered = false;
let isExpanded = false;

// ===== SIMPLE DRAG STATE =====
let dragState = {
  isDragging: false,
  startX: 0,
  startY: 0,
  startBoxX: 0,
  startBoxY: 0,
  clickStartTime: 0,
  clickStartPos: { x: 0, y: 0 }
};

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

  // Keep overlay ALWAYS interactive (no click-through toggling)
  console.log('🔧 Disabling click-through entirely - window always interactive');
  ipcRenderer.send('suggestions-set-ignore-mouse-events', false);

  // DOT click => open textbox if there is content
  if (dot) {
    dot.addEventListener('click', (e) => {
      console.log('🔵 Dot clicked!');
      e.stopPropagation();
      if (aiSuggestionsElement && aiSuggestionsElement.innerHTML.trim()) {
        showTextBox();
      }
    });

    // Allow dragging from the dot
    dot.addEventListener('mousedown', onDotMouseDown);
  }

  if (textBox) {
    // Hover simply pauses/resumes idle timer (no IPC)
    textBox.addEventListener('mouseenter', () => {
      console.log('📦 TextBox mouseenter – pause idle');
      isHovered = true;
      pauseIdleTimer();
    });

    textBox.addEventListener('mouseleave', () => {
      console.log('📦 TextBox mouseleave – resume idle');
      isHovered = false;
      resumeIdleTimer();
    });

    // Dragging from text box background (not when clicking inside #ai-suggestions)
    textBox.addEventListener('mousedown', onBoxMouseDown);
  }

  // Global drag tracking
  document.addEventListener('mousemove', onMouseMove);
  document.addEventListener('mouseup', onMouseUp);

  // (Optional) Debug: bubble-phase click observer on container (NOT capture)
  if (aiSuggestionsElement) {
    aiSuggestionsElement.addEventListener('click', (e) => {
      // Commented to reduce noise; keep if you want.
      // console.log('🎯 AI Suggestions clicked!', e.target);
      // console.log('  Target classes:', e.target.className);
      // console.log('  Target closest .short-view:', e.target.closest('.short-view'));
    });
  }
});

// ===== IPC from main with AI suggestions =====
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

// ===== Show/Hide with proper fade and pointer behavior =====
function showDot() {
  console.log('🔴 showDot() called');
  if (!textBox || !dot) return;

  // Begin fade-out (let Tailwind / CSS handle transition)
  textBox.style.opacity = '0';
  textBox.style.transform = 'scale(0.92)';
  textBox.style.pointerEvents = 'none'; // disable hit-testing during fade

  // After transition, fully hide
  setTimeout(() => {
    textBox.style.display = 'none';
    textBox.style.visibility = 'hidden';
    console.log('  ✅ Dot visible, textbox hidden');
  }, 400); // keep in sync with your CSS transition duration

  // Show the dot
  dot.style.display = 'flex';
  dot.style.opacity = '1';

  isExpanded = false;
}

function showTextBox() {
  console.log('🟢 showTextBox() called');
  if (!textBox || !dot) return;

  // Hide dot
  dot.style.display = 'none';

  // Reveal textbox (fade in + scale)
  textBox.style.display = 'block';
  textBox.style.visibility = 'visible';
  textBox.style.opacity = '1';
  textBox.style.transform = 'scale(1)';
  textBox.style.pointerEvents = 'auto'; // re-enable interactivity

  isExpanded = true;
  startIdleTimer();

  console.log('  ✅ Textbox visible, dot hidden');
}

// ===== Build suggestions UI =====
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

      // NOTE: intentionally NO inline onclick (prevents double toggles)
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

      const shortView = suggestionDiv.querySelector('.short-view');
      if (shortView) {
        // Click to toggle (single source of truth)
        shortView.addEventListener('click', (e) => {
          // Don't stop propagation here; not needed
          window.toggleSuggestion(index);
        });
      } else {
        console.error('❌ Could not find .short-view for suggestion', index);
      }

      const guideButton = suggestionDiv.querySelector('.guide-button');
      if (guideButton) {
        guideButton.addEventListener('click', (e) => {
          e.stopPropagation();
          const suggestionData = JSON.parse(guideButton.getAttribute('data-suggestion'));
          window.showDetailedGuide(guideButton, suggestionData);
        });
      }

      aiSuggestionsElement.appendChild(suggestionDiv);

      // Optional verification logs
      const verifyShortView = document.querySelector(`.short-view[data-index="${index}"]`);
      console.log(`✅ Appended suggestion ${index} to DOM; short-view present?`, !!verifyShortView);
    });

    console.log(`📊 Total suggestions in aiSuggestionsElement:`, aiSuggestionsElement.children.length);
  }
}

// ===== Idle timer: pause on hover, resume on leave =====
function startIdleTimer() {
  clearTimeout(idleTimer);
  idleTimer = setTimeout(() => {
    console.log('⏱️ Idle timer fired. isHovered:', isHovered, 'isExpanded:', isExpanded);
    if (!isHovered && isExpanded) {
      console.log('  Hiding due to idle timeout');
      showDot();
    }
  }, idleTimeoutMs);
}
function pauseIdleTimer() {
  clearTimeout(idleTimer);
  idleTimer = null;
}
function resumeIdleTimer() {
  startIdleTimer();
}

// ===== Toggle details =====
window.toggleSuggestion = function(index) {
  console.log('🔄 toggleSuggestion called for index:', index);
  const detailsDiv = document.getElementById(`suggestion-details-${index}`);
  const shortView = document.querySelector(`.short-view[data-index="${index}"]`);
  const icon = shortView?.querySelector('.expand-icon');

  if (!detailsDiv) {
    console.error('  ❌ Could not find details div for index:', index);
    return;
  }

  const currentlyHidden = detailsDiv.classList.contains('hidden');
  if (currentlyHidden) {
    detailsDiv.classList.remove('hidden');
    if (icon) icon.textContent = '▲';
    console.log('  ✅ Expanded suggestion', index);
  } else {
    detailsDiv.classList.add('hidden');
    if (icon) icon.textContent = '▼';
    console.log('  ✅ Collapsed suggestion', index);
  }
};

// ===== Detailed guide (stub) =====
window.showDetailedGuide = function(button, suggestion) {
  console.log('Showing detailed guide for:', suggestion.title);
  // TODO: implement
};

// ===== Drag Handlers =====
function onBoxMouseDown(e) {
  // Allow all interactions inside the suggestions area (no drag)
  if (e.target.closest('#ai-suggestions')) {
    // Do NOT start drag
    return;
  }
  if (e.target.tagName === 'BUTTON' || e.target.closest('button')) {
    return;
  }

  startDrag(e);
}

function onDotMouseDown(e) {
  startDrag(e);
}

function startDrag(e) {
  dragState.isDragging = true;
  dragState.startX = e.screenX;
  dragState.startY = e.screenY;
  dragState.clickStartTime = Date.now();
  dragState.clickStartPos = { x: e.screenX, y: e.screenY };

  // Window's top-left screen position = screen - client delta
  dragState.startBoxX = e.screenX - e.clientX;
  dragState.startBoxY = e.screenY - e.clientY;

  e.preventDefault();
  e.stopPropagation();
}

function onMouseMove(e) {
  if (!dragState.isDragging) return;

  const deltaX = e.screenX - dragState.startX;
  const deltaY = e.screenY - dragState.startY;

  const newScreenX = dragState.startBoxX + deltaX;
  const newScreenY = dragState.startBoxY + deltaY;

  ipcRenderer.send('move-suggestions-window', newScreenX, newScreenY);
}

function onMouseUp(e) {
  if (!dragState.isDragging) return;

  const timeDiff = Date.now() - dragState.clickStartTime;
  const distance = Math.hypot(e.screenX - dragState.clickStartPos.x, e.screenY - dragState.clickStartPos.y);

  dragState.isDragging = false;

  // If it was just a quick click, allow normal click handlers to run
  if (timeDiff < 200 && distance < 5) return;
}

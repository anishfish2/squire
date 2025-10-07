# LLM Chat Interface - Setup Guide

## Overview
A new chat interface has been added to Squire that allows you to interact with multiple LLM providers (OpenAI, Anthropic, Google) directly from the app.

## Features
- ✅ Purple "AI" dot button that triggers the chat window
- ✅ Draggable chat interface
- ✅ Model selector dropdown (GPT-4, Claude, Gemini, etc.)
- ✅ Streaming responses
- ✅ Conversation history in the UI
- ✅ Error handling and loading states
- ✅ Clean, dark-themed UI matching the existing app design

## Setup Instructions

### 1. Backend Setup

#### Install Dependencies (Already Done)
The required packages (`openai` and `anthropic`) are already in `requirements.txt`.

#### Configure API Keys
Add your API keys to `squire-backend/.env`:

```bash
# OpenAI (for GPT models)
OPENAI_API_KEY=sk-...

# Anthropic (for Claude models)
ANTHROPIC_API_KEY=sk-ant-...

# Google AI (optional, for Gemini models)
GOOGLE_API_KEY=...
```

You only need to add keys for the providers you want to use.

#### Start the Backend
```bash
cd squire-backend
python main.py
```

The backend should start on `http://localhost:8000`

### 2. Frontend Setup

#### Build the App
```bash
cd electron-app
npm run build
```

#### Run the App
```bash
npm run dev
# or
npm start
```

### 3. Using the LLM Chat

1. **Open the Chat**: Click the purple "AI" dot button on the right side of your screen
2. **Select a Model**: Use the dropdown at the top to choose your preferred LLM
3. **Type Your Message**: Enter your prompt in the text area at the bottom
4. **Send**: Press Enter or click the "Send" button
5. **Stop Generation**: Click "Stop" to cancel an ongoing response
6. **Clear Chat**: Click "Clear" in the top bar to start a new conversation

## File Structure

### Frontend Files
```
electron-app/src/renderer/
├── llm-dot/              # Purple AI dot button
│   ├── index.html
│   └── LLMDotApp.jsx
└── llm-chat/             # Chat interface window
    ├── index.html
    └── LLMChatApp.jsx
```

### Backend Files
```
squire-backend/app/
├── routers/
│   └── llm.py            # API endpoints for chat
└── services/
    └── llm_service.py    # LLM provider implementations
```

## API Endpoints

- `POST /api/chat/stream` - Stream chat completions (SSE)
- `POST /api/chat/completion` - Non-streaming chat completion
- `GET /api/chat/models` - List available models

## Supported Models

### OpenAI
- gpt-4
- gpt-4-turbo
- gpt-3.5-turbo

### Anthropic
- claude-3-opus
- claude-3-sonnet
- claude-3-haiku

### Google AI
- gemini-pro (placeholder - needs implementation)

## Troubleshooting

### "Make sure the backend server is running"
- Ensure the backend is running on `http://localhost:8000`
- Check that your API keys are configured in `.env`

### "Provider not available. Check API keys."
- Verify that the API key for your chosen provider is set in `.env`
- Restart the backend after adding new API keys

### Window Not Showing
- Check the console logs in the Electron dev tools
- Ensure the build completed successfully

## Next Steps (Optional Enhancements)

1. **Keyboard Shortcuts**: Add global shortcuts to open/close the chat
2. **Conversation Persistence**: Save conversations to database
3. **Export Chat**: Add ability to export conversations
4. **Code Highlighting**: Add syntax highlighting for code blocks
5. **Image Support**: Enable image uploads for vision models

## Architecture

```
[Frontend LLM Chat UI]
        ↓ (HTTP Request)
[Backend API /api/chat/stream]
        ↓
[LLM Service - Provider Selection]
        ↓
[OpenAI | Anthropic | Google Provider]
        ↓ (Streaming Response)
[Backend - SSE Stream]
        ↓
[Frontend - Display]
```

## Notes

- The chat interface is always on top and visible on all workspaces
- Conversations are stored in memory only (cleared on window close)
- Streaming is enabled by default for better UX
- All API calls go through the backend for security

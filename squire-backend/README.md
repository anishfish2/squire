# Squire Backend

A FastAPI backend for the Squire application that integrates with Supabase and OpenAI.

## Features

- **FastAPI Framework**: Modern, fast web framework for building APIs
- **Supabase Integration**: Database and authentication services
- **OpenAI Integration**: AI-powered text analysis and chat capabilities
- **CORS Support**: Cross-origin resource sharing for frontend integration

## Setup

### Prerequisites

- Python 3.8+
- pip package manager

### Installation

1. Navigate to the backend directory:
   ```bash
   cd squire-backend
   ```

2. Create a virtual environment:
   ```bash
   python -m venv venv
   source venv/bin/activate  # On Windows: venv\Scripts\activate
   ```

3. Install dependencies:
   ```bash
   pip install -r requirements.txt
   ```

4. Set up environment variables:
   ```bash
   cp .env.example .env
   ```

   Edit `.env` and add your credentials:
   - `SUPABASE_URL`: Your Supabase project URL
   - `SUPABASE_KEY`: Your Supabase anon key
   - `OPENAI_API_KEY`: Your OpenAI API key

### Running the Server

```bash
python main.py
```

Or using uvicorn directly:
```bash
uvicorn main:app --reload --host 0.0.0.0 --port 8000
```

The API will be available at `http://localhost:8000`

## API Endpoints

### Health & Status

- `GET /` - Welcome message
- `GET /health` - Health check with service status

### AI Features

- `POST /analyze-text` - Analyze text using OpenAI
  ```json
  {
    "text": "Your text to analyze",
    "analysis_type": "general"
  }
  ```

- `POST /chat` - Chat with AI assistant
  ```json
  {
    "message": "Hello, how can you help?",
    "context": "Optional context"
  }
  ```

### Data

- `GET /data/sample` - Sample data endpoint (customize for your needs)

## API Documentation

Once the server is running, visit:
- Swagger UI: `http://localhost:8000/docs`
- ReDoc: `http://localhost:8000/redoc`

## Development

### Project Structure

```
squire-backend/
├── main.py              # Main application file
├── requirements.txt     # Python dependencies
├── .env.example        # Environment variables template
└── README.md           # This file
```

### Adding New Endpoints

1. Import necessary modules in `main.py`
2. Create Pydantic models for request/response data
3. Define your endpoint function with appropriate decorators
4. Handle errors with HTTPException

### Database Setup

To use Supabase tables, uncomment and modify the database operations in the endpoint functions. Create your tables in the Supabase dashboard first.

## Environment Variables

| Variable | Description | Required |
|----------|-------------|----------|
| `SUPABASE_URL` | Your Supabase project URL | Yes |
| `SUPABASE_KEY` | Your Supabase anon key | Yes |
| `OPENAI_API_KEY` | Your OpenAI API key | Yes |

## Dependencies

- **fastapi**: Web framework
- **uvicorn**: ASGI server
- **supabase**: Supabase client
- **openai**: OpenAI client
- **python-dotenv**: Environment variable loading
- **pydantic**: Data validation
- **httpx**: HTTP client

## Next Steps

1. Set up your Supabase database schema
2. Configure authentication if needed
3. Add more specific endpoints for your application
4. Implement proper error handling and logging
5. Add tests for your endpoints
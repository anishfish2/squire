from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
import os
from dotenv import load_dotenv
from supabase import create_client, Client
from openai import OpenAI
from pydantic import BaseModel
from typing import Optional

load_dotenv()

app = FastAPI(
    title="Squire Backend API",
    description="Backend API for the Squire application",
    version="1.0.0"
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

supabase_url = os.getenv("SUPABASE_URL")
supabase_key = os.getenv("SUPABASE_KEY")
openai_api_key = os.getenv("OPENAI_API_KEY")

if not all([supabase_url, supabase_key, openai_api_key]):
    raise ValueError("Missing required environment variables")

supabase: Client = create_client(supabase_url, supabase_key)
openai_client = OpenAI(api_key=openai_api_key)

class TextAnalysisRequest(BaseModel):
    text: str
    analysis_type: Optional[str] = "general"

class ChatRequest(BaseModel):
    message: str
    context: Optional[str] = None

@app.get("/")
async def root():
    return {"message": "Welcome to Squire Backend API", "status": "healthy"}

@app.get("/health")
async def health_check():
    try:
        # Test Supabase connection
        supabase.table("_dummy").select("*").limit(1).execute()
        supabase_status = "connected"
    except:
        supabase_status = "disconnected"

    return {
        "status": "healthy",
        "services": {
            "supabase": supabase_status,
            "openai": "configured" if openai_api_key else "not_configured"
        }
    }

@app.post("/analyze-text")
async def analyze_text(request: TextAnalysisRequest):
    try:
        response = openai_client.chat.completions.create(
            model="gpt-3.5-turbo",
            messages=[
                {"role": "system", "content": f"Analyze the following text for {request.analysis_type} insights. Provide a concise analysis."},
                {"role": "user", "content": request.text}
            ],
            max_tokens=500
        )

        analysis = response.choices[0].message.content

        # Store analysis in Supabase (optional - you'll need to create the table)
        # result = supabase.table("text_analyses").insert({
        #     "original_text": request.text,
        #     "analysis": analysis,
        #     "analysis_type": request.analysis_type
        # }).execute()

        return {
            "analysis": analysis,
            "analysis_type": request.analysis_type,
            "status": "success"
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Analysis failed: {str(e)}")

@app.post("/chat")
async def chat_with_ai(request: ChatRequest):
    try:
        messages = [
            {"role": "system", "content": "You are a helpful assistant for the Squire application."}
        ]

        if request.context:
            messages.append({"role": "system", "content": f"Context: {request.context}"})

        messages.append({"role": "user", "content": request.message})

        response = openai_client.chat.completions.create(
            model="gpt-3.5-turbo",
            messages=messages,
            max_tokens=1000
        )

        reply = response.choices[0].message.content

        return {
            "reply": reply,
            "status": "success"
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Chat failed: {str(e)}")

@app.get("/data/sample")
async def get_sample_data():
    try:
        # This is a sample route - replace with your actual table name
        # result = supabase.table("your_table").select("*").limit(5).execute()
        # return {"data": result.data, "status": "success"}

        return {
            "message": "Sample data endpoint - configure with your Supabase table",
            "example_data": [
                {"id": 1, "name": "Sample Item 1"},
                {"id": 2, "name": "Sample Item 2"}
            ],
            "status": "success"
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Data retrieval failed: {str(e)}")

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)
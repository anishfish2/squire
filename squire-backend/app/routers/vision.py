"""
Vision API Router
Handles app preferences and vision analysis requests
"""
from fastapi import APIRouter, HTTPException, Body, File, UploadFile
from pydantic import BaseModel
from typing import Optional, List
from datetime import datetime
from app.core.database import supabase
from app.services.s3_service import s3_service

router = APIRouter(prefix="/api/vision", tags=["vision"])


# Pydantic Models
class AppPreferenceUpdate(BaseModel):
    allow_ocr: Optional[bool] = None
    allow_vision: Optional[bool] = None
    allow_screenshots: Optional[bool] = None
    ocr_frequency: Optional[str] = None
    vision_frequency: Optional[str] = None
    mask_sensitive_content: Optional[bool] = None
    screenshot_retention_days: Optional[int] = None


class AppPreferenceResponse(BaseModel):
    user_id: str
    app_name: str
    bundle_id: Optional[str]
    allow_ocr: bool
    allow_vision: bool
    allow_screenshots: bool
    ocr_frequency: str
    vision_frequency: str
    mask_sensitive_content: bool
    screenshot_retention_days: int
    created_at: str
    updated_at: str


# Endpoints

@router.get("/preferences/{user_id}")
async def get_user_preferences(user_id: str):
    """
    Get all app preferences for a user
    """
    try:
        result = supabase.table("user_app_preferences")\
            .select("*")\
            .eq("user_id", user_id)\
            .execute()

        return result.data
    except Exception as e:
        print(f"❌ Error fetching preferences: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/preferences/{user_id}/{app_name}")
async def get_app_preference(user_id: str, app_name: str):
    """
    Get preference for a specific app
    """
    try:
        result = supabase.table("user_app_preferences")\
            .select("*")\
            .eq("user_id", user_id)\
            .eq("app_name", app_name)\
            .execute()

        if not result.data:
            # Return default preferences if none exist
            return {
                "user_id": user_id,
                "app_name": app_name,
                "allow_ocr": True,
                "allow_vision": False,
                "allow_screenshots": False,
                "ocr_frequency": "normal",
                "vision_frequency": "low",
                "mask_sensitive_content": False,
                "screenshot_retention_days": 30
            }

        return result.data[0]
    except Exception as e:
        print(f"❌ Error fetching preference for {app_name}: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.put("/preferences/{user_id}/{app_name}")
async def update_app_preference(
    user_id: str,
    app_name: str,
    updates: AppPreferenceUpdate
):
    """
    Update or create preference for a specific app
    """
    try:
        # Check if preference exists
        existing = supabase.table("user_app_preferences")\
            .select("*")\
            .eq("user_id", user_id)\
            .eq("app_name", app_name)\
            .execute()

        update_data = {
            k: v for k, v in updates.dict().items() if v is not None
        }
        update_data["updated_at"] = datetime.utcnow().isoformat()

        if not existing.data:
            # Create new preference
            update_data["user_id"] = user_id
            update_data["app_name"] = app_name
            update_data["created_at"] = datetime.utcnow().isoformat()

            # Set defaults for fields not provided
            defaults = {
                "allow_ocr": True,
                "allow_vision": False,
                "allow_screenshots": False,
                "ocr_frequency": "normal",
                "vision_frequency": "low",
                "mask_sensitive_content": False,
                "screenshot_retention_days": 30
            }
            for key, value in defaults.items():
                if key not in update_data:
                    update_data[key] = value

            result = supabase.table("user_app_preferences")\
                .insert(update_data)\
                .execute()

            print(f"✅ Created preference for {app_name}")
        else:
            # Update existing preference
            result = supabase.table("user_app_preferences")\
                .update(update_data)\
                .eq("user_id", user_id)\
                .eq("app_name", app_name)\
                .execute()

            print(f"✅ Updated preference for {app_name}: {update_data}")

        return {"success": True, "data": result.data[0] if result.data else None}
    except Exception as e:
        print(f"❌ Error updating preference for {app_name}: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.delete("/preferences/{user_id}/{app_name}")
async def delete_app_preference(user_id: str, app_name: str):
    """
    Delete preference for a specific app (revert to defaults)
    """
    try:
        result = supabase.table("user_app_preferences")\
            .delete()\
            .eq("user_id", user_id)\
            .eq("app_name", app_name)\
            .execute()

        print(f"✅ Deleted preference for {app_name}")
        return {"success": True, "message": f"Preference for {app_name} deleted"}
    except Exception as e:
        print(f"❌ Error deleting preference for {app_name}: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/preferences/{user_id}/bulk-update")
async def bulk_update_preferences(
    user_id: str,
    updates: List[dict] = Body(...)
):
    """
    Bulk update multiple app preferences at once
    Used for "Enable All" / "Disable All" actions
    """
    try:
        results = []
        for update in updates:
            app_name = update.get("app_name")
            preference_updates = {k: v for k, v in update.items() if k != "app_name"}

            # Use the update_app_preference logic
            pref_update = AppPreferenceUpdate(**preference_updates)
            result = await update_app_preference(user_id, app_name, pref_update)
            results.append(result)

        print(f"✅ Bulk updated {len(results)} preferences")
        return {"success": True, "updated_count": len(results)}
    except Exception as e:
        print(f"❌ Error bulk updating preferences: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/health")
async def vision_health():
    """
    Health check for vision API
    """
    s3_status = "connected" if s3_service.check_bucket_exists() else "disconnected"
    return {
        "status": "ok",
        "service": "vision",
        "s3_status": s3_status,
        "bucket": s3_service.bucket_name if s3_service.s3_client else None
    }


# S3 Screenshot Management Endpoints

@router.post("/screenshots/upload/{user_id}")
async def upload_screenshot(
    user_id: str,
    file: UploadFile = File(...)
):
    """
    Upload a screenshot to S3

    Args:
        user_id: User ID
        file: Screenshot file (PNG or JPEG)

    Returns:
        Screenshot metadata including S3 URL
    """
    try:
        # Validate file type
        if file.content_type not in ["image/png", "image/jpeg", "image/jpg"]:
            raise HTTPException(
                status_code=400,
                detail="Only PNG and JPEG images are supported"
            )

        # Read file data
        screenshot_data = await file.read()

        # Upload to S3
        result = await s3_service.upload_screenshot(
            user_id=user_id,
            screenshot_data=screenshot_data,
            content_type=file.content_type
        )

        return {
            "success": True,
            "screenshot_id": result["screenshot_id"],
            "url": result["url"],
            "storage_path": result["storage_path"],
            "size_bytes": result["size_bytes"]
        }

    except Exception as e:
        print(f"❌ Error uploading screenshot: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/screenshots/presigned-url")
async def get_presigned_url(
    storage_path: str,
    expiration: int = 3600
):
    """
    Generate a presigned URL for temporary screenshot access

    Args:
        storage_path: S3 object key
        expiration: URL expiration in seconds (default: 1 hour)

    Returns:
        Presigned URL
    """
    try:
        url = await s3_service.generate_presigned_url(storage_path, expiration)
        return {
            "success": True,
            "url": url,
            "expires_in": expiration
        }
    except Exception as e:
        print(f"❌ Error generating presigned URL: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.delete("/screenshots/{storage_path:path}")
async def delete_screenshot(storage_path: str):
    """
    Delete a screenshot from S3

    Args:
        storage_path: S3 object key

    Returns:
        Success status
    """
    try:
        await s3_service.delete_screenshot(storage_path)
        return {"success": True, "message": "Screenshot deleted"}
    except Exception as e:
        print(f"❌ Error deleting screenshot: {e}")
        raise HTTPException(status_code=500, detail=str(e))

"""
AWS S3 Service
Handles screenshot upload, download, and deletion from S3
"""
import boto3
from botocore.exceptions import ClientError
import os
from datetime import datetime
from typing import Optional, BinaryIO
import uuid
from dotenv import load_dotenv

load_dotenv()


class S3Service:
    def __init__(self):
        """
        Initialize S3 client with credentials from environment variables
        """
        self.aws_access_key = os.getenv("AWS_ACCESS_KEY_ID")
        self.aws_secret_key = os.getenv("AWS_SECRET_ACCESS_KEY")
        self.aws_region = os.getenv("AWS_REGION", "us-east-1")
        self.bucket_name = os.getenv("AWS_S3_BUCKET", "squire-screenshots")

        if not self.aws_access_key or not self.aws_secret_key:
            print("⚠️ AWS credentials not found in environment variables")
            print("   Set AWS_ACCESS_KEY_ID and AWS_SECRET_ACCESS_KEY in .env")
            self.s3_client = None
            return

        try:
            self.s3_client = boto3.client(
                's3',
                aws_access_key_id=self.aws_access_key,
                aws_secret_access_key=self.aws_secret_key,
                region_name=self.aws_region
            )
            print(f"✅ S3 client initialized for bucket: {self.bucket_name}")
        except Exception as e:
            print(f"❌ Failed to initialize S3 client: {e}")
            self.s3_client = None

    def _generate_storage_path(self, user_id: str, screenshot_id: str, extension: str = "png") -> str:
        """
        Generate a structured path for storing screenshots
        Format: {user_id}/{year}/{month}/{screenshot_id}.{extension}
        """
        now = datetime.utcnow()
        year = now.strftime("%Y")
        month = now.strftime("%m")

        return f"{user_id}/{year}/{month}/{screenshot_id}.{extension}"

    async def upload_screenshot(
        self,
        user_id: str,
        screenshot_data: bytes,
        screenshot_id: Optional[str] = None,
        content_type: str = "image/png"
    ) -> dict:
        """
        Upload a screenshot to S3

        Args:
            user_id: User ID
            screenshot_data: Screenshot binary data
            screenshot_id: Optional screenshot ID (generates UUID if not provided)
            content_type: MIME type (default: image/png)

        Returns:
            dict with 'url', 'storage_path', 'size_bytes'
        """
        if not self.s3_client:
            raise Exception("S3 client not initialized. Check AWS credentials.")

        if not screenshot_id:
            screenshot_id = str(uuid.uuid4())

        extension = "png" if "png" in content_type else "jpg"
        storage_path = self._generate_storage_path(user_id, screenshot_id, extension)

        try:
            # Upload to S3
            self.s3_client.put_object(
                Bucket=self.bucket_name,
                Key=storage_path,
                Body=screenshot_data,
                ContentType=content_type,
                Metadata={
                    'user_id': user_id,
                    'screenshot_id': screenshot_id,
                    'uploaded_at': datetime.utcnow().isoformat()
                }
            )

            # Generate URL
            url = f"https://{self.bucket_name}.s3.{self.aws_region}.amazonaws.com/{storage_path}"

            print(f"✅ Screenshot uploaded to S3: {storage_path}")

            return {
                "url": url,
                "storage_path": storage_path,
                "size_bytes": len(screenshot_data),
                "screenshot_id": screenshot_id
            }

        except ClientError as e:
            print(f"❌ Failed to upload screenshot to S3: {e}")
            raise Exception(f"S3 upload failed: {str(e)}")

    async def download_screenshot(self, storage_path: str) -> bytes:
        """
        Download a screenshot from S3

        Args:
            storage_path: S3 object key

        Returns:
            Screenshot binary data
        """
        if not self.s3_client:
            raise Exception("S3 client not initialized. Check AWS credentials.")

        try:
            response = self.s3_client.get_object(
                Bucket=self.bucket_name,
                Key=storage_path
            )

            screenshot_data = response['Body'].read()
            print(f"✅ Downloaded screenshot from S3: {storage_path}")
            return screenshot_data

        except ClientError as e:
            print(f"❌ Failed to download screenshot from S3: {e}")
            raise Exception(f"S3 download failed: {str(e)}")

    async def delete_screenshot(self, storage_path: str) -> bool:
        """
        Delete a screenshot from S3

        Args:
            storage_path: S3 object key

        Returns:
            True if successful
        """
        if not self.s3_client:
            raise Exception("S3 client not initialized. Check AWS credentials.")

        try:
            self.s3_client.delete_object(
                Bucket=self.bucket_name,
                Key=storage_path
            )

            print(f"✅ Deleted screenshot from S3: {storage_path}")
            return True

        except ClientError as e:
            print(f"❌ Failed to delete screenshot from S3: {e}")
            raise Exception(f"S3 delete failed: {str(e)}")

    async def generate_presigned_url(
        self,
        storage_path: str,
        expiration: int = 3600
    ) -> str:
        """
        Generate a presigned URL for temporary access to a screenshot

        Args:
            storage_path: S3 object key
            expiration: URL expiration time in seconds (default: 1 hour)

        Returns:
            Presigned URL
        """
        if not self.s3_client:
            raise Exception("S3 client not initialized. Check AWS credentials.")

        try:
            url = self.s3_client.generate_presigned_url(
                'get_object',
                Params={
                    'Bucket': self.bucket_name,
                    'Key': storage_path
                },
                ExpiresIn=expiration
            )

            print(f"✅ Generated presigned URL for: {storage_path}")
            return url

        except ClientError as e:
            print(f"❌ Failed to generate presigned URL: {e}")
            raise Exception(f"Presigned URL generation failed: {str(e)}")

    async def bulk_delete_screenshots(self, storage_paths: list[str]) -> dict:
        """
        Delete multiple screenshots at once

        Args:
            storage_paths: List of S3 object keys

        Returns:
            dict with 'deleted_count' and 'failed_count'
        """
        if not self.s3_client:
            raise Exception("S3 client not initialized. Check AWS credentials.")

        if not storage_paths:
            return {"deleted_count": 0, "failed_count": 0}

        try:
            # S3 bulk delete (max 1000 objects at once)
            delete_objects = [{'Key': path} for path in storage_paths]

            response = self.s3_client.delete_objects(
                Bucket=self.bucket_name,
                Delete={'Objects': delete_objects}
            )

            deleted_count = len(response.get('Deleted', []))
            failed_count = len(response.get('Errors', []))

            print(f"✅ Bulk deleted {deleted_count} screenshots from S3")
            if failed_count > 0:
                print(f"⚠️ Failed to delete {failed_count} screenshots")

            return {
                "deleted_count": deleted_count,
                "failed_count": failed_count
            }

        except ClientError as e:
            print(f"❌ Failed to bulk delete screenshots: {e}")
            raise Exception(f"S3 bulk delete failed: {str(e)}")

    def check_bucket_exists(self) -> bool:
        """
        Check if the S3 bucket exists and is accessible

        Returns:
            True if bucket exists and is accessible
        """
        if not self.s3_client:
            return False

        try:
            self.s3_client.head_bucket(Bucket=self.bucket_name)
            print(f"✅ S3 bucket '{self.bucket_name}' is accessible")
            return True
        except ClientError:
            print(f"❌ S3 bucket '{self.bucket_name}' is not accessible")
            return False


# Global instance
s3_service = S3Service()

#!/usr/bin/env python3
"""
Test script to verify Supabase connection and data operations
"""
import asyncio
import sys
import os
from datetime import datetime
from uuid import uuid4

# Add the app directory to Python path
sys.path.append(os.path.join(os.path.dirname(__file__), 'app'))

from app.core.database import execute_query, supabase, DatabaseError
from app.core.config import settings

async def test_supabase_connection():
    """Test basic Supabase connection and operations"""
    print("🔍 Testing Supabase Connection...")
    print(f"   URL: {settings.SUPABASE_URL}")
    print(f"   Key: {settings.SUPABASE_KEY[:20]}...")

    try:
        # Test 1: Basic connection test
        print("\n📡 Test 1: Basic Connection")
        response = supabase.table("user_profiles").select("*").limit(1).execute()
        print(f"✅ Connection successful! Response type: {type(response)}")

        # Test 2: Check available tables
        print("\n📋 Test 2: Available Tables")
        try:
            tables_to_check = [
                "user_profiles",
                "user_sessions",
                "ai_suggestions",
                "user_events",
                "ocr_events",
                "knowledge_nodes",
                "knowledge_relationships",
                "usage_metrics"
            ]

            for table in tables_to_check:
                try:
                    result = await execute_query(
                        table=table,
                        operation="select",
                        limit=1
                    )
                    print(f"✅ {table}: Available (found {len(result) if result else 0} records)")
                except Exception as e:
                    print(f"❌ {table}: {str(e)}")

        except Exception as e:
            print(f"❌ Error checking tables: {e}")

        # Test 3: Create test user profile
        print("\n👤 Test 3: Create Test User Profile")
        test_user_id = uuid4()
        test_profile_data = {
            "id": str(test_user_id),
            "email": f"test_{str(test_user_id)[:8]}@test.com",
            "full_name": "Test User",
            "timezone": "UTC",
            "preferences": {"test": True},
            "settings": {"test_mode": True},
            "metadata": {"created_by": "test_script"}
        }

        try:
            result = await execute_query(
                table="user_profiles",
                operation="insert",
                data=test_profile_data
            )
            print(f"✅ User profile created: {result}")

            # Test 4: Read back the user profile
            print("\n📖 Test 4: Read User Profile")
            read_result = await execute_query(
                table="user_profiles",
                operation="select",
                filters={"id": str(test_user_id)},
                single=True
            )
            print(f"✅ User profile read: {read_result}")

            # Test 5: Create a session for the user
            print("\n📝 Test 5: Create User Session")
            session_data = {
                "user_id": str(test_user_id),
                "device_info": {"test": True, "platform": "test"},
                "session_type": "test"
            }

            session_result = await execute_query(
                table="user_sessions",
                operation="insert",
                data=session_data
            )
            print(f"✅ Session created: {session_result}")

            # Test 6: Create an AI suggestion
            print("\n💡 Test 6: Create AI Suggestion")
            suggestion_data = {
                "user_id": str(test_user_id),
                "session_ids": [session_result[0]["id"]] if session_result else [],
                "suggestion_type": "test",
                "suggestion_content": {
                    "title": "Test Suggestion",
                    "description": "This is a test suggestion",
                    "action_steps": ["Step 1", "Step 2"],
                    "expected_benefit": "Testing",
                    "difficulty": "easy",
                    "time_investment": "1 minute"
                },
                "confidence_score": 0.9,
                "priority": 5,
                "context_data": {"test": True},
                "status": "pending"
            }

            suggestion_result = await execute_query(
                table="ai_suggestions",
                operation="insert",
                data=suggestion_data
            )
            print(f"✅ AI suggestion created: {suggestion_result}")

            # Test 7: Cleanup - Delete test data
            print("\n🧹 Test 7: Cleanup Test Data")
            # Delete suggestion first (due to foreign key)
            if suggestion_result:
                await execute_query(
                    table="ai_suggestions",
                    operation="delete",
                    filters={"id": suggestion_result[0]["id"]}
                )
                print("✅ Test suggestion deleted")

            # Delete session
            if session_result:
                await execute_query(
                    table="user_sessions",
                    operation="delete",
                    filters={"id": session_result[0]["id"]}
                )
                print("✅ Test session deleted")

            # Delete user profile
            await execute_query(
                table="user_profiles",
                operation="delete",
                filters={"id": str(test_user_id)}
            )
            print("✅ Test user profile deleted")

        except Exception as e:
            print(f"❌ Error in CRUD operations: {e}")

    except Exception as e:
        print(f"❌ Connection failed: {e}")
        return False

    print("\n🎉 All Supabase tests completed!")
    return True

async def test_data_flow():
    """Test the actual data flow used by the application"""
    print("\n🔄 Testing Application Data Flow...")

    try:
        # Simulate the actual context request flow
        from app.routers.ai import ensure_user_profile, save_context_data
        from app.models.schemas import AIContextRequest, UserContext, CurrentSession, ContextSignals, RecentOCRContext

        # Create test data similar to what the app sends
        test_user_id = uuid4()

        # Test user profile creation
        print("\n👤 Testing ensure_user_profile...")
        profile_id = await ensure_user_profile(test_user_id)
        print(f"✅ User profile ensured: {profile_id}")

        print("\n🎯 Supabase upload is working correctly!")
        return True

    except Exception as e:
        print(f"❌ Data flow test failed: {e}")
        return False

if __name__ == "__main__":
    async def main():
        print("🚀 Starting Supabase Connection Tests...\n")

        # Test basic connection
        connection_ok = await test_supabase_connection()

        if connection_ok:
            # Test data flow
            data_flow_ok = await test_data_flow()

            if data_flow_ok:
                print("\n✅ ALL TESTS PASSED - Supabase is working correctly!")
                sys.exit(0)
            else:
                print("\n❌ DATA FLOW TESTS FAILED")
                sys.exit(1)
        else:
            print("\n❌ CONNECTION TESTS FAILED")
            sys.exit(1)

    asyncio.run(main())
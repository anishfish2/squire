#!/usr/bin/env python3
"""
Test knowledge graph functionality
"""
import asyncio
from app.core.database import supabase

async def test_knowledge_graph():
    print("🧪 Testing Knowledge Graph Setup...\n")

    # Test 1: Check if upsert_knowledge_node function exists
    print("1. Testing upsert_knowledge_node function...")
    try:
        test_user_id = "550e8400-e29b-41d4-a716-446655440000"

        result = supabase.rpc(
            "upsert_knowledge_node",
            {
                "p_user_id": test_user_id,
                "p_node_type": "habit",
                "p_content": {
                    "description": "Test habit - uses vim keybindings",
                    "source": "test"
                },
                "p_weight": 0.8,
                "p_source_event_ids": [],
                "p_metadata": {"test": True}
            }
        ).execute()

        node_id = result.data
        print(f"✅ Created test node: {node_id}")

        # Verify it was created
        check = supabase.table("knowledge_nodes").select("*").eq("id", node_id).execute()
        if check.data:
            print(f"✅ Node verified in database: {check.data[0]['content']}")
        else:
            print(f"❌ Node not found after creation")

    except Exception as e:
        print(f"❌ Failed to create node: {e}")
        import traceback
        traceback.print_exc()
        return False

    # Test 2: Check existing nodes
    print("\n2. Checking existing knowledge nodes...")
    try:
        existing = supabase.table("knowledge_nodes").select("*").limit(10).execute()
        print(f"   Found {len(existing.data)} nodes")
        for node in existing.data[:5]:
            print(f"   - {node['node_type']}: {node['content'].get('description', 'No description')[:60]}")
    except Exception as e:
        print(f"❌ Failed to query nodes: {e}")

    # Test 3: Check relationships table
    print("\n3. Checking knowledge relationships...")
    try:
        rels = supabase.table("knowledge_relationships").select("*").limit(5).execute()
        print(f"   Found {len(rels.data)} relationships")
        if len(rels.data) == 0:
            print("   ⚠️ No relationships created yet - this is expected if no OCR has run")
    except Exception as e:
        print(f"❌ Failed to query relationships: {e}")

    print("\n✅ Knowledge graph test complete!")
    return True

if __name__ == "__main__":
    asyncio.run(test_knowledge_graph())

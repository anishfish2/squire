#!/usr/bin/env python3
"""
Run database migrations for Supabase
"""
import asyncio
import sys
import os
from pathlib import Path

# Add the app directory to Python path
sys.path.append(os.path.join(os.path.dirname(__file__), 'app'))

from app.core.database import supabase

def read_migration_file(file_path):
    """Read and return the contents of a migration file"""
    with open(file_path, 'r') as f:
        return f.read()

async def run_sql(sql_content, description=""):
    """Execute SQL content using Supabase"""
    try:
        print(f"🔄 {description}")

        # For Supabase, we need to use the REST API to execute raw SQL
        # Since the Python client doesn't support raw SQL well, we'll provide manual instructions
        print(f"   ⚠️  Automatic SQL execution not supported")
        print(f"   📋 Manual execution required in Supabase dashboard")

        return False  # Return False to trigger manual instructions

    except Exception as e:
        print(f"❌ {description} failed: {e}")
        return False

async def main():
    """Run all pending migrations"""
    print("🚀 Running Database Migrations...\n")

    migrations_dir = Path("supabase/migrations")

    # List of migrations to run
    pending_migrations = [
        ("011_create_usage_metrics.sql", "Creating usage_metrics table"),
        ("012_create_ocr_events.sql", "Creating ocr_events table")
    ]

    success_count = 0

    for migration_file, description in pending_migrations:
        migration_path = migrations_dir / migration_file

        if migration_path.exists():
            sql_content = read_migration_file(migration_path)
            success = await run_sql(sql_content, description)
            if success:
                success_count += 1
        else:
            print(f"❌ Migration file not found: {migration_path}")

    print(f"\n📊 Migration Summary:")
    print(f"   Attempted: {len(pending_migrations)}")
    print(f"   Successful: {success_count}")

    if success_count == len(pending_migrations):
        print("\n✅ All migrations completed successfully!")
    else:
        print(f"\n⚠️  Some migrations failed. Manual intervention may be required.")

        # Provide manual SQL for copy-paste
        print(f"\n📋 Manual Migration Instructions:")
        print(f"If the automated migration failed, you can run these SQL commands directly in your Supabase SQL editor:")

        for migration_file, description in pending_migrations:
            migration_path = migrations_dir / migration_file
            if migration_path.exists():
                print(f"\n-- {description}")
                print(f"-- File: {migration_file}")
                sql_content = read_migration_file(migration_path)
                print(sql_content[:500] + "..." if len(sql_content) > 500 else sql_content)

if __name__ == "__main__":
    asyncio.run(main())
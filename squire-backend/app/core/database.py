"""
Database connection and utilities
"""
from supabase import create_client, Client
from app.core.config import settings

# Initialize Supabase client
supabase: Client = create_client(
    settings.SUPABASE_URL,
    settings.SUPABASE_KEY
)


async def get_supabase() -> Client:
    """Dependency to get Supabase client"""
    return supabase


class DatabaseError(Exception):
    """Custom database error"""
    pass


async def execute_query(table: str, operation: str, **kwargs):
    """Execute a Supabase query with error handling"""
    try:
        query = getattr(supabase.table(table), operation)

        # Build query based on kwargs
        if operation == "select":
            columns = kwargs.get("columns", "*")
            query = query(columns)
        elif operation == "insert":
            query = query(kwargs.get("data", {}))
        elif operation == "update":
            query = query(kwargs.get("data", {}))
        elif operation == "delete":
            query = query()

        # Add filters
        filters = kwargs.get("filters", {})
        for key, value in filters.items():
            query = query.eq(key, value)

        # Add ordering
        if kwargs.get("order_by"):
            ascending = kwargs.get("ascending", False)
            query = query.order(kwargs["order_by"], desc=not ascending)

        # Add limit and offset
        if kwargs.get("limit"):
            query = query.limit(kwargs["limit"])
        if kwargs.get("offset"):
            query = query.offset(kwargs["offset"])

        # Execute query
        if operation in ["select", "insert", "update", "delete"]:
            if kwargs.get("single", False):
                response = query.single().execute()
            else:
                response = query.execute()
        else:
            response = query.execute()

        return response.data
    except Exception as e:
        raise DatabaseError(f"Database error in {table}.{operation}: {str(e)}")
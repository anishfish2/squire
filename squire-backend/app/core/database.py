"""
Database connection and utilities
"""
from supabase import create_client, Client
from app.core.config import settings

# Initialize Supabase client
supabase: Client = create_client(
    settings.SUPABASE_URL,
    settings.SUPABASE_ANON_KEY
)


async def get_supabase() -> Client:
    """Dependency to get Supabase client"""
    return supabase


class DatabaseError(Exception):
    """Custom database error"""
    pass


async def execute_rpc(function_name: str, params: dict = None):
    """Execute a Supabase RPC function with error handling"""
    try:
        if params:
            response = await supabase.rpc(function_name, params).execute()
        else:
            response = await supabase.rpc(function_name).execute()

        if response.data is None:
            raise DatabaseError(f"RPC function {function_name} returned no data")

        return response.data
    except Exception as e:
        raise DatabaseError(f"Database error in {function_name}: {str(e)}")


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
                response = await query.single().execute()
            else:
                response = await query.execute()
        else:
            response = await query.execute()

        return response.data
    except Exception as e:
        raise DatabaseError(f"Database error in {table}.{operation}: {str(e)}")
-- Comprehensive Row Level Security policies
-- Note: These replace the temporary open policies created in earlier migrations

-- Drop existing temporary policies
DROP POLICY IF EXISTS "Users can access own profile" ON user_profiles;
DROP POLICY IF EXISTS "Users can access own sessions" ON user_sessions;
DROP POLICY IF EXISTS "Users can access own suggestions" ON ai_suggestions;
DROP POLICY IF EXISTS "Users can access own events" ON user_events;
DROP POLICY IF EXISTS "Users can access own knowledge nodes" ON knowledge_nodes;
DROP POLICY IF EXISTS "Users can access own knowledge relationships" ON knowledge_relationships;

-- USER PROFILES POLICIES
-- Note: When implementing auth, replace 'true' with appropriate auth checks

-- Allow users to view their own profile
CREATE POLICY "Users can view own profile" ON user_profiles
    FOR SELECT USING (
        -- For dummy user testing, allow all. Replace with: id = auth.uid()
        true
    );

-- Allow users to update their own profile
CREATE POLICY "Users can update own profile" ON user_profiles
    FOR UPDATE USING (
        -- For dummy user testing, allow all. Replace with: id = auth.uid()
        true
    );

-- Allow profile creation (typically handled by trigger on auth.users insert)
CREATE POLICY "Enable profile creation" ON user_profiles
    FOR INSERT WITH CHECK (
        -- For dummy user testing, allow all. Replace with proper auth check
        true
    );

-- USER SESSIONS POLICIES

-- Allow users to view their own sessions
CREATE POLICY "Users can view own sessions" ON user_sessions
    FOR SELECT USING (
        -- For dummy user testing, allow all. Replace with: user_id = auth.uid()
        true
    );

-- Allow users to create their own sessions
CREATE POLICY "Users can create own sessions" ON user_sessions
    FOR INSERT WITH CHECK (
        -- For dummy user testing, allow all. Replace with: user_id = auth.uid()
        true
    );

-- Allow users to update their own sessions
CREATE POLICY "Users can update own sessions" ON user_sessions
    FOR UPDATE USING (
        -- For dummy user testing, allow all. Replace with: user_id = auth.uid()
        true
    );

-- Allow users to delete their own sessions (optional)
CREATE POLICY "Users can delete own sessions" ON user_sessions
    FOR DELETE USING (
        -- For dummy user testing, allow all. Replace with: user_id = auth.uid()
        true
    );

-- AI SUGGESTIONS POLICIES

-- Allow users to view their own suggestions
CREATE POLICY "Users can view own suggestions" ON ai_suggestions
    FOR SELECT USING (
        -- For dummy user testing, allow all. Replace with: user_id = auth.uid()
        true
    );

-- Allow system to create suggestions for users
CREATE POLICY "System can create suggestions" ON ai_suggestions
    FOR INSERT WITH CHECK (
        -- For dummy user testing, allow all. Replace with proper auth check
        true
    );

-- Allow users to update their own suggestions (for feedback, status changes)
CREATE POLICY "Users can update own suggestions" ON ai_suggestions
    FOR UPDATE USING (
        -- For dummy user testing, allow all. Replace with: user_id = auth.uid()
        true
    );

-- Allow users to delete their own suggestions
CREATE POLICY "Users can delete own suggestions" ON ai_suggestions
    FOR DELETE USING (
        -- For dummy user testing, allow all. Replace with: user_id = auth.uid()
        true
    );

-- USER EVENTS POLICIES

-- Allow users to view their own events
CREATE POLICY "Users can view own events" ON user_events
    FOR SELECT USING (
        -- For dummy user testing, allow all. Replace with: user_id = auth.uid()
        true
    );

-- Allow users to create their own events
CREATE POLICY "Users can create own events" ON user_events
    FOR INSERT WITH CHECK (
        -- For dummy user testing, allow all. Replace with: user_id = auth.uid()
        true
    );

-- Allow users to update their own events
CREATE POLICY "Users can update own events" ON user_events
    FOR UPDATE USING (
        -- For dummy user testing, allow all. Replace with: user_id = auth.uid()
        true
    );

-- KNOWLEDGE NODES POLICIES

-- Allow users to view their own knowledge nodes
CREATE POLICY "Users can view own knowledge nodes" ON knowledge_nodes
    FOR SELECT USING (
        -- For dummy user testing, allow all. Replace with: user_id = auth.uid()
        true
    );

-- Allow users to create their own knowledge nodes
CREATE POLICY "Users can create own knowledge nodes" ON knowledge_nodes
    FOR INSERT WITH CHECK (
        -- For dummy user testing, allow all. Replace with: user_id = auth.uid()
        true
    );

-- Allow users to update their own knowledge nodes
CREATE POLICY "Users can update own knowledge nodes" ON knowledge_nodes
    FOR UPDATE USING (
        -- For dummy user testing, allow all. Replace with: user_id = auth.uid()
        true
    );

-- Allow users to delete their own knowledge nodes
CREATE POLICY "Users can delete own knowledge nodes" ON knowledge_nodes
    FOR DELETE USING (
        -- For dummy user testing, allow all. Replace with: user_id = auth.uid()
        true
    );

-- KNOWLEDGE RELATIONSHIPS POLICIES

-- Allow users to view their own knowledge relationships
CREATE POLICY "Users can view own relationships" ON knowledge_relationships
    FOR SELECT USING (
        -- For dummy user testing, allow all. Replace with: user_id = auth.uid()
        true
    );

-- Allow users to create relationships between their own nodes
CREATE POLICY "Users can create own relationships" ON knowledge_relationships
    FOR INSERT WITH CHECK (
        -- For dummy user testing, allow all
        -- Replace with: user_id = auth.uid() AND
        -- EXISTS (SELECT 1 FROM knowledge_nodes WHERE id = source_node_id AND user_id = auth.uid()) AND
        -- EXISTS (SELECT 1 FROM knowledge_nodes WHERE id = target_node_id AND user_id = auth.uid())
        true
    );

-- Allow users to update their own relationships
CREATE POLICY "Users can update own relationships" ON knowledge_relationships
    FOR UPDATE USING (
        -- For dummy user testing, allow all. Replace with: user_id = auth.uid()
        true
    );

-- Allow users to delete their own relationships
CREATE POLICY "Users can delete own relationships" ON knowledge_relationships
    FOR DELETE USING (
        -- For dummy user testing, allow all. Replace with: user_id = auth.uid()
        true
    );

-- ADMIN POLICIES (for system operations)
-- These allow admin users to perform system-wide operations

-- Admin can view all profiles (for support)
CREATE POLICY "Admin can view all profiles" ON user_profiles
    FOR SELECT USING (
        -- Replace with proper admin check: auth.jwt() ->> 'role' = 'admin'
        false  -- Disabled for security until proper admin auth is implemented
    );

-- Admin can view all sessions (for analytics)
CREATE POLICY "Admin can view all sessions" ON user_sessions
    FOR SELECT USING (
        -- Replace with proper admin check: auth.jwt() ->> 'role' = 'admin'
        false  -- Disabled for security
    );

-- FUNCTION SECURITY
-- Grant execute permissions on functions to authenticated users

-- Grant execute on user management functions
GRANT EXECUTE ON FUNCTION create_user_profile TO authenticated;
GRANT EXECUTE ON FUNCTION start_user_session TO authenticated;
GRANT EXECUTE ON FUNCTION end_user_session TO authenticated;
GRANT EXECUTE ON FUNCTION add_session_event TO authenticated;
GRANT EXECUTE ON FUNCTION create_ai_suggestion TO authenticated;
GRANT EXECUTE ON FUNCTION update_suggestion_status TO authenticated;
GRANT EXECUTE ON FUNCTION get_active_suggestions TO authenticated;
GRANT EXECUTE ON FUNCTION add_user_event TO authenticated;
GRANT EXECUTE ON FUNCTION upsert_knowledge_node TO authenticated;
GRANT EXECUTE ON FUNCTION find_similar_nodes TO authenticated;
GRANT EXECUTE ON FUNCTION upsert_knowledge_relationship TO authenticated;
GRANT EXECUTE ON FUNCTION traverse_knowledge_graph TO authenticated;
GRANT EXECUTE ON FUNCTION find_connection_path TO authenticated;
GRANT EXECUTE ON FUNCTION generate_session_insights TO authenticated;

-- Grant execute on maintenance functions to service role only
GRANT EXECUTE ON FUNCTION cleanup_expired_suggestions TO service_role;
GRANT EXECUTE ON FUNCTION process_events_to_knowledge TO service_role;
GRANT EXECUTE ON FUNCTION database_health_check TO service_role;

-- Create helper function to check if user owns a resource
CREATE OR REPLACE FUNCTION user_owns_resource(resource_user_id UUID)
RETURNS BOOLEAN AS $$
BEGIN
    -- For dummy user testing, always return true
    -- Replace with: RETURN resource_user_id = auth.uid();
    RETURN true;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Create function to get current user ID (for dummy testing)
CREATE OR REPLACE FUNCTION get_current_user_id()
RETURNS UUID AS $$
BEGIN
    -- For dummy user testing, return a fixed UUID
    -- Replace with: RETURN auth.uid();
    RETURN '00000000-0000-0000-0000-000000000000'::UUID;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
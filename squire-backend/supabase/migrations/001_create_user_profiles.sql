-- Create user_profiles table
CREATE TABLE IF NOT EXISTS user_profiles (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    email TEXT UNIQUE NOT NULL,
    full_name TEXT,
    avatar_url TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW() NOT NULL,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW() NOT NULL,
    preferences JSONB DEFAULT '{}' NOT NULL,
    metadata JSONB DEFAULT '{}' NOT NULL,
    timezone TEXT DEFAULT 'UTC',
    last_active TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    subscription_tier TEXT DEFAULT 'free' CHECK (subscription_tier IN ('free', 'pro', 'enterprise')),
    settings JSONB DEFAULT '{}' NOT NULL
);

-- Create trigger for updated_at timestamp
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ language 'plpgsql';

CREATE TRIGGER update_user_profiles_updated_at
    BEFORE UPDATE ON user_profiles
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

-- Create indexes for performance
CREATE INDEX idx_user_profiles_email ON user_profiles(email);
CREATE INDEX idx_user_profiles_created_at ON user_profiles(created_at);
CREATE INDEX idx_user_profiles_last_active ON user_profiles(last_active);
CREATE INDEX idx_user_profiles_subscription_tier ON user_profiles(subscription_tier);

-- Enable Row Level Security
ALTER TABLE user_profiles ENABLE ROW LEVEL SECURITY;

-- Create RLS policy for user isolation (for now, allow all for dummy user testing)
CREATE POLICY "Users can access own profile" ON user_profiles
    FOR ALL USING (true); -- Temporary policy for dummy user testing

-- Create function for profile creation
CREATE OR REPLACE FUNCTION create_user_profile(
    p_email TEXT,
    p_full_name TEXT DEFAULT NULL,
    p_avatar_url TEXT DEFAULT NULL,
    p_timezone TEXT DEFAULT 'UTC'
)
RETURNS UUID AS $$
DECLARE
    new_profile_id UUID;
BEGIN
    INSERT INTO user_profiles (email, full_name, avatar_url, timezone)
    VALUES (p_email, p_full_name, p_avatar_url, p_timezone)
    RETURNING id INTO new_profile_id;

    RETURN new_profile_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
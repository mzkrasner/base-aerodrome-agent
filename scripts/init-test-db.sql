-- =============================================================================
-- Create test database for vitest
-- This runs automatically on first Docker container start
-- =============================================================================

-- Create test database (will be owned by the 'agent' user)
CREATE DATABASE aerodrome_test;

-- Grant all privileges to the agent user
GRANT ALL PRIVILEGES ON DATABASE aerodrome_test TO agent;

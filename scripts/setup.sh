#!/bin/bash
# =============================================================================
# Aerodrome Trading Agent - One-Command Setup
# =============================================================================
#
# This script sets up everything you need for local development:
#   1. Checks Docker is running
#   2. Starts PostgreSQL container
#   3. Creates .env from template
#   4. Runs database migrations
#
# Usage:
#   npm run setup
#   # or
#   bash scripts/setup.sh
#
# =============================================================================

set -e  # Exit on error

echo ""
echo "=============================================="
echo "  Aerodrome Trading Agent - Setup"
echo "=============================================="
echo ""

# -----------------------------------------------------------------------------
# Step 1: Check Docker
# -----------------------------------------------------------------------------
echo "1️⃣  Checking Docker..."

if ! command -v docker &> /dev/null; then
    echo "❌ Docker is not installed."
    echo "   Please install Docker Desktop from https://docker.com/get-started"
    exit 1
fi

if ! docker info > /dev/null 2>&1; then
    echo "❌ Docker is not running."
    echo "   Please start Docker Desktop and try again."
    exit 1
fi

echo "   ✅ Docker is running"
echo ""

# -----------------------------------------------------------------------------
# Step 2: Start PostgreSQL
# -----------------------------------------------------------------------------
echo "2️⃣  Starting PostgreSQL..."

docker-compose up -d postgres

# Wait for PostgreSQL to be ready
echo "   Waiting for database to be ready..."
until docker-compose exec -T postgres pg_isready -U agent -d aerodrome_agent > /dev/null 2>&1; do
    sleep 1
done

echo "   ✅ PostgreSQL is ready"
echo ""

# -----------------------------------------------------------------------------
# Step 3: Create .env file
# -----------------------------------------------------------------------------
echo "3️⃣  Setting up environment..."

if [ ! -f .env ]; then
    cp .env.example .env

    # Update DATABASE_URL for Docker
    if [[ "$OSTYPE" == "darwin"* ]]; then
        # macOS
        sed -i '' 's|^DATABASE_URL=.*|DATABASE_URL=postgresql://agent:agent_dev_password@localhost:5432/aerodrome_agent|' .env
    else
        # Linux
        sed -i 's|^DATABASE_URL=.*|DATABASE_URL=postgresql://agent:agent_dev_password@localhost:5432/aerodrome_agent|' .env
    fi

    echo "   ✅ Created .env from template"
    echo "   ⚠️  Edit .env to add your API keys"
else
    echo "   ✅ .env already exists (skipping)"
fi
echo ""

# -----------------------------------------------------------------------------
# Step 4: Run migrations
# -----------------------------------------------------------------------------
echo "4️⃣  Running database migrations..."

npm run db:migrate

echo "   ✅ Migrations complete"
echo ""

# -----------------------------------------------------------------------------
# Done!
# -----------------------------------------------------------------------------
echo "=============================================="
echo "  ✅ Setup Complete!"
echo "=============================================="
echo ""
echo "Next steps:"
echo ""
echo "  1. Edit .env with your API keys:"
echo "     - ANTHROPIC_API_KEY (required if not using EigenAI)"
echo "     - EIGENAI_GRANT_PRIVATE_KEY (if using EigenAI)"
echo "     - AGENT_PRIVATE_KEY (for real trading)"
echo ""
echo "  2. Test your setup:"
echo "     npm run cli health"
echo ""
echo "  3. Run analysis (safe, no trades):"
echo "     npm run cli analyze"
echo ""
echo "  4. Start trading loop (dry run):"
echo "     npm run cli start --dry-run"
echo ""
echo "Database: postgresql://agent:agent_dev_password@localhost:5432/aerodrome_agent"
echo ""

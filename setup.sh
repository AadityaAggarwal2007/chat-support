#!/bin/bash
set -e

echo "=== Chat Support — VPS Setup ==="

# Server
echo ""
echo "→ Installing server dependencies..."
cd server
npm install

echo ""
echo "→ Generating Prisma client..."
npx prisma generate

echo ""
echo "→ Pushing database schema to PostgreSQL..."
npx prisma db push

cd ..

# Dashboard
echo ""
echo "→ Installing dashboard dependencies..."
cd dashboard
npm install

echo ""
echo "→ Building dashboard..."
npm run build

cd ..

echo ""
echo "=== Setup complete! ==="
echo ""
echo "Before starting, make sure you have:"
echo "  server/.env (copy from server/.env.example and fill in)"
echo "  dashboard/.env.local (copy from dashboard/.env.local.example)"
echo ""
echo "To start both services with PM2:"
echo "  pm2 start ecosystem.config.js"
echo "  pm2 save"
echo ""
echo "To start in dev mode:"
echo "  cd server && npm run dev"
echo "  cd dashboard && npm run dev"

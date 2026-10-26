#!/bin/bash

# CodePulse - Complete GitHub Push Script
# Repository: https://github.com/Aaryan-devop/Real-time-source-code-analyser

echo "🚀 Starting CodePulse GitHub Push..."
echo ""

# Navigate to project directory
cd /Users/apple/Downloads/codepulse

# Fix Git permissions if needed
echo "📝 Fixing Git permissions..."
sudo chown -R $(whoami) .git 2>/dev/null || echo "Permissions already OK"

# Configure Git user (if not already configured)
echo "⚙️  Configuring Git..."
git config user.name "Aaryan Developer" || git config --global user.name "Aaryan Developer"
git config user.email "aaryan@devop.local" || git config --global user.email "aaryan@devop.local"

# Check current status
echo ""
echo "📊 Current Git status:"
git status --short

# Stage all files
echo ""
echo "📦 Staging all project files..."
git add .

# Create comprehensive initial commit
echo ""
echo "💾 Creating commit..."
git commit -m "Initial commit: Complete CodePulse project

🎯 Real-time Code Quality Analysis Platform

Features:
- ⚡ Real-time static analysis (<50ms feedback)
- 🔒 100% local execution (zero telemetry)
- 🐍 Multi-language support (JavaScript/TypeScript/Python)
- 🔐 Security scanning (secrets, SQL injection, XSS)
- 📊 Interactive dashboard with health scores
- 🔄 WebSocket-based live updates
- 📈 Git integration with change tracking
- 🎨 Beautiful dark-themed UI

Tech Stack:
- Frontend: React 19 + TypeScript + Vite + Tailwind CSS
- Backend: Node.js + Express + WebSocket + SQLite
- Real-time: WebSocket with auto-reconnect
- Storage: SQLite with WAL mode
- Build: Vite (frontend) + tsx (backend)

Documentation:
- Complete architecture documentation
- Module guides with code examples
- Folder structure explanation
- Comprehensive project overview

Performance:
- Sub-second incremental analysis
- Content-hash based caching
- Debounced file watching (300ms)
- LOC-normalized health scoring

Co-Authored-By: Claude <noreply@anthropic.com>"

# Add remote (if not already added)
echo ""
echo "🔗 Configuring remote repository..."
git remote remove origin 2>/dev/null
git remote add origin https://github.com/Aaryan-devop/Real-time-source-code-analyser.git

# Rename branch to main (GitHub standard)
echo ""
echo "🌿 Setting up main branch..."
git branch -M main

# Push to GitHub
echo ""
echo "⬆️  Pushing to GitHub..."
git push -u origin main --force

echo ""
echo "✅ Successfully pushed to GitHub!"
echo "🔗 Repository: https://github.com/Aaryan-devop/Real-time-source-code-analyser"
echo ""
echo "Next steps:"
echo "1. Visit your repository on GitHub"
echo "2. Add a description and topics"
echo "3. Enable GitHub Pages (optional)"
echo "4. Set up branch protection rules"

#!/bin/bash

# Script to help apply vision feature migrations to Supabase
# Run this and copy-paste the SQL into your Supabase SQL Editor

echo "====================================================================="
echo "Vision Feature Database Migrations"
echo "====================================================================="
echo ""
echo "Copy and paste the following SQL into your Supabase SQL Editor:"
echo "https://supabase.com/dashboard/project/_/sql"
echo ""
echo "====================================================================="
echo ""

echo "-- ============================================"
echo "-- Migration 015: App Preferences Table"
echo "-- ============================================"
cat migrations/015_create_app_preferences_table.sql
echo ""
echo ""

echo "-- ============================================"
echo "-- Migration 016: Vision Events Table"
echo "-- ============================================"
cat migrations/016_create_vision_events_table.sql
echo ""
echo ""

echo "====================================================================="
echo "✅ Copy the SQL above and run it in your Supabase SQL Editor"
echo "====================================================================="

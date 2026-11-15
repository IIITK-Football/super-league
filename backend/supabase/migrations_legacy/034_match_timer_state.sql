-- Migration: Add timer state to matches table
ALTER TABLE public.matches 
ADD COLUMN IF NOT EXISTS timer_start_time TIMESTAMPTZ,
ADD COLUMN IF NOT EXISTS timer_calibration INTEGER DEFAULT 0;

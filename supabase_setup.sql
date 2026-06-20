-- Supabase Database Setup for GOR Intelligence

-- 1. Create watched_repos table for the Personal Pipeline
CREATE TABLE public.watched_repos (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE,
  repo_full_name text NOT NULL,
  repo_url text NOT NULL,
  stars integer DEFAULT 0,
  status text DEFAULT 'watching' CHECK (status IN ('watching', 'contributing', 'merged')),
  created_at timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL,
  updated_at timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL,
  UNIQUE(user_id, repo_full_name)
);

-- Enable Row Level Security (RLS)
ALTER TABLE public.watched_repos ENABLE ROW LEVEL SECURITY;

-- Create Auth Policies
CREATE POLICY "Users can view their own watched repos" 
  ON public.watched_repos FOR SELECT 
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert their own watched repos" 
  ON public.watched_repos FOR INSERT 
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update their own watched repos" 
  ON public.watched_repos FOR UPDATE 
  USING (auth.uid() = user_id);

CREATE POLICY "Users can delete their own watched repos" 
  ON public.watched_repos FOR DELETE 
  USING (auth.uid() = user_id);

-- 2. Create repo_snapshots table for the Star Velocity Engine (Phase 3)
CREATE TABLE public.repo_snapshots (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  repo_full_name text NOT NULL,
  stars integer NOT NULL,
  forks integer NOT NULL,
  snapshot_date date DEFAULT CURRENT_DATE NOT NULL,
  UNIQUE(repo_full_name, snapshot_date)
);

-- Note: To fully activate the Velocity Engine, you can create a Supabase Edge Function
-- that runs on a cron schedule to fetch the latest star counts for all distinct repos
-- in watched_repos, inserting them into repo_snapshots daily.

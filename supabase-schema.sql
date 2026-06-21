-- Schema for Phase 4: Recommendation Diversity Cooldown

CREATE TABLE IF NOT EXISTS public.repo_surfaces (
    repo_full_name TEXT PRIMARY KEY,
    surface_count INTEGER DEFAULT 1,
    last_surfaced_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now())
);

-- Enable Row Level Security
ALTER TABLE public.repo_surfaces ENABLE ROW LEVEL SECURITY;

-- Allow public read access
CREATE POLICY "Allow public read access to repo_surfaces"
ON public.repo_surfaces FOR SELECT
USING (true);

-- Allow public insert/update (upsert) access 
-- (In a production app, you might want this to be authenticated or handled by a secure edge function, 
-- but for the current architecture, public access is required for client-side logging)
CREATE POLICY "Allow public insert to repo_surfaces"
ON public.repo_surfaces FOR INSERT
WITH CHECK (true);

CREATE POLICY "Allow public update to repo_surfaces"
ON public.repo_surfaces FOR UPDATE
USING (true);

-- Schema for Phase 6: Architecture & Scale (Caching Layer)
CREATE TABLE IF NOT EXISTS public.repo_scores_cache (
    repo_full_name TEXT PRIMARY KEY,
    analysis_data JSONB NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now())
);

ALTER TABLE public.repo_scores_cache ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow public read access to repo_scores_cache"
ON public.repo_scores_cache FOR SELECT
USING (true);

CREATE POLICY "Allow public insert to repo_scores_cache"
ON public.repo_scores_cache FOR INSERT
WITH CHECK (true);

CREATE POLICY "Allow public update to repo_scores_cache"
ON public.repo_scores_cache FOR UPDATE
USING (true);

-- Schema for Phase 7: Product-Level (Outcome Feedback Loop)
-- Run these if the watched_repos table already exists
-- ALTER TABLE public.watched_repos ADD COLUMN IF NOT EXISTS pr_url TEXT;
-- ALTER TABLE public.watched_repos ADD COLUMN IF NOT EXISTS submitted_at TIMESTAMP WITH TIME ZONE;

-- Schema for Python-Backed Trending Radar
CREATE TABLE IF NOT EXISTS public.trending_radar_cache (
  repo_full_name TEXT PRIMARY KEY,
  language TEXT NOT NULL,
  tier TEXT NOT NULL,
  stars_gained INTEGER DEFAULT 0,
  description TEXT,
  scraped_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now())
);

ALTER TABLE public.trending_radar_cache ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow public read of trending_radar_cache"
ON public.trending_radar_cache FOR SELECT
USING (true);

-- The Python script will need a service role key to insert, or we can allow anon insert for testing.
-- We will allow anon insert/update for local testing simplicity.
CREATE POLICY "Allow public insert to trending_radar_cache"
ON public.trending_radar_cache FOR INSERT
WITH CHECK (true);

CREATE POLICY "Allow public update to trending_radar_cache"
ON public.trending_radar_cache FOR UPDATE
USING (true);

import { createClient } from '@supabase/supabase-js';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL || '';
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY || '';

export const supabase = (supabaseUrl && supabaseAnonKey) 
  ? createClient(supabaseUrl, supabaseAnonKey) 
  : null;

export async function signInWithGithub() {
  if (!supabase) throw new Error('Supabase not configured.');
  
  const { data, error } = await supabase.auth.signInWithOAuth({
    provider: 'github',
    options: {
      scopes: 'read:user user:email'
    }
  });
  
  if (error) throw error;
  return data;
}

export async function signOut() {
  if (!supabase) return;
  const { error } = await supabase.auth.signOut();
  if (error) throw error;
}

export async function getWatchedRepos(userId) {
  if (!supabase) return [];
  const { data, error } = await supabase
    .from('watched_repos')
    .select('*')
    .eq('user_id', userId)
    .order('created_at', { ascending: false });
    
  if (error) throw error;
  return data;
}

export async function watchRepo(userId, repoData) {
  if (!supabase) throw new Error('Supabase not configured.');
  const { data, error } = await supabase
    .from('watched_repos')
    .upsert({
      user_id: userId,
      repo_full_name: repoData.full_name,
      repo_url: repoData.html_url,
      stars: repoData.stargazers_count,
      status: 'watching',
      updated_at: new Date().toISOString()
    }, { onConflict: 'user_id, repo_full_name' });
    
  if (error) throw error;
  return data;
}

export async function updateRepoStatus(userId, repoFullName, status) {
  if (!supabase) throw new Error('Supabase not configured.');
  const { data, error } = await supabase
    .from('watched_repos')
    .update({ status, updated_at: new Date().toISOString() })
    .match({ user_id: userId, repo_full_name: repoFullName });
    
  if (error) throw error;
  return data;
}

// Phase 7.1: Outcome Feedback Loop
export async function submitPRFeedback(userId, repoFullName, prUrl) {
  if (!supabase) throw new Error('Supabase not configured.');
  const { data, error } = await supabase
    .from('watched_repos')
    .update({ 
      pr_url: prUrl, 
      status: 'submitted',
      submitted_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
    })
    .match({ user_id: userId, repo_full_name: repoFullName });
    
  if (error) throw error;
  return data;
}

// Phase 4.2: Recommendation Diversity Cooldown
export async function recordRepoSurfaced(repoFullName) {
  if (!supabase) return;
  try {
    const { data: existing } = await supabase
      .from('repo_surfaces')
      .select('surface_count')
      .eq('repo_full_name', repoFullName)
      .maybeSingle();

    const count = existing ? existing.surface_count + 1 : 1;

    await supabase
      .from('repo_surfaces')
      .upsert({
        repo_full_name: repoFullName,
        surface_count: count,
        last_surfaced_at: new Date().toISOString()
      }, { onConflict: 'repo_full_name' });
  } catch (err) {
    // Graceful fallback if table doesn't exist yet
    console.warn('Could not record repo surface to Supabase:', err.message);
  }
}

export async function getRepoSurfaceCounts(repoFullNames) {
  if (!supabase || repoFullNames.length === 0) return {};
  try {
    const { data, error } = await supabase
      .from('repo_surfaces')
      .select('repo_full_name, surface_count')
      .in('repo_full_name', repoFullNames);
      
    if (error) throw error;
    
    const counts = {};
    if (data) {
      for (const row of data) {
        counts[row.repo_full_name] = row.surface_count;
      }
    }
    return counts;
  } catch (err) {
    console.warn('Could not fetch repo surface counts:', err.message);
    return {};
  }
}

export async function getCachedScore(repoFullName) {
  if (!supabase) return null;
  try {
    const { data, error } = await supabase
      .from('repo_scores_cache')
      .select('analysis_data, created_at')
      .eq('repo_full_name', repoFullName)
      .maybeSingle();

    if (error || !data) return null;

    // 7-day TTL check
    const ageDays = (new Date() - new Date(data.created_at)) / 86400000;
    if (ageDays > 7) {
      return null; // Cache expired
    }

    return data.analysis_data;
  } catch (err) {
    return null;
  }
}

export async function setCachedScore(repoFullName, analysisData) {
  if (!supabase) return;
  try {
    await supabase
      .from('repo_scores_cache')
      .upsert({
        repo_full_name: repoFullName,
        analysis_data: analysisData,
        created_at: new Date().toISOString()
      }, { onConflict: 'repo_full_name' });
  } catch (err) {
    console.warn('Could not cache score:', err.message);
  }
}

export async function getTrendingRepos() {
  if (!supabase) return [];
  try {
    const twentyFourHoursAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    
    const { data, error } = await supabase
      .from('trending_radar_cache')
      .select('*')
      .gte('scraped_at', twentyFourHoursAgo)
      .order('stars_gained', { ascending: false });

    if (error) throw error;
    
    // Convert to mock GitHub API objects to feed into analyzeOpportunity
    return (data || []).map(row => {
      const parts = row.repo_full_name.split('/');
      return {
        full_name: row.repo_full_name,
        name: parts[1],
        owner: { login: parts[0] },
        description: row.description || '',
        stargazers_count: 1000, // Placeholder
        html_url: `https://github.com/${row.repo_full_name}`,
        has_pull_requests: true,
        archived: false,
        is_template: false,
        disabled: false,
        license: { key: 'mit' }, // fake license
        _stars_gained: row.stars_gained,
        _tier: row.tier
      };
    });
  } catch (err) {
    console.error('Failed to fetch trending repos from Supabase:', err);
    return [];
  }
}

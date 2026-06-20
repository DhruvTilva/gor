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

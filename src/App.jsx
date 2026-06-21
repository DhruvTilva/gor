import { useState, useEffect } from 'react';
import { 
  Search, GitPullRequest, LayoutDashboard, Bookmark, 
  RefreshCw, AlertCircle, LogOut, CheckCircle, Database, ClipboardPaste
} from 'lucide-react';
import { 
  setGithubToken, searchRepos, analyzeOpportunity, rateLimitState 
} from './lib/github';
import { 
  supabase, signInWithGithub, signOut, watchRepo, getWatchedRepos, updateRepoStatus,
  recordRepoSurfaced, getRepoSurfaceCounts, getCachedScore, setCachedScore,
  submitPRFeedback
} from './lib/supabase';

const CATEGORIES = {
  agents: { label: '🤖 Agents', keywords: 'AI agent autonomous llm' },
  rag: { label: '🔗 RAG / Vector', keywords: 'RAG retrieval vector embeddings' },
  cookbooks: { label: '📒 Cookbooks', keywords: 'cookbook recipes examples AI ML' },
  models: { label: '🧠 ML Models', keywords: 'machine learning model training neural' },
  mlops: { label: '⚙️ MLOps', keywords: 'mlops pipeline experiment tracking' },
  devtools: { label: '🛠️ AI Dev Tools', keywords: 'AI developer tools CLI assistant' },
};

function App() {
  const [currentView, setCurrentView] = useState('search'); // 'search' | 'pipeline'
  const [user, setUser] = useState(null);
  
  const [tokenInput, setTokenInput] = useState('');
  const [tokenSaved, setTokenSaved] = useState(false);
  const [category, setCategory] = useState('agents');
  const [mode, setMode] = useState('probability');
  const [searchQuery, setSearchQuery] = useState('');
  
  const [results, setResults] = useState([]);
  const [pipelineRepos, setPipelineRepos] = useState([]);
  
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  const [filters] = useState({
    minStars: 1000,
    firstTimerDays: 14,
    language: 'any',
    excludeForks: true
  });

  useEffect(() => {
    if (supabase) {
      supabase.auth.getSession().then(({ data: { session } }) => {
        setUser(session?.user ?? null);
      });

      const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
        setUser(session?.user ?? null);
      });

      return () => subscription.unsubscribe();
    }
  }, []);

  const loadPipeline = async () => {
    try {
      setLoading(true);
      const data = await getWatchedRepos(user.id);
      setPipelineRepos(data);
    } catch (err) {
      console.error('Failed to load pipeline:', err);
    } finally {
      setLoading(false);
    }
  };

  // eslint-disable-next-line
  useEffect(() => {
    if (user && currentView === 'pipeline') {
      loadPipeline();
    }
    // eslint-disable-next-line
  }, [user, currentView]);

  const handleSaveToken = () => {
    if (tokenInput.trim()) {
      setGithubToken(tokenInput.trim());
      setTokenSaved(true);
      setTokenInput('');
    }
  };

  const handleClearToken = () => {
    setGithubToken(null);
    setTokenSaved(false);
  };

  const handleLogin = async () => {
    try {
      await signInWithGithub();
    } catch (err) {
      setError(err.message);
    }
  };

  const handleLogout = async () => {
    await signOut();
  };

  const handleSubmitPR = async (repo) => {
    const prUrl = prompt(`Enter the URL of your merged Pull Request for ${repo.repo_full_name}:`);
    if (prUrl) {
      try {
        await submitPRFeedback(user.id, repo.repo_full_name, prUrl);
        loadPipeline();
        alert('Thank you! This data will help train future GOR versions.');
      } catch (err) {
        alert('Failed to submit PR feedback: ' + err.message);
      }
    }
  };

  const fetchResults = async () => {
    setLoading(true);
    setError(null);
    setResults([]);
    try {
      const keywords = searchQuery || CATEGORIES[category].keywords;
      
      const apiFilters = { ...filters };
      if (mode === 'best') {
        apiFilters.minStars = 5000;
      } else if (mode === 'probability') {
        apiFilters.minStars = 300;
        apiFilters.maxStars = 5000;
        apiFilters.ignoreStarScore = true;
      } else if (mode === 'rising') {
        apiFilters.minStars = 100;
        apiFilters.maxStars = 5000;
        apiFilters.sort = 'updated';
        const d = new Date();
        d.setFullYear(d.getFullYear() - 1);
        apiFilters.createdAfter = d.toISOString().split('T')[0];
        apiFilters.ignoreStarScore = true;
      } else if (mode === 'gems') {
        apiFilters.minStars = 100;
        apiFilters.maxStars = 2000;
        apiFilters.sort = 'updated';
        apiFilters.ignoreStarScore = true;
      } else if (mode === 'resume') {
        apiFilters.minStars = 10000;
      }

      let repos = await searchRepos(keywords, apiFilters);

      const scoredRepos = [];
      for (const repo of repos) {
        if (
          repo.archived || 
          repo.disabled || 
          repo.has_pull_requests === false ||
          repo.is_template === true ||
          repo.license === null
        ) continue;
        try {
          // Phase 6.2: Check cache before running expensive API analysis
          const cached = await getCachedScore(repo.full_name);
          if (cached) {
            scoredRepos.push(cached);
          } else {
            const analysis = await analyzeOpportunity(repo, apiFilters);
            if (analysis) {
              await setCachedScore(repo.full_name, analysis);
              scoredRepos.push(analysis);
            }
          }
        } catch (err) {
          console.warn(`Skipping repo ${repo.full_name} due to analysis error:`, err.message);
          continue;
        }
      }
      
      const repoNames = scoredRepos.map(r => r.repo.full_name);
      const surfaceCounts = await getRepoSurfaceCounts(repoNames);
      
      // Apply Cooldown Penalty
      for (const result of scoredRepos) {
        const surfaces = surfaceCounts[result.repo.full_name] || 0;
        result.stats.surfaceCount = surfaces;
        // If shown more than 5 times globally, start applying a severe cooldown penalty
        if (surfaces > 5) {
          result.scores.total = Math.max(0, result.scores.total - (surfaces * 10));
        }
      }

      scoredRepos.sort((a, b) => b.scores.total - a.scores.total);
      setResults(scoredRepos);

      // Record that we surfaced these to a user
      for (const result of scoredRepos.slice(0, 10)) { // Only record the top 10 actually seen
        recordRepoSurfaced(result.repo.full_name);
      }
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  // eslint-disable-next-line
  useEffect(() => {
    if (currentView === 'search') {
      fetchResults();
    }
    // eslint-disable-next-line
  }, [category, mode, filters, currentView]);

  const onWatchRepo = async (repoData) => {
    if (!user) {
      alert('Please login with GitHub to watch repositories.');
      return;
    }
    try {
      await watchRepo(user.id, repoData);
      alert('Added to pipeline!');
    } catch (err) {
      alert('Error watching repo: ' + err.message);
    }
  };

  return (
    <div className="app-container">
      <header className="glass-panel" style={{ padding: '20px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '30px' }}>
          <div>
            <h1 className="text-gradient" style={{ fontSize: '2rem' }}>GOR Intelligence</h1>
            <p style={{ color: 'var(--muted)', margin: '4px 0 0 0' }}>Charge at the right repos. At the right time.</p>
          </div>
          
          <div style={{ display: 'flex', gap: '8px', background: 'rgba(255,255,255,0.05)', padding: '6px', borderRadius: '12px' }}>
            <button 
              className={`btn ${currentView === 'search' ? 'btn-primary' : ''}`}
              onClick={() => setCurrentView('search')}
              style={{ border: 'none' }}
            >
              <Search size={18} /> Search
            </button>
            <button 
              className={`btn ${currentView === 'pipeline' ? 'btn-primary' : ''}`}
              onClick={() => setCurrentView('pipeline')}
              style={{ border: 'none' }}
            >
              <LayoutDashboard size={18} /> My Pipeline
            </button>
          </div>
        </div>
        
        <div style={{ display: 'flex', gap: '16px', alignItems: 'center' }}>
          {user ? (
            <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
              <span style={{ color: 'var(--text)', fontSize: '0.9rem' }}>
                <GitPullRequest size={14} style={{ display: 'inline', verticalAlign: 'middle', marginRight: '4px' }}/>
                {user.email}
              </span>
              <button className="btn" onClick={handleLogout}><LogOut size={16}/></button>
            </div>
          ) : (
            <button className="btn" onClick={handleLogin}>
              <GitPullRequest size={18}/> Login
            </button>
          )}

          <div style={{ width: '1px', height: '24px', background: 'var(--border)' }}></div>

          {!tokenSaved ? (
            <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
              <div style={{ position: 'relative', display: 'flex', alignItems: 'center' }}>
                <input 
                  type="password" 
                  placeholder="GitHub PAT..." 
                  value={tokenInput}
                  onChange={e => setTokenInput(e.target.value)}
                  style={{ width: '170px', paddingRight: '36px' }}
                />
                <button 
                  onClick={async () => {
                    try {
                      const text = await navigator.clipboard.readText();
                      setTokenInput(text);
                    } catch (err) {
                      console.error('Failed to read clipboard', err);
                    }
                  }}
                  style={{ 
                    position: 'absolute', right: '4px', background: 'transparent', 
                    border: 'none', color: 'var(--muted)', cursor: 'pointer', padding: '4px', display: 'flex' 
                  }}
                  title="Paste from clipboard"
                >
                  <ClipboardPaste size={16} />
                </button>
              </div>
              <button className="btn" onClick={handleSaveToken}>Save</button>
            </div>
          ) : (
            <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
              <span style={{ color: 'var(--success)', fontSize: '0.9rem' }}>🔒 PAT Active</span>
              <button className="btn" onClick={handleClearToken}>Clear</button>
            </div>
          )}
        </div>
      </header>

      {currentView === 'search' ? (
        <>
          <div className="glass-panel" style={{ padding: '20px', display: 'flex', flexDirection: 'column', gap: '20px' }}>
            <div style={{ display: 'flex', gap: '12px', flexWrap: 'wrap' }}>
              {Object.entries(CATEGORIES).map(([key, val]) => (
                <button 
                  key={key}
                  className={`pill ${category === key ? 'active' : ''}`}
                  onClick={() => { setCategory(key); setSearchQuery(''); }}
                >
                  {val.label}
                </button>
              ))}
            </div>

            <div style={{ display: 'flex', gap: '12px', flexWrap: 'wrap' }}>
              <button className={`pill ${mode === 'probability' ? 'active' : ''}`} onClick={() => setMode('probability')}>🎯 Highest Merge Probability</button>
              <button className={`pill ${mode === 'rising' ? 'active' : ''}`} onClick={() => setMode('rising')}>🚀 Rising Fast</button>
              <button className={`pill ${mode === 'gems' ? 'active' : ''}`} onClick={() => setMode('gems')}>💎 Hidden Gems</button>
              <button className={`pill ${mode === 'best' ? 'active' : ''}`} onClick={() => setMode('best')}>🔥 Career Giants</button>
              <button className={`pill ${mode === 'resume' ? 'active' : ''}`} onClick={() => setMode('resume')}>💼 Resume Builders</button>
            </div>

            <div style={{ display: 'flex', gap: '12px' }}>
              <div style={{ position: 'relative', flex: 1 }}>
                <Search style={{ position: 'absolute', left: '12px', top: '10px', color: 'var(--muted)' }} size={20} />
                <input 
                  type="text" 
                  placeholder="Custom keyword search..." 
                  value={searchQuery}
                  onChange={e => setSearchQuery(e.target.value)}
                  onKeyDown={e => e.key === 'Enter' && fetchResults()}
                  style={{ paddingLeft: '40px' }}
                />
              </div>
              <button className="btn" onClick={fetchResults}><RefreshCw size={18}/> Refresh</button>
            </div>
          </div>

          <main>
            {loading && (
              <div style={{ textAlign: 'center', padding: '40px' }}>
                <div className="spinner"></div>
                <p style={{ marginTop: '20px', color: 'var(--muted)' }}>Analyzing GitHub APIs (fetching PRs, calculating TTM & Merge Rates)...</p>
              </div>
            )}

            {error && (
              <div className="glass-panel" style={{ padding: '40px', textAlign: 'center', borderColor: 'var(--danger)' }}>
                <AlertCircle color="var(--danger)" size={48} style={{ margin: '0 auto 16px' }} />
                <h3>Error</h3>
                <p style={{ color: 'var(--muted)' }}>{error}</p>
              </div>
            )}

            {!loading && !error && (
              <div className="cards-grid">
                {results.map((item) => (
                  <RepoCard key={item.repo.id} data={item} onWatch={() => onWatchRepo(item.repo)} />
                ))}
              </div>
            )}
          </main>
        </>
      ) : (
        <main>
          {!supabase ? (
            <div className="glass-panel" style={{ padding: '60px', textAlign: 'center' }}>
              <Database size={48} color="var(--muted)" style={{ margin: '0 auto 20px' }} />
              <h2>Supabase Not Configured</h2>
              <p style={{ color: 'var(--muted)', maxWidth: '500px', margin: '16px auto' }}>
                To use the My Pipeline feature, you must configure Supabase. Add <code>VITE_SUPABASE_URL</code> and <code>VITE_SUPABASE_ANON_KEY</code> to your <code>.env</code> file.
              </p>
            </div>
          ) : !user ? (
            <div className="glass-panel" style={{ padding: '60px', textAlign: 'center' }}>
              <h2>Login Required</h2>
              <p style={{ color: 'var(--muted)', margin: '16px 0 24px' }}>Login with GitHub to track your open source pipeline across devices.</p>
              <button className="btn btn-primary" onClick={handleLogin}>
                <GitPullRequest size={20} /> Login with GitHub
              </button>
            </div>
          ) : (
            <div className="glass-panel" style={{ padding: '24px' }}>
              <h2>My Pipeline</h2>
              {loading ? (
                <div style={{ padding: '40px', textAlign: 'center' }}><div className="spinner"></div></div>
              ) : pipelineRepos.length === 0 ? (
                <p style={{ color: 'var(--muted)', marginTop: '20px' }}>You aren't watching any repositories yet. Go back to Search to find opportunities!</p>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '12px', marginTop: '20px' }}>
                  {pipelineRepos.map(repo => (
                    <div key={repo.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '16px', background: 'rgba(0,0,0,0.3)', border: '1px solid var(--border)', borderRadius: '8px' }}>
                      <div>
                        <a href={repo.repo_url} target="_blank" rel="noreferrer" style={{ color: 'var(--accent)', textDecoration: 'none', fontWeight: '600', fontSize: '1.1rem' }}>
                          {repo.repo_full_name}
                        </a>
                        <div style={{ fontSize: '0.85rem', color: 'var(--muted)', marginTop: '4px' }}>
                          Status: <span style={{ color: repo.status === 'merged' ? 'var(--success)' : 'var(--text)' }}>{repo.status.toUpperCase()}</span>
                        </div>
                      </div>
                      <div style={{ display: 'flex', gap: '8px' }}>
                        {repo.status !== 'submitted' ? (
                          <>
                            <button className="btn" onClick={() => updateRepoStatus(user.id, repo.repo_full_name, 'contributing')}>Contributing</button>
                            <button className="btn btn-success" onClick={() => handleSubmitPR(repo)}>
                              <CheckCircle size={16} /> I Submitted a PR!
                            </button>
                          </>
                        ) : (
                          <div style={{ fontSize: '0.85rem', color: 'var(--success)', display: 'flex', alignItems: 'center', gap: '6px' }}>
                            <CheckCircle size={16} /> Feedback Recorded
                          </div>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </main>
      )}
    </div>
  );
}

function RepoCard({ data, onWatch }) {
  const { repo, stats, scores } = data;
  
  const getScoreClass = (score) => {
    if (score >= 80) return 'score-hot';
    if (score >= 60) return 'score-good';
    return 'score-low';
  };

  return (
    <div className="glass-panel" style={{ padding: '24px', display: 'flex', flexDirection: 'column', gap: '16px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <div>
          <a href={repo.html_url} target="_blank" rel="noreferrer" style={{ color: 'var(--accent)', textDecoration: 'none', fontSize: '1.2rem', fontWeight: '600' }}>
            {repo.full_name}
          </a>
          <div style={{ color: 'var(--muted)', fontSize: '0.9rem', marginTop: '4px' }}>
            ⭐ {(repo.stargazers_count / 1000).toFixed(1)}k
          </div>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: '4px' }}>
          <div className={`score-badge ${getScoreClass(scores.total)}`}>
            GOR {scores.total}
          </div>
          {stats.surfaceCount > 5 && (
            <div style={{ fontSize: '0.7rem', color: 'var(--danger)', fontWeight: '600', padding: '2px 6px', background: 'rgba(239, 68, 68, 0.1)', borderRadius: '4px' }}>
              Cooldown Penalty
            </div>
          )}
        </div>
      </div>

      <p style={{ margin: 0, fontSize: '0.95rem', color: 'var(--text)', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>
        {repo.description || 'No description provided.'}
      </p>

      {stats.isTypoTrap && (
        <div style={{ background: 'rgba(239, 68, 68, 0.1)', border: '1px solid var(--danger)', padding: '10px', borderRadius: '8px', fontSize: '0.85rem', color: '#fca5a5' }}>
          ⚠️ <strong>Typo-Trap Warning:</strong> Recent first-timer PRs only modified non-code files. High risk of low career ROI.
        </div>
      )}

      {stats.requiresCLA && (
        <div style={{ background: 'rgba(245, 158, 11, 0.1)', border: '1px solid #f59e0b', padding: '10px', borderRadius: '8px', fontSize: '0.85rem', color: '#fcd34d' }}>
          📝 <strong>CLA Required:</strong> This repository requires a Contributor License Agreement, adding friction to your first PR.
        </div>
      )}

      {stats.isVipOrg && (
        <div style={{ background: 'rgba(59, 130, 246, 0.1)', border: '1px solid var(--accent)', padding: '10px', borderRadius: '8px', fontSize: '0.85rem', color: '#93c5fd' }}>
          🏆 <strong>Tier-1 Org:</strong> Massive resume/LinkedIn value.
        </div>
      )}

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px', background: 'rgba(0,0,0,0.3)', padding: '12px', borderRadius: '8px' }}>
        <div>
          <div style={{ fontSize: '0.75rem', color: 'var(--muted)', textTransform: 'uppercase' }}>Time to Merge</div>
          <div style={{ fontWeight: '600', color: stats.avgTtmDays < 4 ? 'var(--success)' : 'var(--text)' }}>
            {stats.avgTtmDays > 0 ? `${stats.avgTtmDays} days` : 'N/A'}
          </div>
        </div>
        <div>
          <div style={{ fontSize: '0.75rem', color: 'var(--muted)', textTransform: 'uppercase' }}>PR Merge Rate</div>
          <div style={{ fontWeight: '600', color: stats.mergeRate > 50 ? 'var(--success)' : 'var(--danger)' }}>
            {stats.mergeRate}%
          </div>
        </div>
        <div>
          <div style={{ fontSize: '0.75rem', color: 'var(--muted)', textTransform: 'uppercase' }}>First Timer PRs</div>
          <div style={{ fontWeight: '600' }}>
            {stats.firstTimerPRs.length}
            {stats.firstTimerPRs.length > 0 && (
              <div style={{ display: 'flex', gap: '4px', flexWrap: 'wrap', marginTop: '4px' }}>
                {stats.firstTimerPRs.slice(0, 3).map(pr => (
                  <a 
                    key={pr.id} 
                    href={pr.html_url} 
                    target="_blank" 
                    rel="noreferrer" 
                    style={{ fontSize: '0.75rem', color: 'var(--accent)', textDecoration: 'none', background: 'rgba(255,255,255,0.1)', padding: '2px 4px', borderRadius: '4px' }}
                    title={pr.title}
                  >
                    #{pr.number}
                  </a>
                ))}
              </div>
            )}
          </div>
        </div>
        <div>
          <div style={{ fontSize: '0.75rem', color: 'var(--muted)', textTransform: 'uppercase' }}>Code PRs</div>
          <div style={{ fontWeight: '600' }}>{stats.codeVsDocs}</div>
        </div>
        <div>
          <div style={{ fontSize: '0.75rem', color: 'var(--muted)', textTransform: 'uppercase' }}>Good First Issues</div>
          <div style={{ fontWeight: '600', color: stats.goodFirstIssues > 0 ? 'var(--success)' : 'var(--text)' }}>
            {stats.goodFirstIssues} Open
          </div>
        </div>
      </div>

      <div style={{ display: 'flex', gap: '8px', marginTop: 'auto', paddingTop: '16px' }}>
        <a href={repo.html_url} target="_blank" rel="noreferrer" className="btn btn-primary" style={{ flex: 1, justifyContent: 'center', textDecoration: 'none' }}>
          <GitPullRequest size={18} /> View Repo
        </a>
        <button className="btn" onClick={onWatch} style={{ flex: 1, justifyContent: 'center' }}>
          <Bookmark size={18} /> Watch
        </button>
      </div>
    </div>
  );
}

export default App;

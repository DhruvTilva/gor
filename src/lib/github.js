export const GH_BASE = 'https://api.github.com';

let githubToken = null;

export const setGithubToken = (token) => {
  githubToken = token;
};

export const getGithubToken = () => githubToken;

export const rateLimitState = {
  remaining: null,
  reset: null
};

// VIP Organizations with immense career value
const VIP_ORGS = [
  'huggingface', 'langchain-ai', 'openai', 'microsoft', 'meta-llama', 
  'vercel', 'pytorch', 'google', 'anthropic', 'supabase'
];

export async function ghFetch(path) {
  const headers = { 'Accept': 'application/vnd.github+json' };
  if (githubToken) headers['Authorization'] = `Bearer ${githubToken}`;

  const res = await fetch(`${GH_BASE}${path}`, { headers });
  rateLimitState.remaining = res.headers.get('X-RateLimit-Remaining');
  rateLimitState.reset = res.headers.get('X-RateLimit-Reset');

  if (!res.ok) {
    if (res.status === 403 && res.headers.get('X-RateLimit-Remaining') === '0') {
      throw new Error('GitHub API rate limit exceeded.');
    }
    throw new Error(`GitHub API error: ${res.status}`);
  }
  return res.json();
}

function daysAgo(n) {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d.toISOString().split('T')[0];
}

export async function searchRepos(keywords, filters) {
  const keywordList = keywords.split(' ');
  const primary = keywordList[0];
  let q = `${primary} in:name,description,topics`;
  q += ` stars:>=${filters.minStars}`;
  q += ` pushed:>${daysAgo(30)}`;
  if (filters.excludeForks) q += ' fork:false';
  if (filters.language !== 'any') q += ` language:${filters.language}`;

  const data = await ghFetch(`/search/repositories?q=${encodeURIComponent(q)}&sort=stars&order=desc&per_page=20`);
  return data.items || [];
}

export async function getClosedPRs(owner, repo) {
  // Fetch up to 100 recent closed PRs
  const page1 = await ghFetch(`/repos/${owner}/${repo}/pulls?state=closed&sort=updated&direction=desc&per_page=100&page=1`);
  return page1;
}

export async function getPRFiles(owner, repo, pullNumber) {
  try {
    const files = await ghFetch(`/repos/${owner}/${repo}/pulls/${pullNumber}/files`);
    return files;
  } catch (e) {
    return [];
  }
}

export async function analyzeOpportunity(repo, filters) {
  const prs = await getClosedPRs(repo.owner.login, repo.name);
  
  // Exclude maintainer PRs to find true external contribution stats
  const externalPRs = prs.filter(pr => 
    ['FIRST_TIME_CONTRIBUTOR', 'NONE', 'CONTRIBUTOR'].includes(pr.author_association)
  );

  const mergedExternal = externalPRs.filter(pr => pr.merged_at !== null);
  const mergeRate = externalPRs.length > 0 ? (mergedExternal.length / externalPRs.length) * 100 : 0;

  // Find First-timer PRs within the window
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - filters.firstTimerDays);
  
  const firstTimerPRs = mergedExternal.filter(pr => {
    const mergedDate = new Date(pr.merged_at);
    return mergedDate > cutoff && ['FIRST_TIME_CONTRIBUTOR', 'NONE'].includes(pr.author_association);
  });

  // Calculate Time-To-Merge (TTM) in days
  let avgTtmDays = 0;
  if (mergedExternal.length > 0) {
    const ttmSum = mergedExternal.reduce((acc, pr) => {
      const ms = new Date(pr.merged_at) - new Date(pr.created_at);
      return acc + (ms / 86400000);
    }, 0);
    avgTtmDays = ttmSum / mergedExternal.length;
  }

  // Typo-Trap Detection (Check files of the most recent first-timer PR)
  let codeVsDocs = 'Unknown';
  let isTypoTrap = false;
  if (firstTimerPRs.length > 0) {
    const latestPR = firstTimerPRs[0];
    const files = await getPRFiles(repo.owner.login, repo.name, latestPR.number);
    if (files.length > 0) {
      const codeFiles = files.filter(f => f.filename.match(/\.(py|js|ts|jsx|tsx|go|rs|cpp|c|java|rb)$/i));
      const codePercentage = (codeFiles.length / files.length) * 100;
      codeVsDocs = `${Math.round(codePercentage)}% Code`;
      if (codePercentage === 0) {
        isTypoTrap = true;
      }
    }
  }

  // Tier-1 Org Status
  const isVipOrg = VIP_ORGS.includes(repo.owner.login.toLowerCase());

  // Calculate Scores
  let oppScore = 0;
  if (firstTimerPRs.length > 0) oppScore += 40;
  if (firstTimerPRs.length >= 3) oppScore += 20;
  if (mergeRate > 50) oppScore += 20;
  if (avgTtmDays < 7 && avgTtmDays > 0) oppScore += 20;
  if (isTypoTrap) oppScore = Math.max(0, oppScore - 50); // Massive penalty for typo traps

  let careerScore = 0;
  if (isVipOrg) careerScore += 50;
  if (repo.stargazers_count > 10000) careerScore += 25;
  if (!isTypoTrap && firstTimerPRs.length > 0) careerScore += 25;

  let friendlinessScore = 0;
  if (avgTtmDays < 3 && avgTtmDays > 0) friendlinessScore += 40;
  else if (avgTtmDays < 7) friendlinessScore += 20;
  if (mergeRate > 60) friendlinessScore += 40;
  if (repo.has_wiki || repo.has_pages) friendlinessScore += 20;

  // Placeholder for Momentum (will be populated by Supabase if available)
  let momentumScore = 0;

  // GOR Score
  const totalScore = Math.round((oppScore * 0.4) + (careerScore * 0.3) + (friendlinessScore * 0.3));

  return {
    repo,
    stats: {
      firstTimerPRs,
      mergeRate: Math.round(mergeRate),
      avgTtmDays: Math.round(avgTtmDays * 10) / 10,
      codeVsDocs,
      isTypoTrap,
      isVipOrg
    },
    scores: {
      total: totalScore,
      opportunity: oppScore,
      career: careerScore,
      friendliness: friendlinessScore,
      momentum: momentumScore
    }
  };
}

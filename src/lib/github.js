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

  const url = `${GH_BASE}${path}`;
  console.log('GitHub Request:', url);

  const res = await fetch(url, { headers });
  rateLimitState.remaining = res.headers.get('X-RateLimit-Remaining');
  rateLimitState.reset = res.headers.get('X-RateLimit-Reset');

  if (!res.ok) {
    if (res.status === 403 && res.headers.get('X-RateLimit-Remaining') === '0') {
      throw new Error('GitHub API rate limit exceeded.');
    }
    
    // Read body text for diagnostic logging
    let responseBody = '';
    try {
      responseBody = await res.text();
    } catch (e) {}

    console.error('GitHub API Failure', {
      url,
      status: res.status,
      statusText: res.statusText,
      responseBody
    });

    throw new Error(`GitHub API error: ${res.status}\nDetails: ${responseBody.substring(0, 100)}`);
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
  
  if (filters.maxStars) {
    q += ` stars:${filters.minStars}..${filters.maxStars}`;
  } else {
    q += ` stars:>=${filters.minStars}`;
  }
  
  q += ` pushed:>${daysAgo(30)}`;
  
  if (filters.createdAfter) {
    q += ` created:>${filters.createdAfter}`;
  }
  
  if (filters.excludeForks) q += ' fork:false';
  if (filters.language !== 'any') q += ` language:${filters.language}`;

  const sort = filters.sort || 'stars';
  // Phase 4.1: Recommendation Diversity (Sampling)
  // Fetch a random page (1 to 3) to diversify results and prevent hammering the exact same top 20 repos
  const page = Math.floor(Math.random() * 3) + 1;
  const data = await ghFetch(`/search/repositories?q=${encodeURIComponent(q)}&sort=${sort}&order=desc&per_page=20&page=${page}`);
  return data.items || [];
}

export async function getClosedPRs(owner, repo) {
  try {
    const page1 = await ghFetch(`/repos/${owner}/${repo}/pulls?state=closed&sort=updated&direction=desc&per_page=100&page=1`);
    return page1;
  } catch (e) {
    if (e.message.includes('404') || e.message.includes('410') || e.message.includes('403')) {
      console.warn(`PRs disabled or inaccessible for ${owner}/${repo}`);
      return [];
    }
    throw e;
  }
}

export async function getPRFiles(owner, repo, pullNumber) {
  try {
    const files = await ghFetch(`/repos/${owner}/${repo}/pulls/${pullNumber}/files`);
    return files;
  } catch (e) {
    return [];
  }
}

export async function getOpenIssues(owner, repo) {
  try {
    // Core API is much safer than Search API for rate limits
    const data = await ghFetch(`/repos/${owner}/${repo}/issues?state=open&sort=updated&direction=desc&per_page=30`);
    return data.filter(i => !i.pull_request && i.labels.some(l => 
      l.name.toLowerCase() === 'good first issue' || l.name.toLowerCase() === 'help wanted'
    ));
  } catch (e) {
    return [];
  }
}

export async function getPRChecks(owner, repo, sha) {
  try {
    const data = await ghFetch(`/repos/${owner}/${repo}/commits/${sha}/check-runs`);
    return data.check_runs || [];
  } catch (e) {
    return [];
  }
}

export async function getOrgDetails(owner) {
  try {
    return await ghFetch(`/users/${owner}`);
  } catch (e) {
    return null;
  }
}

export async function analyzeOpportunity(repo, filters) {
  const [prs, openIssues, orgDetails] = await Promise.all([
    getClosedPRs(repo.owner.login, repo.name),
    getOpenIssues(repo.owner.login, repo.name),
    repo.owner.type === 'Organization' ? getOrgDetails(repo.owner.login) : Promise.resolve(null)
  ]);
  
  // Exclude maintainer PRs and bots to find true external human contribution stats
  const externalPRs = prs.filter(pr => {
    if (pr.user?.type === 'Bot' || pr.user?.login?.toLowerCase().endsWith('[bot]')) return false;
    return ['FIRST_TIME_CONTRIBUTOR', 'NONE', 'CONTRIBUTOR'].includes(pr.author_association);
  });

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

  // Typo-Trap Detection (Check files of up to 3 most recent first-timer PRs)
  let codeVsDocs = 'Unknown';
  let isTypoTrap = false;
  if (firstTimerPRs.length > 0) {
    const prsToCheck = firstTimerPRs.slice(0, 3);
    let zeroCodePrCount = 0;
    let totalCodePercentage = 0;

    for (const pr of prsToCheck) {
      const files = await getPRFiles(repo.owner.login, repo.name, pr.number);
      if (files.length > 0) {
        const codeFiles = files.filter(f => f.filename.match(/\.(py|js|ts|jsx|tsx|go|rs|cpp|c|java|rb)$/i));
        const codePercentage = (codeFiles.length / files.length) * 100;
        totalCodePercentage += codePercentage;
        if (codePercentage === 0) {
          zeroCodePrCount++;
        }
      }
    }

    if (prsToCheck.length > 0) {
      codeVsDocs = `${Math.round(totalCodePercentage / prsToCheck.length)}% Code`;
      const zeroCodeRatio = zeroCodePrCount / prsToCheck.length;
      if (zeroCodeRatio >= 0.7) {
        isTypoTrap = true;
      }
    }
  }

  // Phase 3.2: CLA Detection
  let requiresCLA = false;
  if (firstTimerPRs.length > 0) {
    const latestPR = firstTimerPRs[0];
    const checks = await getPRChecks(repo.owner.login, repo.name, latestPR.head.sha);
    const claNames = ['cla/google', 'cla-assistant', 'license/cla', 'easycla', 'cla check'];
    requiresCLA = checks.some(check => 
      claNames.some(cla => check.name.toLowerCase().includes(cla))
    );
  }

  // Tier-1 Org Status
  const isVipOrg = VIP_ORGS.includes(repo.owner.login.toLowerCase());
  const isLivePrestigeOrg = orgDetails && (orgDetails.followers > 10000 || orgDetails.is_verified);

  // Analyze Open Issues
  let hasStaleIssues = false;
  let hasFreshIssues = false;
  if (openIssues.length > 0) {
    const oldestIssueDate = new Date(openIssues[openIssues.length - 1].created_at);
    const daysOld = (new Date() - oldestIssueDate) / 86400000;
    if (daysOld > 90) {
      hasStaleIssues = true;
    } else {
      hasFreshIssues = true;
    }
  }

  // Calculate Scores
  let oppScore = 0;
  
  // Phase 2.1: Scaled First-Timer Credit
  if (firstTimerPRs.length >= 1) {
    oppScore += 30; // Base credit
    const additionalPRs = firstTimerPRs.length - 1;
    const scaledBonus = Math.min(50, additionalPRs * 10); // +10 per PR, max +50
    oppScore += scaledBonus;
  }

  if (mergeRate > 50) oppScore += 20;
  // REMOVED TTM FROM OPPORTUNITY SCORE (Phase 5: Decoupled)
  
  // Phase 2.2: Good First Issue Fetching
  if (hasFreshIssues) oppScore += 15;
  if (hasStaleIssues && !hasFreshIssues) oppScore -= 10;

  if (isTypoTrap) oppScore = Math.max(0, oppScore - 50); // Massive penalty for typo traps
  if (requiresCLA) oppScore = Math.max(0, oppScore - 20); // Friction penalty

  let careerScore = 0;
  if (isVipOrg) careerScore += 50;
  if (isLivePrestigeOrg && !isVipOrg) careerScore += 25; // Live prestige fallback
  if (repo.stargazers_count > 10000 && !filters.ignoreStarScore) careerScore += 25;
  if (!isTypoTrap && firstTimerPRs.length > 0) careerScore += 25;

  let friendlinessScore = 0;
  if (isTypoTrap && avgTtmDays < 0.5) friendlinessScore -= 40; // Penalize trivial instant merges

  if (avgTtmDays < 3 && avgTtmDays >= 0) friendlinessScore += 60; // Boosted to replace MergeRate double-counting
  else if (avgTtmDays < 7) friendlinessScore += 30; // Boosted
  
  // REMOVED MERGE RATE FROM FRIENDLINESS SCORE (Phase 5: Decoupled)

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
      isVipOrg,
      goodFirstIssues: openIssues.length,
      requiresCLA
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

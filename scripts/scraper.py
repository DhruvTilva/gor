import requests
from bs4 import BeautifulSoup
import os
import time
import re
from supabase import create_client, Client

# Use environment variables or hardcode for local testing
SUPABASE_URL = os.environ.get("VITE_SUPABASE_URL", "YOUR_SUPABASE_URL")
SUPABASE_KEY = os.environ.get("VITE_SUPABASE_ANON_KEY", "YOUR_SUPABASE_ANON_KEY")

def scrape_trending():
    print("Starting GitHub Trending Scrape...")
    
    if SUPABASE_URL == "YOUR_SUPABASE_URL":
        print("WARNING: Please set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY")
        # For safety in test, we will not exit, just warn. Ensure you paste keys before running!

    # Initialize Supabase client
    try:
        supabase: Client = create_client(SUPABASE_URL, SUPABASE_KEY)
    except Exception as e:
        print(f"Failed to initialize Supabase: {e}")
        return

    languages = ['python', 'jupyter-notebook', 'typescript']
    ranges = ['daily', 'weekly', 'monthly']
    
    # Store results before DB push
    # We use a dict to deduplicate. Key: full_name
    merged_repos = {}
    tier_weight = {'daily': 3, 'weekly': 2, 'monthly': 1}

    headers = {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/115.0.0.0 Safari/537.36"
    }

    for lang in languages:
        for rng in ranges:
            url = f"https://github.com/trending/{lang}?since={rng}"
            print(f"Fetching {url}...")
            
            try:
                res = requests.get(url, headers=headers, timeout=15)
                res.raise_for_status()
                soup = BeautifulSoup(res.text, "html.parser")
                
                rows = soup.select("article.Box-row")
                if not rows:
                    print(f"  -> No rows found or markup changed for {lang} {rng}")
                    continue
                
                for row in rows:
                    h2 = row.select_one("h2.h3 a")
                    if not h2: continue
                    
                    full_name = h2.get('href', '').lstrip('/')
                    
                    p_desc = row.select_one("p.col-9")
                    description = p_desc.text.strip() if p_desc else ""
                    
                    stars_gained = 0
                    span_stars = row.select_one(".float-sm-right")
                    if span_stars:
                        text = span_stars.text.strip()
                        match = re.search(r'([\d,]+)\s+stars', text)
                        if match:
                            stars_gained = int(match.group(1).replace(',', ''))

                    repo_data = {
                        "repo_full_name": full_name,
                        "language": lang,
                        "tier": rng,
                        "stars_gained": stars_gained,
                        "description": description
                    }
                    
                    # Deduplication logic
                    if full_name not in merged_repos:
                        merged_repos[full_name] = repo_data
                    else:
                        existing = merged_repos[full_name]
                        # Upgrade tier if more granular
                        if tier_weight[rng] > tier_weight[existing['tier']]:
                            existing['tier'] = rng
                        # Keep highest stars gained
                        if stars_gained > existing['stars_gained']:
                            existing['stars_gained'] = stars_gained

            except Exception as e:
                print(f"  -> Failed to fetch {lang} {rng}: {e}")
            
            # Politeness delay
            time.sleep(2)

    final_list = list(merged_repos.values())
    print(f"Scraped {len(final_list)} unique repositories. Pushing to Supabase...")

    # Upsert to Supabase
    success_count = 0
    for repo in final_list:
        try:
            data, count = supabase.table('trending_radar_cache').upsert(repo).execute()
            success_count += 1
        except Exception as e:
            print(f"Failed to insert {repo['repo_full_name']}: {e}")
            
    print(f"Successfully pushed {success_count} repos to Supabase!")

if __name__ == "__main__":
    scrape_trending()

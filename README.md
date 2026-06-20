# GOR Intelligence

**Charge at the right repos. At the right time.**

GOR is a personal intelligence dashboard built with React + Vite that helps you find high-ROI AI/ML open-source repositories to contribute to. It replaces manual searching with deep, predictive GitHub API intelligence.

## Key Features

- **Typo-Trap Detection:** Automatically detects if a repo only accepts trivial documentation PRs, preventing you from wasting time.
- **Time-to-Merge (TTM):** Analyzes historical PRs to show you exactly how many days it takes for outside code to get merged.
- **Tier-1 Org Multiplier:** Prioritizes high-value ecosystems (Hugging Face, OpenAI, Meta) for maximum resume impact.
- **My Pipeline:** A persistent watchlist powered by Supabase to track your contributions across devices.

## Quick Start

1. Install dependencies:
   ```bash
   npm install
   ```
2. Start the development server:
   ```bash
   npm run dev
   ```
3. Open the local link (usually `http://localhost:5173`) in your browser.
4. Add your **GitHub Personal Access Token (PAT)** in the top right to unlock 5000 API requests/hour.

## Supabase Setup (Optional)

To enable the permanent watchlist ("My Pipeline") feature, you need a database to store your saved repos:

1. Create a free project on [Supabase](https://supabase.com/).
2. Copy the contents of `supabase_setup.sql` and run it in your Supabase SQL Editor.
3. Enable **GitHub Authentication** in Supabase settings.
4. Create a `.env` file in this folder and add your keys:
   ```env
   VITE_SUPABASE_URL=your_project_url
   VITE_SUPABASE_ANON_KEY=your_anon_key
   ```
5. Restart your server. You can now log in and save repos!

## How the Intelligence Engine Works

GOR doesn't just sort by stars; it actively calculates your probability of getting a PR merged and the career value of that PR. 

### Constraints & Filtering
Before a repository is even considered, it must pass these baseline filters:
- **Minimum Stars:** 1000+ (to ensure baseline legitimacy).
- **Recency:** Must have code pushed within the last 30 days.
- **Forks Excluded:** Forked repositories are ignored by default.
- **"Hidden Gems" Mode:** If enabled, it explicitly limits searches to repos under 5,000 stars, finding massive opportunities before they go mainstream.

### The Scoring Formula (GOR Score)

The final **GOR Score (0-100)** is a weighted average of three massive pillars: **Opportunity (40%)**, **Career Value (30%)**, and **Friendliness (30%)**.

#### 1. Opportunity Score (40% Weight)
This calculates how wide the "window of opportunity" is right now.
- **+40 points** if there is at least one recent "First-Time Contributor" PR merged.
- **+20 points** if there are 3 or more First-Time PRs merged (High volume).
- **+20 points** if the external PR Merge Rate is greater than 50%.
- **+20 points** if the Average Time-to-Merge (TTM) is under 7 days.
- **Typo-Trap Penalty (-50 points):** GOR inspects the actual files changed in the latest first-timer PR. If 0% of the files are code files (e.g., only `.md` or `.txt`), the repo is flagged as a Typo-Trap and severely penalized.

#### 2. Career Score (30% Weight)
This calculates how much this merged PR will impact your resume.
- **+50 points (Tier-1 Org Multiplier):** If the repo is owned by a massive AI/ML org (Hugging Face, OpenAI, Meta, Microsoft, LangChain, PyTorch, Vercel, Anthropic, Google, Supabase).
- **+25 points** if the repo has over 10,000 stars.
- **+25 points** if they actively accept first-timers *and* it is not a Typo-Trap.

#### 3. Friendliness Score (30% Weight)
This calculates how pleasant the maintainers are to work with.
- **+40 points** if the TTM is insanely fast (under 3 days).
- **+20 points** if the TTM is reasonable (under 7 days).
- **+40 points** if the Merge Rate for external contributors is over 60%.
- **+20 points** if the repository maintains a Wiki or GitHub Pages (indicating good documentation).

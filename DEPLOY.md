# 🚀 Deploying Vibe Check

## Step 1 — Put the code on GitHub

1. Go to **github.com** and create a free account (or log in)
2. Click **"New repository"** → name it `vibe-check` → click **Create**
3. Open Terminal and run these commands one at a time:

```bash
cd ~/Downloads/vibe-check
git init
git add .
git commit -m "first commit"
git branch -M main
git remote add origin https://github.com/YOUR-USERNAME/vibe-check.git
git push -u origin main
```

> Replace `YOUR-USERNAME` with your actual GitHub username.

---

## Step 2 — Deploy on Railway (free, takes 5 minutes)

1. Go to **railway.app** and sign in with GitHub
2. Click **"New Project"** → **"Deploy from GitHub repo"** → pick `vibe-check`
3. Railway will detect it's a Node.js app and start building automatically
4. Once deployed, click **"Variables"** tab and add:
   - Key: `PERPLEXITY_KEY`
   - Value: `YOUR-PERPLEXITY-KEY-HERE`
5. Click **Redeploy** — your app is now live at a Railway URL like:
   `https://vibe-check-production.up.railway.app`

---

## Step 3 — Add your custom domain

You have two options:

### Option A: Subdomain — `vibecheck.michaelrad.me` ✅ (recommended, easiest)

1. In Railway, go to **Settings → Domains → Custom Domain**
2. Type `vibecheck.michaelrad.me` and click Add
3. Railway will show you a CNAME record to add, like:
   - **Type:** CNAME
   - **Name:** vibecheck
   - **Value:** something.railway.app
4. Log into wherever you manage `michaelrad.me` (GoDaddy, Namecheap, Cloudflare, etc.)
5. Go to DNS settings and add that CNAME record
6. Wait 5–30 minutes for it to propagate — then `vibecheck.michaelrad.me` is live!

### Option B: Path — `michaelrad.me/vibecheck` (more complex)

This requires your main site to "proxy" requests to Railway. How you do this depends on how `michaelrad.me` is hosted:

- **Vercel:** Add a `vercel.json` file to your main site with a rewrite rule
- **Netlify:** Add a `_redirects` file with a proxy rule
- **Cloudflare:** Use a Page Rule or Worker to proxy the path

Let me know how your main site is hosted and I can write the exact config for you.

---

## Cost

- **Railway:** Free tier includes 500 hours/month (enough for a side project). Paid plans start at $5/month for always-on.
- **Perplexity API:** Charged per query. Each Vibe Check runs ~4 queries using `sonar-pro`. Keep an eye on usage at perplexity.ai/api.

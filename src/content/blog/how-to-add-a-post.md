---
title: "How to publish a new blog post"
description: "A 30-second guide for the team: drop a markdown file, push to GitHub, done."
date: "2026-05-11"
author: "n8n-mcp team"
tags: ["meta", "guide"]
---

Adding a new post takes about 30 seconds.

1. Create a file at `src/content/blog/<your-slug>.md`. The filename
   (without `.md`) becomes the URL: `/blog/<your-slug>`.
2. Add the frontmatter block at the top:

   ```md
   ---
   title: "My great post"
   description: "One-sentence summary used for cards + SEO."
   date: "2026-05-12"
   author: "Your name"
   tags: ["release", "tutorial"]
   ---
   ```

3. Write the body in Markdown. GitHub-flavored markdown (tables, task
   lists, fenced code blocks) is supported.
4. Commit and push. CI builds the new image, watchtower pulls it on
   the VPS within ~5 minutes, and the post is live.

No database, no admin panel — your git history *is* the CMS.

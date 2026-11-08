# Framer task: publish the Vortex MCP homepage and privacy policy

You are working on the Framer project that publishes **https://www.vortex.so**, the website of PT Vortex Buana Edumedia. Add two new pages and publish them. Do not change anything else on the site.

## Why these pages are needed

Google reviews the OAuth app "Vortex MCP" before it shows the app's name and logo on the Google sign-in consent screen. Google needs:

- an app homepage on our own domain that explains what Vortex MCP does and why it needs Google data, with a link to the privacy policy;
- a privacy policy page on the same domain, written as real text in the page HTML.

Google's checker reads the page HTML without running JavaScript. It cannot read iframes or embeds. The existing page https://www.vortex.so/privacy is a Notion embed, which is why the last review failed. Do not reuse or change that page.

## Files in this folder

| File | Use |
|---|---|
| `homepage.md` | Content of the new page `/mcp` |
| `privacy-policy.md` | Content of the new page `/mcp/privacy` |
| `vortex-logo-square-480.png` | Logo image shown on `/mcp` |
| `vortex-logo-square-120.png` | Not for Framer. The site owner uploads it to Google Cloud. |

## Page 1: `/mcp`

1. Create a new page with the path `/mcp`. Use the same header (navigation) and footer as the site's other pages.
2. Add the content of `homepage.md` in the same order and with the same wording:
   - `# Vortex MCP` becomes the page's only H1.
   - Lines starting with `##` become H2 headings. Bold text stays bold. Bullet and numbered lists stay lists.
   - The table becomes a table. If Framer cannot show a table, use a two-column list with the same words under the headings "Permission" and "Used for".
   - Replace the line `[logo: vortex-logo-square-480.png]` with the image `vortex-logo-square-480.png`, shown 96 to 160 px wide next to or above the H1. Alt text: `Vortex MCP logo`.
3. Links:
   - "Privacy Policy" links to `https://www.vortex.so/mcp/privacy`. Enter it as a full URL, not as an internal page link, so the page HTML contains the full address.
   - `solution@vortex.so` links to `mailto:solution@vortex.so`.
4. Page settings:
   - Title: `Vortex MCP`
   - Description: `Vortex MCP connects AI assistants such as Claude Desktop to Google Ads and Google Drive.`
   - Search engine indexing: allowed. No password.

## Page 2: `/mcp/privacy`

1. Create a new page with the path `/mcp/privacy`, with the same header and footer.
2. Add the full content of `privacy-policy.md`, in the same order and with the same wording. Format headings, paragraphs, lists and tables as on page 1. Text in backticks (for example `https://www.googleapis.com/auth/drive`) stays exactly as written; a monospace style is optional.
3. Links:
   - "Google API Services User Data Policy" links to `https://developers.google.com/terms/api-services-user-data-policy`.
   - "Third-party connections" links to `https://myaccount.google.com/connections`.
   - Every `solution@vortex.so` links to `mailto:solution@vortex.so`.
4. Page settings:
   - Title: `Vortex MCP Privacy Policy`
   - Description: `How Vortex MCP accesses, uses, stores and shares Google user data.`
   - Search engine indexing: allowed. No password.

## Rules

- Put all text in native Framer text layers or Framer CMS rich text. Never use an Embed, iframe, Notion page, Google Doc, PDF, code component or image of text for any part of the content.
- Do not rewrite, shorten, translate or reorder the content. Change formatting only where Framer requires it.
- Check the Desktop, Tablet and Phone breakpoints. All content must be visible and readable on each.
- Do not edit, rename, move or delete any existing page, including `/`, `/privacy` and `/terms`. Do not change site-wide settings, navigation or domains.
- Framer publishes the whole project at once. Before you publish, check whether the project has unpublished changes that you did not make. If it does, stop and ask the site owner before publishing.

## Publish

Publish the site to the production domain `www.vortex.so`.

## Acceptance checks

Run these after publishing. All must pass.

```bash
# 1. Both pages answer 200 directly, with no redirect.
#    Expected output for each: "200 " (nothing after 200).
curl -s -o /dev/null -w '%{http_code} %{redirect_url}\n' https://www.vortex.so/mcp
curl -s -o /dev/null -w '%{http_code} %{redirect_url}\n' https://www.vortex.so/mcp/privacy

# 2. The text is in the raw HTML. Each count must be 1 or more.
curl -s https://www.vortex.so/mcp | grep -c 'Vortex MCP'
curl -s https://www.vortex.so/mcp | grep -c 'https://www.vortex.so/mcp/privacy'
curl -s https://www.vortex.so/mcp | grep -c 'Limited Use requirements'
curl -s https://www.vortex.so/mcp/privacy | grep -c 'Vortex MCP Privacy Policy'
curl -s https://www.vortex.so/mcp/privacy | grep -c 'Limited Use requirements'
curl -s https://www.vortex.so/mcp/privacy | grep -c 'auth/adwords'
curl -s https://www.vortex.so/mcp/privacy | grep -c 'solution@vortex.so'

# 3. No embeds on the new pages. Each count must be 0.
curl -s https://www.vortex.so/mcp | grep -ci '<iframe'
curl -s https://www.vortex.so/mcp/privacy | grep -ci '<iframe'

# 4. Page titles.
#    Expected: <title>Vortex MCP</title> and <title>Vortex MCP Privacy Policy</title>
curl -s https://www.vortex.so/mcp | grep -o '<title>[^<]*</title>'
curl -s https://www.vortex.so/mcp/privacy | grep -o '<title>[^<]*</title>'

# 5. Existing pages still work. Each must print 200.
curl -s -o /dev/null -w '%{http_code}\n' https://www.vortex.so/
curl -s -o /dev/null -w '%{http_code}\n' https://www.vortex.so/privacy
```

## Report back

- The two live URLs.
- The full output of the acceptance checks.
- Screenshots of both pages at desktop and phone width.
- Anything you could not do exactly as written, and why.

Do not change anything in Google Cloud Console. The site owner does that step.

# Vortex MCP Privacy Policy

Effective date: 8 November 2026
Last updated: 8 November 2026

This Privacy Policy explains how PT Vortex Buana Edumedia ("Vortex", "we", "us") handles information, including Google user data, when you use **Vortex MCP**. Vortex MCP is a connector service that lets AI assistants such as Claude Desktop work with your Google Ads and Google Drive data on your behalf.

Vortex MCP is operated by:

PT Vortex Buana Edumedia
Jalan Lowanu 54, Sorosutan, Umbulharjo, Yogyakarta 55162, Indonesia
Email: solution@vortex.so

This policy covers the Vortex MCP connectors at `ads.mcp.vortex.so`, `ads-write.mcp.vortex.so` and `drive.mcp.vortex.so`, and the Vortex AI gateway that connects your assistant to AI models. Other Vortex websites and products have their own policies.

## 1. What Vortex MCP does

Vortex MCP connects your AI assistant to Google services through the Model Context Protocol (MCP). You connect a Google service by signing in with your Google Account and approving access on Google's consent screen. After that, when you ask the assistant to do something, for example "show last week's campaign spend" or "summarise this document", Vortex MCP calls the relevant Google API with your authorization and returns the result to your assistant.

Vortex MCP acts only on your requests and only within the permissions you granted.

## 2. Google user data we access

We request only the access that the connector you choose needs.

**Account identification (all connectors)**

| Scope | Data accessed | Why |
|---|---|---|
| `openid`, `https://www.googleapis.com/auth/userinfo.email` | Your Google Account ID and email address | To identify which Google Account is connected |
| `https://www.googleapis.com/auth/userinfo.profile` (Google Ads connector only) | Your name and profile picture | To show which account the assistant is using |

**Google Ads connector**

| Scope | Data accessed | Why |
|---|---|---|
| `https://www.googleapis.com/auth/adwords` | The Google Ads accounts your Google Account can access, including account and manager-account IDs, campaigns, ad groups, ads, assets, labels, budgets and performance reports | To answer your reporting questions and, in the write-enabled connector only, to create assets and manage labels when you ask |

The read-only connector can list accounts, read metadata and run reports. The write-enabled connector can also create assets and create, update or delete labels and label links. It asks the assistant to confirm each change before applying it.

**Google Drive connector**

| Scope | Data accessed | Why |
|---|---|---|
| `https://www.googleapis.com/auth/drive` | Files and folders in your Google Drive and in shared drives you can access: names, metadata, contents, comments, revisions and sharing permissions | To search, read, create, edit, organise and share files when you ask |
| `https://www.googleapis.com/auth/documents` | Google Docs content and formatting | To read and edit Google Docs when you ask |
| `https://www.googleapis.com/auth/spreadsheets` | Google Sheets content and formulas | To read and edit Google Sheets when you ask |
| `https://www.googleapis.com/auth/presentations` | Google Slides content | To read and edit Google Slides when you ask |

We do not request access to Gmail, Google Calendar, Contacts or any other Google service.

## 3. How we use Google user data

We use Google user data only to provide the features you request through your AI assistant:

- to sign you in and keep your connection working;
- to fetch the data your request needs and return it to your assistant;
- to carry out the actions you request, such as creating a document, updating a sheet, sharing a file or adding a Google Ads label;
- to keep the service secure, prevent abuse and fix errors.

We do **not**:

- sell Google user data;
- use or transfer Google user data for advertising, including targeted, personalised, retargeted or interest-based advertising;
- use Google user data to determine creditworthiness or for lending purposes;
- use Google user data to develop, improve or train generalised or non-personalised AI or machine-learning models;
- allow people to read your Google user data, except (a) with your explicit consent for specific data, for example when you ask us to investigate a problem, (b) when necessary for security, such as investigating abuse, (c) to comply with applicable law, or (d) for internal operations using aggregated, anonymised data.

**Limited Use disclosure.** Vortex MCP's use and transfer to any other app of information received from Google APIs will adhere to the [Google API Services User Data Policy](https://developers.google.com/terms/api-services-user-data-policy), including the Limited Use requirements.

## 4. AI processing

Vortex MCP exists to let an AI assistant work with your data. When the assistant uses a Vortex MCP tool, the result (for example a report or the text of a document) becomes part of your conversation. To write a reply, the conversation, including that result, is sent through the Vortex AI gateway to Anthropic, which runs the Claude models. If a request to Anthropic fails, the gateway may send it to OpenAI instead.

- This transfer happens only to answer your request.
- The AI providers we use do not use this content to train their models. We do not use your Google user data to train any AI model.
- The Vortex AI gateway does not store the content of your prompts, tool results or model replies. It records usage details (time, user, model, token counts and cost) and deletes them after 90 days.

## 5. How we store and protect data

Vortex MCP does not keep copies of your Google Ads data, Drive files or document contents. That data passes through Vortex MCP in memory and goes to your assistant.

We store only what keeps your connection working:

| Data | Where | Protection |
|---|---|---|
| Google OAuth tokens and connector sessions, Google Ads connector | Dedicated storage volume of the connector server (Fly.io, Singapore) | Encrypted by the application (Fernet: AES-128 with HMAC-SHA256) on an encrypted-at-rest volume |
| Google OAuth tokens and connector sessions, Google Drive connector | Dedicated storage volume of the connector server (Fly.io, Singapore) | Encrypted-at-rest volume with restricted file access |
| Your Google Account ID and email address | The same volumes | As above |

All traffic between your device, Vortex MCP, the gateway and Google uses HTTPS (TLS). Only authorised Vortex engineers can access production systems. Service logs are used for troubleshooting and security and are kept for up to 7 days. The Google Ads connector's logs include the text of the report queries the assistant runs, which can include Google Ads account IDs.

## 6. Sharing and disclosure

We share Google user data only:

- **with Google**, to make the API calls you request;
- **with the AI provider** that writes the reply (Anthropic, or OpenAI as a fallback), as described in section 4, to answer your request;
- **with infrastructure providers that host Vortex MCP for us**: Fly.io (connector servers and AI gateway), Cloudflare (sign-in service and gateway), DigitalOcean (AI gateway relay), Neon (gateway usage records) and Upstash (gateway usage tracking). They may use the data only to provide hosting;
- **when required by law**, or to protect the rights, safety and security of our users and Vortex;
- **as part of a merger, acquisition or sale of assets**, only after getting your explicit prior consent.

We do not share Google user data with advertising platforms, data brokers or information resellers.

## 7. Retention and deletion

- **Google Ads and Drive content:** not stored by Vortex MCP.
- **OAuth tokens and account identifiers:** kept while your Google Account is connected. We delete them within 3 × 24 hours after you ask us to.
- **Gateway usage records:** deleted after 90 days.
- **Service logs:** deleted after 7 days.

**You can stop access at any time:**

1. Remove "Vortex MCP" in your Google Account under [Third-party connections](https://myaccount.google.com/connections). Google revokes our access immediately, and Vortex MCP can no longer reach your Google data.
2. Email solution@vortex.so from the email address of the connected account and ask us to delete your data. We delete it within 3 × 24 hours and tell you when it is done.

## 8. Your rights

Under Indonesia's Personal Data Protection Law (Undang-Undang Nomor 27 Tahun 2022) and other laws that may apply to you, you can ask to access, correct or delete your personal data, get a copy of it, and withdraw your consent. Email solution@vortex.so. We act on these requests within 3 × 24 hours.

## 9. Children

Vortex MCP is a business tool and is not intended for people under 18.

## 10. Changes to this policy

If we change how Vortex MCP uses Google user data, we will update this page and the "Last updated" date. Before we use your data in a new way, we will ask for your consent again.

## 11. Contact

PT Vortex Buana Edumedia — solution@vortex.so
Jalan Lowanu 54, Sorosutan, Umbulharjo, Yogyakarta 55162, Indonesia

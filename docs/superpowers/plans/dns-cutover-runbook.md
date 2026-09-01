# DNS cut-over runbook (Will — ~20 minutes + propagation)

Moves DNS for `nexpoint.co.uk` from Namecheap's nameservers to Cloudflare so the
routing Worker can serve `printhub.` / `millhub.` / `opportunities.` subdomains.
The website and email keep working throughout — the records themselves do not
change, only who serves them.

**Current records, verified 2026-09-01** (`dig +short` from this machine):

| Record | Value today |
|---|---|
| NS | `dns1.registrar-servers.com` / `dns2.registrar-servers.com` (Namecheap) |
| A `nexpoint.co.uk` | `185.199.108.153` / `185.199.109.153` / `185.199.110.153` / `185.199.111.153` (GitHub Pages) |
| CNAME `www` | `willlawrie02-rgb.github.io` |
| MX | `0 nexpoint-co-uk.mail.protection.outlook.com` (Microsoft 365 — this is your email) |
| TXT | `MS=ms37585276` · `v=spf1 include:spf.protection.outlook.com -all` |

## The steps

1. Sign in at dash.cloudflare.com (create the free account if none exists —
   check first: the portal capture worker `nexpoint-portal-capture` may already
   live in one; `npx wrangler whoami` from `_system/portal-worker/` will say).
2. Add site -> nexpoint.co.uk -> Free plan. Cloudflare imports existing DNS
   records; confirm every row in the table above survived the import:
   - A records on the apex: 185.199.108.153 / .109.153 / .110.153 / .111.153
   - CNAME www -> willlawrie02-rgb.github.io
   - **MX -> nexpoint-co-uk.mail.protection.outlook.com and both TXT records —
     if these are missing, add them back before continuing, or email stops.**
   All imported records: keep the proxy status they imported with.
3. Add three records (Type CNAME, Proxy status: Proxied/orange):
   - printhub      -> nexpoint.co.uk
   - millhub       -> nexpoint.co.uk
   - opportunities -> nexpoint.co.uk
4. At Namecheap (domain list -> nexpoint.co.uk -> Nameservers -> Custom DNS)
   replace the registrar nameservers with the two Cloudflare gives you on the
   Add-site screen.
5. Wait for Cloudflare to email "nexpoint.co.uk is active" (minutes to a few
   hours). The website keeps working throughout — records are identical.
6. Tell the session it is done; it deploys the router worker
   (`cd _system/subdomain-router && npx wrangler deploy`) and verifies.
7. SSL/TLS -> Overview -> set encryption mode to "Full (strict)".

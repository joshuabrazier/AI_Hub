#!/usr/bin/env node
/*
 * Jira auth matrix. Run:  node diagnose-auth.mjs
 *
 * Tests both hosts with basic auth and prints which combination works, so you
 * stop guessing. Needs JIRA_EMAIL and JIRA_API_TOKEN in the environment.
 *
 *   node -r dotenv/config diagnose-auth.mjs     # if your token lives in .env
 *   JIRA_EMAIL=... JIRA_API_TOKEN=... node diagnose-auth.mjs
 */

const CLOUD_ID = 'ee55cb0e-42ef-42df-ad9c-fc6196dd2f91';
const SITE = 'https://datasagacity.atlassian.net';
const PROXY = `https://api.atlassian.com/ex/jira/${CLOUD_ID}`;

const email = process.env.JIRA_EMAIL;
const token = process.env.JIRA_API_TOKEN;

if (!email || !token) {
  console.error('Set JIRA_EMAIL and JIRA_API_TOKEN first.');
  process.exit(1);
}

// ---- hygiene checks on the credential itself -------------------------------
console.log('\nCREDENTIAL');
console.log('  email           ', JSON.stringify(email));
console.log('  token length    ', token.length);
console.log('  token prefix    ', JSON.stringify(token.slice(0, 5)));
const dirty = [];
if (/\s/.test(token)) dirty.push('contains whitespace');
if (token !== token.trim()) dirty.push('leading or trailing whitespace');
if (/[\r\n]/.test(token)) dirty.push('contains CR or LF (Windows line ending?)');
if (/^["']|["']$/.test(token)) dirty.push('wrapped in quotes');
if (email !== email.trim()) dirty.push('email has surrounding whitespace');
console.log('  hygiene         ', dirty.length ? 'PROBLEM: ' + dirty.join('; ') : 'clean');

const basic = 'Basic ' + Buffer.from(`${email}:${token}`).toString('base64');

async function probe(label, url, headers) {
  try {
    const r = await fetch(url, { headers: { Accept: 'application/json', ...headers } });
    const body = await r.text();

    // Did this response actually come from Jira, or from something in between
    // (corporate proxy, egress filter, WAF)? Without this check a proxy's 403
    // reads as a successful auth, which is how a diagnostic lies to you.
    const jiraHeaders = ['x-seraph-loginreason', 'x-arequestid', 'x-aaccountid', 'atl-traceid', 'x-atlassian-request-id'];
    let jiraShapedBody = false;
    try {
      const j = JSON.parse(body);
      // Jira always answers with one of these shapes, success or error.
      jiraShapedBody = j != null && typeof j === 'object'
        && ('errorMessages' in j || 'errors' in j || 'accountId' in j || 'issues' in j || 'self' in j || 'baseUrl' in j);
    } catch { /* not JSON, so not a Jira API response */ }
    const reached = jiraHeaders.some((h) => r.headers.has(h)) || jiraShapedBody;

    let who = '';
    if (r.status === 200) {
      try { const j = JSON.parse(body); who = ` as ${j.displayName || j.emailAddress || j.accountId || 'ok'}`; } catch {}
    }
    console.log(`  ${String(r.status).padEnd(4)} ${label}${who}${reached ? '' : '   [did NOT reach Jira]'}`);
    const seraph = r.headers.get('x-seraph-loginreason');
    const wwwAuth = r.headers.get('www-authenticate');
    if (seraph)  console.log(`       x-seraph-loginreason: ${seraph}`);
    if (wwwAuth) console.log(`       www-authenticate: ${wwwAuth.slice(0, 70)}`);
    if (r.status !== 200 && body) console.log(`       body: ${body.replace(/\s+/g, ' ').slice(0, 130)}`);
    return { status: r.status, reached };
  } catch (e) {
    console.log(`  ERR  ${label}  ${e.message}`);
    return { status: 0, reached: false };
  }
}

console.log('\nANONYMOUS BASELINE  (proves nothing about your token, included so you know)');
await probe('serverInfo on site, NO auth header', `${SITE}/rest/api/3/serverInfo`, {});

console.log('\nBASIC AUTH, BOTH HOSTS  (this is the real test)');
const a = await probe('myself on SITE domain      (classic token expects this)', `${SITE}/rest/api/3/myself`, { Authorization: basic });
const b = await probe('myself on api.atlassian.com (scoped token REQUIRES this)', `${PROXY}/rest/api/3/myself`, { Authorization: basic });

// A scoped token with only read:jira-work will 403 on /myself but 200 on search.
console.log('\nFALLBACK  (in case the token lacks read:jira-user, which /myself needs)');
const jql = 'search/jql?jql=project%20%3D%20TSSS&maxResults=1&fields=key';
const c = await probe('search on SITE domain', `${SITE}/rest/api/3/${jql}`, { Authorization: basic });
const d = await probe('search on api.atlassian.com', `${PROXY}/rest/api/3/${jql}`, { Authorization: basic });

// ---- verdict ---------------------------------------------------------------
// 200 = credential accepted. 403 counts ONLY if the response provably came from
// Jira, because that means authenticated-but-missing-scope, which still proves
// the host is right. Anything that did not reach Jira proves nothing.
const pass = (...rs) => rs.some((r) => r.status === 200 || (r.status === 403 && r.reached));
const anyReached = [a, b, c, d].some((r) => r.reached);

if (!anyReached) {
  console.log('\nVERDICT');
  console.log('  None of these requests reached Jira. Something between you and');
  console.log('  Atlassian is blocking them: a corporate proxy, a VPN, or an egress');
  console.log('  filter. Nothing here says anything about your token yet. Try from a');
  console.log('  different network before touching the credential.');
  console.log('');
  process.exit(0);
}

const siteOk  = pass(a, c);
const proxyOk = pass(b, d);

console.log('\nVERDICT');
if (proxyOk && !siteOk) {
  console.log('  Your token is SCOPED. Set:');
  console.log(`  JIRA_BASE_URL=${PROXY}`);
} else if (siteOk && !proxyOk) {
  console.log('  Your token is CLASSIC. Set:');
  console.log(`  JIRA_BASE_URL=${SITE}`);
} else if (siteOk && proxyOk) {
  console.log('  Both hosts authenticate. Either works; prefer api.atlassian.com,');
  console.log('  because a service account later will require it.');
} else {
  console.log('  Neither host authenticates, so the problem is the credential or the');
  console.log('  account, not the URL. In order of likelihood:');
  console.log('');
  console.log('  1. The token was revoked or has expired. Check it is still listed at');
  console.log('     https://id.atlassian.com/manage-profile/security/api-tokens');
  console.log('     Regenerating is cheap. Do it on a fresh token, not the same one.');
  console.log('  2. JIRA_EMAIL is not the address on the account that owns the token.');
  console.log('     It must be the exact primary email of that Atlassian account, not');
  console.log('     an alias and not a group address.');
  console.log('  3. Your org has restricted API token use. Check with whoever holds');
  console.log('     Atlassian org admin, under Security, API tokens.');
  console.log('  4. The account has no Jira product access.');
}
console.log('');

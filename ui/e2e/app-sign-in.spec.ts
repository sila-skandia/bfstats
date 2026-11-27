import { Buffer } from 'node:buffer';
import { createHash, randomBytes } from 'node:crypto';
import { expect, test, type Page } from '@playwright/test';
import { loginAsAdmin } from './helpers/auth';

// An app signs in through the browser (features/app-sign-in): the /auth/app
// Allow page, the code exchange, and the dashboard's Signed-in apps tab. The
// app's loopback listener is a Playwright route: the browser's navigation to
// 127.0.0.1:<port>/callback is caught and answered here.

const PORT = 53682;
const REDIRECT = `http://127.0.0.1:${PORT}/callback`;
const API = '/stats/auth/app';

function pkce() {
  const verifier = randomBytes(32).toString('base64url');
  const challenge = createHash('sha256').update(verifier).digest('base64url');
  return { verifier, challenge };
}

function allowPageUrl(params: Record<string, string>) {
  return `/auth/app?${new URLSearchParams(params).toString()}`;
}

function requestParams(device: string, challenge: string, state: string, overrides: Record<string, string> = {}) {
  return {
    client: 'bfstats-relay',
    device,
    redirect_uri: REDIRECT,
    state,
    code_challenge: challenge,
    code_challenge_method: 'S256',
    ...overrides,
  };
}

/** Catches the browser's trip back to the app; resolves with the URL it was sent to. */
function stubLoopback(page: Page): Promise<URL> {
  return new Promise(resolve => {
    void page.route(`http://127.0.0.1:${PORT}/**`, async route => {
      resolve(new URL(route.request().url()));
      await route.fulfill({ contentType: 'text/html', body: '<!doctype html><title>App</title><p>Signed in, you can close this tab.</p>' });
    });
  });
}

async function authHeaders(page: Page) {
  const token = await page.evaluate(() => localStorage.getItem('authToken'));
  return { Authorization: `Bearer ${token}` };
}

test.describe('App sign-in through the browser', () => {
  test.describe.configure({ mode: 'serial' });

  test('signed out, the Allow page goes through sign-in and back', async ({ page }) => {
    const { challenge } = pkce();
    await page.goto('/v4/servers/bf1942');
    await page.evaluate(() => { localStorage.removeItem('authToken'); localStorage.removeItem('userProfile'); });

    await page.goto(allowPageUrl(requestParams('E2E-SIGNED-OUT', challenge, 'abc')));

    await expect(page).toHaveURL(/\/auth\/login\?returnTo=/);
    const returnTo = new URL(page.url()).searchParams.get('returnTo')!;
    expect(returnTo).toContain('/auth/app?');
    expect(returnTo).toContain('device=E2E-SIGNED-OUT');
  });

  test('requests the API would refuse get an error page, never an Allow button', async ({ page }) => {
    await loginAsAdmin(page);
    const { challenge } = pkce();
    const bad: Record<string, string>[] = [
      { redirect_uri: `http://127.0.0.1.evil.com:${PORT}/callback` },
      { redirect_uri: `https://127.0.0.1:${PORT}/callback` },
      { redirect_uri: `http://a@127.0.0.1:${PORT}/callback` },
      { redirect_uri: `http://127.0.0.1:${PORT}/callback/../steal` },
      { redirect_uri: `http://127.0.0.1:${PORT}/callback?next=x` },
      { redirect_uri: 'http://127.0.0.1:80/callback' },
      { client: 'someone-else' },
      { code_challenge_method: 'plain' },
      { code_challenge: 'short' },
      { state: '' },
    ];
    for (const overrides of bad) {
      await page.goto(allowPageUrl(requestParams('E2E-BAD', challenge, 'abc', overrides)));
      await expect(page.getByTestId('app-sign-in-error'), JSON.stringify(overrides)).toBeVisible();
      await expect(page.getByTestId('app-sign-in-allow')).toHaveCount(0);
    }
  });

  test('Allow sends the code back, the app exchanges it, and the dashboard lists and signs it out', async ({ page }, testInfo) => {
    await loginAsAdmin(page);
    const device = `E2E-PC-${Date.now()}`;
    const { challenge } = pkce();
    const state = randomBytes(16).toString('base64url');

    await page.goto(allowPageUrl(requestParams(device, challenge, state)));
    await expect(page.getByRole('heading', { name: /Allow bfstats Relay on .* to use your account\?/ })).toBeVisible();
    await expect(page.getByTestId('app-sign-in-device')).toHaveText(device);
    await expect(page.getByTestId('bfv-band')).toHaveCount(0);
    await expect(page.getByText('Read and change your game profiles')).toBeVisible();
    await expect(page.getByText(`Returns to 127.0.0.1:${PORT}`)).toBeVisible();
    await page.screenshot({ path: testInfo.outputPath('app-sign-in-allow.png'), fullPage: true });

    // Nothing leaves the page on its own.
    await page.waitForTimeout(500);
    expect(new URL(page.url()).pathname).toBe('/auth/app');

    const back = stubLoopback(page);
    await page.getByTestId('app-sign-in-allow').click();
    const callback = await back;
    expect(`${callback.origin}${callback.pathname}`).toBe(REDIRECT);
    expect(callback.searchParams.get('state')).toBe(state);
    const code = callback.searchParams.get('code')!;
    expect(code).toMatch(/^[A-Za-z0-9_-]{43}$/);

    // The app's side: no cookies, the code and the verifier in the body.
    const wrong = await page.request.post(`${API}/token`, {
      data: { code, codeVerifier: pkce().verifier, redirectUri: REDIRECT },
    });
    expect(wrong.status()).toBe(400);
    expect((await wrong.json()).error).toBe('invalid_grant');

    // The wrong verifier spent that code: sign in again for a fresh one.
    const back2 = stubLoopback(page);
    const second = pkce();
    await page.goto(allowPageUrl(requestParams(device, second.challenge, state)));
    await page.getByTestId('app-sign-in-allow').click();
    const code2 = (await back2).searchParams.get('code')!;
    const exchanged = await page.request.post(`${API}/token`, {
      data: { code: code2, codeVerifier: second.verifier, redirectUri: REDIRECT },
    });
    expect(exchanged.status()).toBe(200);
    const tokens = await exchanged.json();
    expect(tokens.accessToken).toBeTruthy();
    expect(tokens.refreshToken).toBeTruthy();
    expect(tokens.user.id).toBeGreaterThan(0);
    expect(exchanged.headers()['set-cookie'] ?? '').not.toContain('rt=');

    // The access token is a normal one.
    const profiles = await page.request.get('/stats/account/game-profiles', {
      headers: { Authorization: `Bearer ${tokens.accessToken}` },
    });
    expect(profiles.status()).toBe(200);

    // The dashboard lists it, and Sign out ends it.
    await page.goto('/v4/dashboard?tab=apps');
    const list = page.getByTestId('signed-in-apps-list');
    const row = list.locator('li', { hasText: device });
    await expect(row).toHaveCount(1);
    await expect(row).toContainText('bfstats Relay');
    await expect(row).toContainText('Last used');
    await page.screenshot({ path: testInfo.outputPath('signed-in-apps.png'), fullPage: true });

    await page.setViewportSize({ width: 390, height: 844 });
    await expect(row.getByRole('button', { name: /Sign out/ })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBeTruthy();
    await page.screenshot({ path: testInfo.outputPath('signed-in-apps-mobile.png'), fullPage: true });
    await page.setViewportSize({ width: 1280, height: 900 });

    await row.getByRole('button', { name: /Sign out/ }).click();
    await expect(list.locator('li', { hasText: device })).toHaveCount(0);

    const refresh = await page.request.post(`${API}/refresh`, { data: { refreshToken: tokens.refreshToken } });
    expect(refresh.status()).toBe(401);
  });

  test('Deny sends access_denied back with the state', async ({ page }) => {
    await loginAsAdmin(page);
    const { challenge } = pkce();
    const back = stubLoopback(page);

    await page.goto(allowPageUrl(requestParams('E2E-DENY', challenge, 'deny-state')));
    await page.getByTestId('app-sign-in-deny').click();

    const callback = await back;
    expect(callback.searchParams.get('error')).toBe('access_denied');
    expect(callback.searchParams.get('state')).toBe('deny-state');
    expect(callback.searchParams.get('code')).toBeNull();
  });

  test('the Allow page fits a phone', async ({ page }, testInfo) => {
    await loginAsAdmin(page);
    await page.setViewportSize({ width: 390, height: 844 });
    const { challenge } = pkce();
    await page.goto(allowPageUrl(requestParams('A-RATHER-LONG-WORKSTATION-NAME-THAT-GOES-ON-AND-ON-1234567890', challenge, 'm')));
    await expect(page.getByTestId('app-sign-in-allow')).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBeTruthy();
    await page.screenshot({ path: testInfo.outputPath('app-sign-in-mobile.png'), fullPage: true });
  });

  test('the API refuses an authorize the page would refuse', async ({ page }) => {
    await loginAsAdmin(page);
    const response = await page.request.post(`${API}/authorize`, {
      headers: await authHeaders(page),
      data: {
        client: 'bfstats-relay', device: 'x', redirectUri: 'http://127.0.0.1.evil.com:8080/callback',
        state: 's', codeChallenge: pkce().challenge, codeChallengeMethod: 'S256',
      },
    });
    expect(response.status()).toBe(400);
  });

  // bfv.bfstats.io, a site hosted for someone else (features/bfv-through-bfstats): the same
  // hand-off, back to its own callback only, and a token that is short-lived, a plain user's
  // and carries no email, even when the admin is the one who signs in.
  test('bfv.bfstats.io signs in to its own callback and gets a plain, short-lived token', async ({ page }) => {
    await loginAsAdmin(page);
    const { challenge, verifier } = pkce();
    const state = randomBytes(16).toString('base64url');
    const local = `http://localhost:${PORT}/auth/callback`;
    const bfv = { client: 'bfv-site', redirect_uri: local, device: '' };

    for (const redirect_uri of [REDIRECT, 'https://evil.example/auth/callback', 'http://bfv.bfstats.io/auth/callback']) {
      await page.goto(allowPageUrl(requestParams('', challenge, state, { ...bfv, redirect_uri })));
      await expect(page.getByTestId('app-sign-in-error'), redirect_uri).toBeVisible();
      await expect(page.getByTestId('app-sign-in-allow')).toHaveCount(0);
    }

    await page.goto(allowPageUrl(requestParams('', challenge, state, bfv)));
    await expect(page.getByRole('heading', { name: 'Allow bfv.bfstats.io to use your account?' })).toBeVisible();
    await expect(page.getByTestId('app-sign-in-device')).toHaveCount(0);
    // In BattleView Vietnam's banner and colours, so the player knows where they are.
    await expect(page.getByTestId('bfv-band')).toBeVisible();
    await expect(page.getByText('Share Battlefield Vietnam recordings and Shorts as you')).toBeVisible();
    // The admin's own sign-in, read while the page is still bfstats.io's.
    const siteHeaders = await authHeaders(page);

    const back = new Promise<URL>(resolve => {
      void page.route(`http://localhost:${PORT}/**`, async route => {
        resolve(new URL(route.request().url()));
        await route.fulfill({ contentType: 'text/html', body: '<!doctype html><title>bfv</title>' });
      });
    });
    await page.getByTestId('app-sign-in-allow').click();
    const code = (await back).searchParams.get('code')!;

    const exchanged = await page.request.post(`${API}/token`, { data: { code, codeVerifier: verifier, redirectUri: local } });
    expect(exchanged.status()).toBe(200);
    const tokens = await exchanged.json();
    const claims = JSON.parse(Buffer.from(tokens.accessToken.split('.')[1], 'base64url').toString());
    expect(claims.client).toBe('bfv-site');
    expect(claims.role).toBe('User');
    expect(JSON.stringify(claims)).not.toContain('@');
    expect(claims.exp - claims.iat).toBeLessThanOrEqual(16 * 60);

    // The admin's own sign-in is an admin; the same account through bfv is not.
    const asSite = await page.request.get('/stats/recordings/me', { headers: siteHeaders });
    expect((await asSite.json()).isAdmin).toBe(true);
    const asBfv = await page.request.get('/stats/recordings/me', { headers: { Authorization: `Bearer ${tokens.accessToken}` } });
    expect(asBfv.status()).toBe(200);
    expect((await asBfv.json()).isAdmin).toBe(false);
  });

  // The Replay Shorts job (features/replay-shorts, "Signing in"): the relay's loopback
  // hand-off under its own name, and a token that carries the account's role, so the
  // render job writes Shorts, prunes included, as the admin who allowed it.
  test('the Shorts job signs in to its loopback and writes Shorts as the admin', async ({ page }) => {
    await loginAsAdmin(page);
    const { challenge, verifier } = pkce();
    const state = randomBytes(16).toString('base64url');
    const shorts = { client: 'bfstats-shorts' };

    await page.goto(allowPageUrl(requestParams('render-box', challenge, state, { ...shorts, redirect_uri: 'https://bfv.bfstats.io/auth/callback' })));
    await expect(page.getByTestId('app-sign-in-error')).toBeVisible();
    await expect(page.getByTestId('app-sign-in-allow')).toHaveCount(0);

    await page.goto(allowPageUrl(requestParams('render-box', challenge, state, shorts)));
    await expect(page.getByRole('heading', { name: /Allow bfstats Shorts job on .* to use your account\?/ })).toBeVisible();
    await expect(page.getByText('Upload, replace, prune and take down Replay Shorts as you')).toBeVisible();
    const back = stubLoopback(page);
    await page.getByTestId('app-sign-in-allow').click();
    const code = (await back).searchParams.get('code')!;

    const exchanged = await page.request.post(`${API}/token`, { data: { code, codeVerifier: verifier, redirectUri: REDIRECT } });
    expect(exchanged.status()).toBe(200);
    const tokens = await exchanged.json();
    const claims = JSON.parse(Buffer.from(tokens.accessToken.split('.')[1], 'base64url').toString());
    expect(claims.client).toBe('bfstats-shorts');
    expect(claims.role).toBe('Admin');

    const job = { Authorization: `Bearer ${tokens.accessToken}` };
    const prune = await page.request.post('/stats/shorts/prune?dryRun=true', { headers: job });
    expect(prune.status()).toBe(200);
    expect((await prune.json()).dryRun).toBe(true);
    const anonymous = await page.request.post('/stats/shorts/prune?dryRun=true', { headers: { Authorization: '' } });
    expect(anonymous.status()).toBe(401);

    // The refresh the job runs when its token is due, then signing it out.
    const refreshed = await page.request.post(`${API}/refresh`, { data: { refreshToken: tokens.refreshToken } });
    expect(refreshed.status()).toBe(200);
    const revoked = await page.request.post(`${API}/revoke`, { data: { refreshToken: (await refreshed.json()).refreshToken } });
    expect(revoked.status()).toBe(204);
  });
});

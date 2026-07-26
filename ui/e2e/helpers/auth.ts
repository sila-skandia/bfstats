import { Page } from '@playwright/test';

export async function loginAsAdmin(page: Page) {
  // Navigate to target origin to establish localStorage context
  await page.goto('/servers/bf1942');
  
  // Call backend auth endpoint through Vite dev server proxy
  const response = await page.request.post('/stats/auth/login', {
    data: { devBypass: true }
  });

  if (!response.ok()) {
    throw new Error(`Failed dev auth login: ${response.status()} ${await response.text()}`);
  }

  const data = await response.json();
  const userProfile = {
    id: data.user.id,
    name: data.user.name,
    email: data.user.email,
    roles: ['Admin', 'Support', 'User']
  };

  // Populate localStorage with valid auth token and user profile
  await page.evaluate(({ token, profile }) => {
    localStorage.setItem('authToken', token);
    localStorage.setItem('userProfile', JSON.stringify(profile));
    localStorage.setItem('dev_admin', 'true');
  }, { token: data.accessToken, profile: userProfile });
}

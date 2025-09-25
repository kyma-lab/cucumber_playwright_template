import { Given, When, Then } from '@cucumber/cucumber';
import { expect } from '@playwright/test';
import { ICustomWorld } from '../support/custom-world';
import { tokenGenerator } from '../utils/tokenGenerator';

Given('I navigate to the secured page', async function (this: ICustomWorld) {
  await this.page?.goto('http://localhost:3000/secured');
});

Then('I should see {string} message', async function (this: ICustomWorld, message: string) {
  const messageElement = this.page?.locator(`h2:has-text("🔒 ${message}")`);
  await expect(messageElement!).toBeVisible();
});

Then('I should see login button', async function (this: ICustomWorld) {
  const loginButton = this.page?.locator('button:has-text("Login with Keycloak")');
  await expect(loginButton!).toBeVisible();
});

// Combined step definition for login scenarios using regex pattern
Given(/^(?:I have a valid token for|I am logged into the test app as) "([^"]*)"$/, async function (this: ICustomWorld, username: string) {
  await this.page?.goto('http://localhost:3000/');

  // Wait for the React app to load
  await this.page?.waitForSelector('h1:has-text("React OIDC Test Application")', { timeout: 10000 });

  // Inject authentication using real token with fallback to mock
  await tokenGenerator.injectUserToken(this.page, username);

  // Reload the page to apply the authentication state
  await this.page?.reload();

  // Wait for the authenticated state (Welcome message) to be visible
  await this.page?.waitForSelector('h2:has-text("Welcome!")', { timeout: 10000 });
});

Then('I should see the secured content', async function (this: ICustomWorld) {
  // Strict assertion: the secured page heading must be visible
  const heading = this.page?.locator('h1:has-text("🔐 Secured Page")');
  await expect(heading!).toBeVisible();

  // Negative assertion: access denied should not be visible for successful authentication
  const accessDenied = this.page?.locator('h2:has-text("🔒 Access Denied")');
  await expect(accessDenied!).not.toBeVisible();
});

Then('I should see {string} in the content', async function (this: ICustomWorld, expectedText: string) {
  // Use a direct locator that finds visible text - more efficient than reading all body text
  const textLocator = this.page?.locator(`body:has-text("${expectedText}")`);
  await expect(textLocator!).toBeVisible();
});

Then('I should see {string} in the user information', async function (this: ICustomWorld, expectedText: string) {
  // Target the specific user information section more precisely
  const userInfoSection = this.page?.locator('h3:has-text("Your Information")').locator('..'); // Parent div
  await expect(userInfoSection!).toContainText(expectedText);
});

When('I click {string} button', async function (this: ICustomWorld, buttonText: string) {
  const button = this.page?.locator(`a:has-text("${buttonText}"), button:has-text("${buttonText}")`);
  await button?.click();
});

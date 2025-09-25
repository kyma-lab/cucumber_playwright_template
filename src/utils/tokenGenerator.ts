import * as jose from 'jose';
import { request } from '@playwright/test';
import dotenv from 'dotenv';

// Load environment variables
dotenv.config();

export interface UserProfile {
  sub: string;
  name: string;
  preferred_username: string;
  given_name: string;
  family_name: string;
  email: string;
  email_verified: boolean;
  iss: string;
  aud: string;
  iat: number;
  exp: number;
  azp: string;
}

export interface MockUser {
  id_token: string;
  access_token: string;
  refresh_token: string;
  token_type: string;
  scope: string;
  profile: UserProfile;
  expires_at: number;
  expired: boolean;
}

export class TokenGenerator {
  private readonly secret = new TextEncoder().encode('your-super-secret-key-for-signing');
  private readonly keycloakUrl: string;
  private readonly realm: string;
  private readonly clientId: string;
  private readonly issuer: string;
  private readonly audience: string;
  private readonly testUsername: string;
  private readonly testPassword: string;

  constructor() {
    this.keycloakUrl = process.env.KEYCLOAK_URL ?? 'http://localhost:8080';
    this.realm = process.env.KEYCLOAK_REALM ?? 'master';
    this.clientId = process.env.KEYCLOAK_CLIENT_ID ?? 'test-client';
    this.testUsername = process.env.TEST_USERNAME ?? 'testuser';
    this.testPassword = process.env.TEST_PASSWORD ?? 'testpass';

    this.issuer = `${this.keycloakUrl}/realms/${this.realm}`;
    this.audience = this.clientId;
  }

  /**
   * Generate a complete mock user session with realistic JWT tokens
   */
  async generateMockUser(username: string, options: Partial<UserProfile> = {}): Promise<MockUser> {
    const now = Math.floor(Date.now() / 1000);

    // Create user profile with defaults
    const userProfile: UserProfile = {
      sub: '8f7d53a0-5cd9-4483-af29-72e107630ada',
      name: 'Test User',
      preferred_username: username,
      given_name: 'Test',
      family_name: 'User',
      email: 'test@example.com',
      email_verified: true,
      iss: this.issuer,
      aud: this.audience,
      iat: now,
      exp: now + 3600, // 1 hour expiration
      azp: this.audience,
      ...options // Allow overriding any profile fields
    };

    // Generate realistic JWT tokens
    const id_token = await new jose.SignJWT({ ...userProfile })
      .setProtectedHeader({ alg: 'HS256' })
      .sign(this.secret);

    const access_token = await new jose.SignJWT({
      sub: userProfile.sub,
      iss: userProfile.iss,
      aud: userProfile.aud,
      iat: now,
      exp: now + 3600,
      scope: 'openid profile email'
    })
      .setProtectedHeader({ alg: 'HS256' })
      .sign(this.secret);

    return {
      id_token,
      access_token,
      refresh_token: 'mock_refresh_token_' + Math.random().toString(36).substr(2, 9),
      token_type: 'Bearer',
      scope: 'openid profile email',
      profile: userProfile,
      expires_at: now + 3600,
      expired: false
    };
  }

  /**
   * Generate localStorage key for OIDC client
   */
  getStorageKey(): string {
    return `oidc.user:${this.issuer}:${this.audience}`;
  }

  /**
   * Inject mock user into browser localStorage
   */
  async injectMockToken(page: unknown, username: string, options: Partial<UserProfile> = {}): Promise<void> {
    const mockUser = await this.generateMockUser(username, options);
    const storageKey = this.getStorageKey();

    await (page as any).evaluate(({ user, key }: { user: unknown; key: string }) => {
      localStorage.setItem(key, JSON.stringify(user));
      sessionStorage.setItem(key, JSON.stringify(user));

      // Trigger storage event to notify React of changes
      window.dispatchEvent(new StorageEvent('storage', {
        key,
        newValue: JSON.stringify(user),
        storageArea: localStorage
      }));
    }, { user: mockUser, key: storageKey });
  }

  /**
   * Fetch real token from Keycloak for testing
   */
  async fetchRealToken(username: string, password: string): Promise<MockUser | null> {
    try {
      const requestContext = await request.newContext();

      // Request token from Keycloak using environment variables
      const tokenUrl = `${this.keycloakUrl}/realms/${this.realm}/protocol/openid-connect/token`;
      const response = await requestContext.post(tokenUrl, {
        form: {
          grant_type: 'password',
          client_id: this.clientId,
          username: username,
          password: password,
          scope: 'openid profile email'
        }
      });

      if (!response.ok()) {
        console.log(`Keycloak token request failed: ${response.status()}`);
        return null;
      }

      const tokenData = await response.json() as any;

      // Decode the JWT to get user profile
      const decodedToken = jose.decodeJwt(tokenData.id_token as string);
      const now = Math.floor(Date.now() / 1000);

      return {
        id_token: tokenData.id_token as string,
        access_token: tokenData.access_token as string,
        refresh_token: (tokenData.refresh_token as string) ?? '',
        token_type: (tokenData.token_type as string) ?? 'Bearer',
        scope: (tokenData.scope as string) ?? 'openid profile email',
        profile: {
          sub: decodedToken.sub!,
          name: (decodedToken.name as string) ?? 'Test User',
          preferred_username: (decodedToken.preferred_username as string) ?? username,
          given_name: (decodedToken.given_name as string) ?? 'Test',
          family_name: (decodedToken.family_name as string) ?? 'User',
          email: (decodedToken.email as string) ?? 'test@example.com',
          email_verified: (decodedToken.email_verified as boolean) ?? true,
          iss: decodedToken.iss as string,
          aud: decodedToken.aud as string,
          iat: (decodedToken.iat as number) ?? now,
          exp: (decodedToken.exp as number) ?? now + 3600,
          azp: decodedToken.azp as string
        },
        expires_at: tokenData.expires_in ? now + (tokenData.expires_in as number) : now + 3600,
        expired: false
      };
    } catch (error) {
      console.log(`Failed to fetch real token: ${String(error)}`);
      return null;
    }
  }

  /**
   * Inject user token (tries real token from Keycloak first, falls back to mock)
   */
  async injectUserToken(page: unknown, username?: string, password?: string, options: Partial<UserProfile> = {}): Promise<void> {
    // Use configured test credentials if not provided
    const user = username ?? this.testUsername;
    const userPassword = password ?? this.testPassword;

    // First try to get a real token from Keycloak
    const realUser = await this.fetchRealToken(user, userPassword);

    if (realUser) {
      console.log(`Using real Keycloak token for ${user}`);
      const storageKey = this.getStorageKey();

      await (page as any).evaluate(({ user, key }: { user: unknown; key: string }) => {
        localStorage.setItem(key, JSON.stringify(user));
        sessionStorage.setItem(key, JSON.stringify(user));

        // Trigger storage event to notify React of changes
        window.dispatchEvent(new StorageEvent('storage', {
          key,
          newValue: JSON.stringify(user),
          storageArea: localStorage
        }));
      }, { user: realUser, key: storageKey });
    } else {
      console.log(`Keycloak unavailable, falling back to mock token for ${user}`);
      await this.injectMockToken(page, user, options);
    }
  }

  /**
   * Verify a JWT token (useful for testing token validity)
   */
  async verifyToken(token: string): Promise<jose.JWTPayload> {
    const { payload } = await jose.jwtVerify(token, this.secret);
    return payload;
  }
}

// Default export for common use cases
export const tokenGenerator = new TokenGenerator();

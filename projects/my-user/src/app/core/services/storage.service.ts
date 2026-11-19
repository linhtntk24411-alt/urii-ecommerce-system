import { isPlatformBrowser } from '@angular/common';
import { inject, Injectable, PLATFORM_ID } from '@angular/core';
import { UriUser } from '../../models/uri.model';

@Injectable({ providedIn: 'root' })
export class StorageService {
  private readonly platformId = inject(PLATFORM_ID);

  private readonly tokenKey = 'urii.auth.token';
  private readonly userKey = 'urii.auth.user';

  getToken(): string | null {
    return this.browserStorage()?.getItem(this.tokenKey) ?? null;
  }

  setToken(token: string): void {
    if (!token.trim()) {
      throw new Error('An authentication token cannot be empty.');
    }
    this.browserStorage()?.setItem(this.tokenKey, token);
  }

  getUser(): UriUser | null {
    const serializedUser = this.browserStorage()?.getItem(this.userKey);
    if (serializedUser == null) {
      return null;
    }

    return UriUser.fromJSON(JSON.parse(serializedUser) as unknown);
  }

  setUser(user: UriUser): void {
    this.browserStorage()?.setItem(this.userKey, JSON.stringify(user));
  }

  clear(): void {
    const storage = this.browserStorage();
    storage?.removeItem(this.tokenKey);
    storage?.removeItem(this.userKey);
  }

  getLegacyToken(): string | null {
    return this.browserStorage()?.getItem('authToken') ?? null;
  }

  clearRejectedSession(token: string): boolean {
    const storage = this.browserStorage();
    if (!storage) return false;

    const modernMatch = storage.getItem(this.tokenKey) === token;
    const legacyMatch = storage.getItem('authToken') === token;
    if (modernMatch) this.clear();
    if (legacyMatch) {
      for (const key of ['authToken', 'isLoggedIn', 'userId', 'userName', 'userEmail', 'userAvatar', 'userRole']) {
        storage.removeItem(key);
      }
      window.dispatchEvent(new Event('auth:changed'));
    }
    return (modernMatch || legacyMatch) && !this.getToken() && !this.getLegacyToken();
  }

  private browserStorage(): Storage | null {
    return isPlatformBrowser(this.platformId) ? localStorage : null;
  }
}

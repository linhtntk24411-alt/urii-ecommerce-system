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

  private browserStorage(): Storage | null {
    return isPlatformBrowser(this.platformId) ? localStorage : null;
  }
}

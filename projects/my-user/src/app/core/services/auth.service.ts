import { HttpClient } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import { map, Observable } from 'rxjs';
import { AuthResponse, LoginCredentials, RegistrationData, UriUser } from '../../models/uri.model';
import { StorageService } from './storage.service';

@Injectable({ providedIn: 'root' })
export class AuthService {
  private readonly http = inject(HttpClient);
  private readonly storage = inject(StorageService);
  private readonly apiUrl = '/api/auth';

  login(credentials: LoginCredentials): Observable<UriUser> {
    return this.http
      .post<AuthResponse>(`${this.apiUrl}/login`, credentials)
      .pipe(map((response) => this.saveSession(response)));
  }

  register(data: RegistrationData): Observable<UriUser> {
    return this.http
      .post<AuthResponse>(`${this.apiUrl}/register`, data)
      .pipe(map((response) => this.saveSession(response)));
  }

  getCurrentUser(): UriUser | null {
    return this.storage.getUser();
  }

  isAuthenticated(): boolean {
    return this.storage.getToken() !== null;
  }

  logout(): void {
    this.storage.clear();
  }

  private saveSession(response: AuthResponse): UriUser {
    if (!response || typeof response.token !== 'string' || !response.token.trim()) {
      throw new Error('The authentication response did not include a valid token.');
    }

    const user = UriUser.fromJSON(response.user);
    this.storage.setToken(response.token);
    this.storage.setUser(user);
    return user;
  }
}

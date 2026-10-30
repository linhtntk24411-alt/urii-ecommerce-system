import { afterNextRender, Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink, RouterOutlet } from '@angular/router';
import { AdminApiService, apiErrorMessage } from './admin-api.service';

@Component({
  imports: [FormsModule, RouterLink, RouterOutlet],
  selector: 'app-root',
  styleUrl: './app.css',
  templateUrl: './app.html',
})
export class App {
  readonly api = inject(AdminApiService);
  readonly ready = signal(false);
  readonly email = signal('');
  readonly password = signal('');
  readonly loginError = signal('');
  readonly loggingIn = signal(false);

  constructor() {
    afterNextRender(() => {
      this.api.restoreSession();
      this.ready.set(true);
    });
  }

  async login(): Promise<void> {
    this.loggingIn.set(true);
    this.loginError.set('');
    try {
      await this.api.login(this.email(), this.password());
      this.password.set('');
    } catch (error) {
      this.loginError.set(apiErrorMessage(error, 'Không thể đăng nhập. Vui lòng thử lại.'));
    } finally {
      this.loggingIn.set(false);
    }
  }

  logout(): void {
    this.api.logout();
  }
}

import { DatePipe, isPlatformBrowser } from '@angular/common';
import { Component, OnInit, PLATFORM_ID, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { AdminApiService, AdminUser, UserPayload, apiErrorMessage } from './admin-api.service';

interface UserForm {
  name: string;
  email: string;
  phone: string;
  role: 'user' | 'admin';
  password: string;
}

@Component({
  imports: [DatePipe, FormsModule],
  selector: 'admin-users',
  templateUrl: './users.component.html',
  styleUrl: './users.component.css'
})
export class UsersComponent implements OnInit {
  private readonly api = inject(AdminApiService);
  private readonly isBrowser = isPlatformBrowser(inject(PLATFORM_ID));
  readonly users = signal<AdminUser[]>([]);
  readonly loading = signal(false);
  readonly saving = signal(false);
  readonly error = signal('');
  readonly notice = signal('');
  readonly editingId = signal<string | null>(null);
  form: UserForm = this.emptyForm();

  ngOnInit(): void {
    if (this.isBrowser && this.api.token()) {
      void this.load();
    }
  }

  async load(): Promise<void> {
    this.loading.set(true);
    this.error.set('');
    try {
      this.users.set(await this.api.getUsers());
    } catch (error) {
      this.error.set(apiErrorMessage(error, 'Không thể tải danh sách người dùng.'));
    } finally {
      this.loading.set(false);
    }
  }

  edit(user: AdminUser): void {
    this.editingId.set(user._id);
    this.notice.set('');
    this.error.set('');
    this.form = {
      name: user.name,
      email: user.email,
      phone: user.phone || '',
      role: user.role,
      password: ''
    };
  }

  cancelEdit(): void {
    this.editingId.set(null);
    this.form = this.emptyForm();
    this.error.set('');
  }

  async save(): Promise<void> {
    this.saving.set(true);
    this.error.set('');
    this.notice.set('');
    const payload: UserPayload = {
      name: this.form.name.trim(),
      email: this.form.email.trim(),
      phone: this.form.phone.trim(),
      role: this.form.role
    };
    if (this.form.password) {
      payload.password = this.form.password;
    }

    try {
      if (this.editingId()) {
        await this.api.updateUser(this.editingId()!, payload);
        this.notice.set('Đã cập nhật thông tin người dùng.');
      } else {
        await this.api.createUser(payload);
        this.notice.set('Đã tạo tài khoản người dùng.');
      }
      this.cancelEdit();
      await this.load();
    } catch (error) {
      this.error.set(apiErrorMessage(error, 'Không thể lưu thông tin người dùng.'));
    } finally {
      this.saving.set(false);
    }
  }

  async remove(user: AdminUser): Promise<void> {
    if (!window.confirm(`Xóa tài khoản ${user.email}? Thao tác này không thể hoàn tác.`)) {
      return;
    }
    this.error.set('');
    this.notice.set('');
    try {
      await this.api.deleteUser(user._id);
      this.notice.set('Đã xóa tài khoản.');
      await this.load();
    } catch (error) {
      this.error.set(apiErrorMessage(error, 'Không thể xóa tài khoản.'));
    }
  }

  private emptyForm(): UserForm {
    return { name: '', email: '', phone: '', role: 'user', password: '' };
  }
}

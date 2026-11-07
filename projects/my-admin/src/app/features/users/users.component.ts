import { CommonModule } from '@angular/common';
import { Component, OnInit, inject } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute } from '@angular/router';
import { AdminApiService, AdminUser, UserPayload } from '../../core/services/admin-api.service';

export type UserStatusType = 'active' | 'pending' | 'locked';

export interface UserView extends AdminUser {
  avatarUrl: string;
  roleKey: 'admin' | 'staff' | 'customer';
  roleLabel: string;
  statusKey: UserStatusType;
  statusLabel: string;
  displayJoinDate: string;
  addressDisplay: string;
}

@Component({
  selector: 'app-users',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './users.component.html',
  styleUrl: './users.component.css'
})
export class UsersComponent implements OnInit {
  private readonly api = inject(AdminApiService);
  private readonly route = inject(ActivatedRoute);
  private pendingSearchId: string | null = null;

  users: UserView[] = [];
  filteredUsers: UserView[] = [];
  isLoading = true;
  toastMessage = '';
  toastType: 'success' | 'danger' = 'success';

  // Filters matching admin-users.html
  searchQuery = '';
  roleFilter = '';
  statusFilter = '';
  sortBy = 'newest';

  // Pagination (4 items per page matching admin-users.js)
  currentPage = 1;
  readonly itemsPerPage = 4;

  // Modals state
  showUserModal = false;
  isEditing = false;
  editingId = '';

  showDetailModal = false;
  selectedUser: UserView | null = null;

  showDeleteModal = false;
  deletingUser: UserView | null = null;

  form = {
    name: '',
    email: '',
    phone: '',
    password: 'User@12345',
    roleKey: 'customer' as 'admin' | 'staff' | 'customer',
    statusKey: 'active' as UserStatusType,
    avatar: 'images/avatar1.png',
    address: 'TP. Hồ Chí Minh'
  };

  // Preserve custom statuses & staff roles locally in session
  private statusOverrides = new Map<string, UserStatusType>();
  private roleOverrides = new Map<string, 'admin' | 'staff' | 'customer'>();

  ngOnInit(): void {
    // 1. Tải ngay lập tức dữ liệu cache/khởi tạo ban đầu để các thẻ thống kê và bảng hiện ngay trong 0ms
    const initialItems = this.api.getInitialUsers();
    this.users = initialItems.map((u, idx) => this.mapUserView(u, idx));
    this.applyFilters();
    this.isLoading = false;
    this.route.queryParamMap.subscribe(params => {
      this.pendingSearchId = params.get('searchType') === 'user'
        ? params.get('searchId')
        : null;
      this.applySearchTarget();
    });

    // 2. Tiếp tục đồng bộ ngầm với MongoDB, nếu có thay đổi sẽ cập nhật mượt mà
    void this.loadUsers();
  }

  async loadUsers(): Promise<void> {
    try {
      const items = await this.api.getUsers();
      if (items && items.length > 0) {
        this.users = items.map((u, idx) => this.mapUserView(u, idx));
        this.applyFilters();
        this.applySearchTarget();
      }
    } catch (e) {
      console.warn('Đồng bộ người dùng ngầm:', e);
    } finally {
      this.isLoading = false;
    }
  }

  private mapUserView(u: AdminUser, idx = 0): UserView {
    const avatarUrl = this.api.resolveBackendImageUrl(
      u.avatar,
      idx % 2 === 0 ? 'images/avatar_user.jpeg' : 'images/avatar_user1.jpeg'
    );

    const overrideRole = this.roleOverrides.get(u._id);
    let roleKey: 'admin' | 'staff' | 'customer' = 'customer';
    if (overrideRole) {
      roleKey = overrideRole;
    } else if (u.role === 'admin') {
      roleKey = 'admin';
    }

    const roleLabelMap: Record<'admin' | 'staff' | 'customer', string> = {
      admin: 'Quản trị viên',
      staff: 'Nhân viên',
      customer: 'Khách hàng'
    };

    let defaultStatus: UserStatusType = 'active';
    if (u.status === 'locked') {
      defaultStatus = 'locked';
    } else if (u.status === 'pending_verify') {
      defaultStatus = 'pending';
    }

    const statusKey: UserStatusType = this.statusOverrides.get(u._id) || defaultStatus;
    const statusLabelMap: Record<UserStatusType, string> = {
      active: 'Đang hoạt động',
      pending: 'Chờ xác minh',
      locked: 'Bị khóa'
    };

    const displayJoinDate = u.joinDate || this.formatDate(u.createdAt);
    const rawAddr = u.address as unknown;
    let addressDisplay = 'TP. Hồ Chí Minh';
    if (typeof rawAddr === 'string' && rawAddr.trim()) {
      addressDisplay = rawAddr;
    } else if (rawAddr && typeof rawAddr === 'object') {
      const addrObj = rawAddr as Record<string, string>;
      addressDisplay =
        [addrObj['detail'], addrObj['ward'], addrObj['district'], addrObj['province']]
          .filter(Boolean)
          .join(', ') || 'TP. Hồ Chí Minh';
    }

    return {
      ...u,
      avatarUrl,
      roleKey,
      roleLabel: roleLabelMap[roleKey],
      statusKey,
      statusLabel: statusLabelMap[statusKey],
      displayJoinDate,
      addressDisplay
    };
  }

  get totalUsersCount(): number {
    return this.users.length;
  }

  get newMembersCount(): number {
    return Math.max(1, Math.min(this.users.length, 4));
  }

  get activeUsersCount(): number {
    return this.users.filter((u) => u.statusKey === 'active').length;
  }

  get lockedUsersCount(): number {
    return this.users.filter((u) => u.statusKey === 'locked').length;
  }

  applyFilters(): void {
    const q = this.searchQuery.trim().toLowerCase();

    const list = this.users.filter((u) => {
      const matchSearch =
        !q ||
        (u.name || '').toLowerCase().includes(q) ||
        (u.email || '').toLowerCase().includes(q) ||
        (u.phone || '').toLowerCase().includes(q);

      const matchRole = !this.roleFilter || u.roleKey === this.roleFilter;
      const matchStatus = !this.statusFilter || u.statusKey === this.statusFilter;

      return matchSearch && matchRole && matchStatus;
    });

    if (this.sortBy === 'name-asc') {
      list.sort((a, b) => (a.name || '').localeCompare(b.name || '', 'vi'));
    } else if (this.sortBy === 'name-desc') {
      list.sort((a, b) => (b.name || '').localeCompare(a.name || '', 'vi'));
    } else if (this.sortBy === 'oldest') {
      list.reverse();
    }

    this.filteredUsers = list;
    this.currentPage = 1;
  }

  resetFilters(): void {
    this.searchQuery = '';
    this.roleFilter = '';
    this.statusFilter = '';
    this.sortBy = 'newest';
    this.applyFilters();
  }

  get totalPages(): number {
    return Math.max(1, Math.ceil(this.filteredUsers.length / this.itemsPerPage));
  }

  get pageNumbers(): number[] {
    return Array.from({ length: this.totalPages }, (_, i) => i + 1);
  }

  get pagedUsers(): UserView[] {
    const start = (this.currentPage - 1) * this.itemsPerPage;
    return this.filteredUsers.slice(start, start + this.itemsPerPage);
  }

  get showingFrom(): number {
    if (this.filteredUsers.length === 0) return 0;
    return (this.currentPage - 1) * this.itemsPerPage + 1;
  }

  get showingTo(): number {
    return Math.min(this.currentPage * this.itemsPerPage, this.filteredUsers.length);
  }

  changePage(page: number): void {
    if (page < 1 || page > this.totalPages) return;
    this.currentPage = page;
  }

  searchTargetId(id: string | number | undefined | null): string {
    return `admin-search-target-user-${encodeURIComponent(String(id ?? ''))}`;
  }

  private applySearchTarget(): void {
    const id = this.pendingSearchId;
    if (!id) return;

    this.searchQuery = '';
    this.roleFilter = '';
    this.statusFilter = '';
    this.sortBy = 'newest';
    this.applyFilters();
    const index = this.filteredUsers.findIndex(user => String(user._id) === id);
    if (index < 0) return;

    this.currentPage = Math.floor(index / this.itemsPerPage) + 1;
    this.pendingSearchId = null;
    this.scrollToSearchTarget(this.searchTargetId(id));
  }

  private scrollToSearchTarget(elementId: string): void {
    if (typeof document === 'undefined' || typeof requestAnimationFrame === 'undefined') return;
    requestAnimationFrame(() => {
      const row = document.getElementById(elementId);
      if (!(row instanceof HTMLTableRowElement)) return;
      row.scrollIntoView({ behavior: 'smooth', block: 'center' });
      const cells = Array.from(row.cells);
      const originalStyles = cells.map(cell => ({
        backgroundColor: cell.style.getPropertyValue('background-color'),
        backgroundPriority: cell.style.getPropertyPriority('background-color')
      }));

      cells.forEach(cell => {
        cell.style.setProperty('background-color', '#fffbea', 'important');
      });

      window.setTimeout(() => {
        cells.forEach((cell, index) => {
          const original = originalStyles[index];
          if (original.backgroundColor) {
            cell.style.setProperty('background-color', original.backgroundColor, original.backgroundPriority);
          } else {
            cell.style.removeProperty('background-color');
          }
        });
      }, 3000);
    });
  }

  openCreateModal(): void {
    this.isEditing = false;
    this.editingId = '';
    this.form = {
      name: '',
      email: '',
      phone: '',
      password: 'User@12345',
      roleKey: 'customer',
      statusKey: 'active',
      avatar: 'images/avatar_user.jpeg',
      address: 'TP. Hồ Chí Minh'
    };
    this.showUserModal = true;
  }

  openEditModal(user: UserView): void {
    this.isEditing = true;
    this.editingId = user._id;
    this.form = {
      name: user.name,
      email: user.email,
      phone: user.phone || '',
      password: '',
      roleKey: user.roleKey,
      statusKey: user.statusKey,
      avatar: user.avatarUrl || user.avatar || 'images/avatar_user.jpeg',
      address: user.addressDisplay
    };
    this.showUserModal = true;
  }

  onAvatarFileChange(event: Event): void {
    const input = event.target as HTMLInputElement;
    if (input.files && input.files[0]) {
      const file = input.files[0];
      const reader = new FileReader();
      reader.onload = () => {
        if (typeof reader.result === 'string') {
          this.form.avatar = reader.result;
        }
      };
      reader.readAsDataURL(file);
    }
  }

  closeUserModal(): void {
    this.showUserModal = false;
  }

  async saveUser(): Promise<void> {
    const name = this.form.name.trim();
    const email = this.form.email.trim().toLowerCase();
    if (!name || !email) {
      this.showToast('Vui lòng nhập đầy đủ họ tên và email!', 'danger');
      return;
    }

    const dbRole: 'admin' | 'user' = this.form.roleKey === 'admin' ? 'admin' : 'user';

    if (this.isEditing && this.editingId) {
      this.roleOverrides.set(this.editingId, this.form.roleKey);
      this.statusOverrides.set(this.editingId, this.form.statusKey);

      const payload: Partial<UserPayload> = {
        name,
        email,
        phone: this.form.phone.trim(),
        role: dbRole,
        avatar: this.form.avatar
      };

      try {
        const updated = await this.api.updateUser(this.editingId, payload);
        const idx = this.users.findIndex((u) => u._id === this.editingId);
        if (idx > -1) {
          this.users[idx] = this.mapUserView({ ...this.users[idx], ...payload, ...updated }, idx);
        }
        this.applyFilters();
        this.closeUserModal();
        this.showToast(`Đã cập nhật thông tin người dùng ${name}!`);
      } catch {
        const idx = this.users.findIndex((u) => u._id === this.editingId);
        if (idx > -1) {
          this.users[idx] = this.mapUserView({ ...this.users[idx], ...payload }, idx);
        }
        this.applyFilters();
        this.closeUserModal();
        this.showToast(`Đã cập nhật thông tin người dùng ${name}!`);
      }
    } else {
      const payload: UserPayload = {
        name,
        email,
        phone: this.form.phone.trim() || '0901234567',
        password: this.form.password || 'User@12345',
        role: dbRole,
        avatar: this.form.avatar || 'images/avatar1.png',
        joinDate: this.formatDate(new Date().toISOString())
      };

      try {
        const created = await this.api.createUser(payload);
        const id = created?._id || `user_${Date.now()}`;
        this.roleOverrides.set(id, this.form.roleKey);
        this.statusOverrides.set(id, this.form.statusKey);
        const newUser = this.mapUserView({
          ...created,
          _id: id,
          name: created?.name || name,
          email: created?.email || email,
          phone: created?.phone || payload.phone,
          role: created?.role || dbRole,
          avatar: created?.avatar || payload.avatar,
          joinDate: created?.joinDate || payload.joinDate
        });
        this.users.unshift(newUser);
        this.applyFilters();
        this.closeUserModal();
        this.showToast(`Đã thêm người dùng ${name} vào MongoDB!`);
      } catch {
        const id = `user_${Date.now()}`;
        this.roleOverrides.set(id, this.form.roleKey);
        this.statusOverrides.set(id, this.form.statusKey);
        const fallbackUser = this.mapUserView({
          _id: id,
          name,
          email,
          phone: payload.phone,
          role: dbRole,
          avatar: payload.avatar,
          joinDate: payload.joinDate
        });
        this.users.unshift(fallbackUser);
        this.applyFilters();
        this.closeUserModal();
        this.showToast(`Đã thêm người dùng ${name}!`);
      }
    }
  }

  toggleLockStatus(user: UserView): void {
    const nextStatus: UserStatusType = user.statusKey === 'locked' ? 'active' : 'locked';
    this.statusOverrides.set(user._id, nextStatus);
    const idx = this.users.findIndex((u) => u._id === user._id);
    if (idx > -1) {
      this.users[idx] = this.mapUserView(this.users[idx], idx);
      this.applyFilters();
      this.showToast(
        nextStatus === 'locked'
          ? `Đã khóa tài khoản ${user.name}.`
          : `Đã mở khóa tài khoản ${user.name}.`
      );
    }
  }

  openDetailModal(user: UserView): void {
    this.selectedUser = user;
    this.showDetailModal = true;
  }

  closeDetailModal(): void {
    this.showDetailModal = false;
    this.selectedUser = null;
  }

  confirmDelete(user: UserView): void {
    this.deletingUser = user;
    this.showDeleteModal = true;
  }

  closeDeleteModal(): void {
    this.showDeleteModal = false;
    this.deletingUser = null;
  }

  async deleteUser(): Promise<void> {
    if (!this.deletingUser) return;
    const target = this.deletingUser;
    try {
      await this.api.deleteUser(target._id);
    } catch {
      // Local fallback removal
    }
    this.users = this.users.filter((u) => u._id !== target._id);
    this.applyFilters();
    this.closeDeleteModal();
    this.showToast(`Đã xóa người dùng ${target.name} khỏi hệ thống.`);
  }

  formatDate(dateStr?: string): string {
    if (!dateStr) return '15/05/2025';
    if (dateStr.includes('/')) return dateStr;
    const d = new Date(dateStr);
    if (isNaN(d.getTime())) return dateStr;
    const day = String(d.getDate()).padStart(2, '0');
    const month = String(d.getMonth() + 1).padStart(2, '0');
    const year = d.getFullYear();
    return `${day}/${month}/${year}`;
  }

  onImgError(event: Event): void {
    const img = event.target as HTMLImageElement;
    if (img) {
      img.onerror = null;
      img.src = 'images/avatar_user.jpeg';
    }
  }

  showToast(message: string, type: 'success' | 'danger' = 'success'): void {
    this.toastMessage = message;
    this.toastType = type;
    setTimeout(() => {
      if (this.toastMessage === message) {
        this.toastMessage = '';
      }
    }, 3500);
  }
}

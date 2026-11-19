import { ChangeDetectorRef } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { ActivatedRoute } from '@angular/router';
import { AdminApiService, AdminUser } from '../../core/services/admin-api.service';
import { AdminSocketService } from '../../core/services/admin-socket.service';
import { UsersComponent } from './users.component';

describe('UsersComponent account status', () => {
  const customer: AdminUser = { _id: 'customer-id', name: 'Khách hàng', email: 'user@example.test', role: 'user' };
  const admin: AdminUser = { _id: 'admin-id', name: 'Quản trị viên', email: 'admin@example.test', role: 'admin' };
  let component: UsersComponent;
  let getUsers: ReturnType<typeof vi.fn>;
  let updateUserStatus: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    vi.useFakeTimers();
    getUsers = vi.fn().mockResolvedValue([customer, admin]);
    updateUserStatus = vi.fn();
    TestBed.configureTestingModule({
      providers: [
        { provide: AdminApiService, useValue: { getUsers, updateUserStatus, resolveBackendImageUrl: () => '' } },
        { provide: AdminSocketService, useValue: {} },
        { provide: ActivatedRoute, useValue: {} },
        { provide: ChangeDetectorRef, useValue: { markForCheck: () => {} } },
      ],
    });
    component = TestBed.runInInjectionContext(() => new UsersComponent());
    await component.loadUsers();
  });

  afterEach(() => {
    vi.clearAllTimers();
    vi.useRealTimers();
  });

  it('only updates the status after confirmation and a successful API response', async () => {
    const locked = { ...customer, status: 'locked' };
    updateUserStatus.mockResolvedValueOnce(locked).mockResolvedValueOnce({ ...customer, status: 'active' });
    component.toggleLockStatus(component.users[0]);
    expect(updateUserStatus).not.toHaveBeenCalled();
    expect(component.users[0].statusKey).toBe('active');

    await component.confirmStatusChange();
    expect(updateUserStatus).toHaveBeenLastCalledWith(customer._id, 'locked');
    expect(component.users[0].statusKey).toBe('locked');

    getUsers.mockResolvedValueOnce([locked, admin]);
    await component.loadUsers();
    expect(getUsers).toHaveBeenLastCalledWith(false);
    component.searchQuery = 'user@example.test';
    component.statusFilter = 'locked';
    component.applyFilters();
    expect(component.pagedUsers.map(user => user._id)).toEqual([customer._id]);

    component.toggleLockStatus(component.users[0]);
    await component.confirmStatusChange();
    expect(updateUserStatus).toHaveBeenLastCalledWith(customer._id, 'active');
    expect(component.users[0].statusKey).toBe('active');
    expect(component.filteredUsers).toEqual([]);
  });

  it('keeps the previous status and shows an error when the API rejects the change', async () => {
    updateUserStatus.mockRejectedValue(new Error('Không thể cập nhật trạng thái tài khoản.'));
    component.toggleLockStatus(component.users[0]);
    await component.confirmStatusChange();

    expect(component.users[0].statusKey).toBe('active');
    expect(component.toastType).toBe('danger');
    expect(component.toastMessage).toBe('Không thể cập nhật trạng thái tài khoản.');
  });

  it('does not offer the status action for administrators', async () => {
    component.toggleLockStatus(component.users[1]);
    await component.confirmStatusChange();
    expect(component.statusChangeUser).toBeNull();
    expect(updateUserStatus).not.toHaveBeenCalled();
  });
});

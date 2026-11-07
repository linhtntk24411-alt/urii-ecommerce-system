import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { Information } from './information';

describe('Information', () => {
  let component: Information;
  let fixture: ComponentFixture<Information>;
  let httpTestingController: HttpTestingController;

  beforeEach(async () => {
    localStorage.clear();
    await TestBed.configureTestingModule({
      imports: [Information],
      providers: [provideHttpClient(), provideHttpClientTesting(), provideRouter([])],
    }).compileComponents();

    fixture = TestBed.createComponent(Information);
    component = fixture.componentInstance;
    httpTestingController = TestBed.inject(HttpTestingController);
  });

  afterEach(() => {
    httpTestingController.verify();
    localStorage.clear();
  });

  it('loads the signed-in user profile from the backend API', async () => {
    localStorage.setItem('authToken', 'profile-token');
    localStorage.setItem('isLoggedIn', 'true');
    fixture.detectChanges();

    const request = httpTestingController.expectOne('/api/auth/me');
    expect(request.request.method).toBe('GET');
    expect(request.request.headers.get('Authorization')).toBe('Bearer profile-token');
    request.flush(profileResponse());
    await fixture.whenStable();
    fixture.detectChanges();

    expect(component.profile?.email).toBe('member@example.com');
    expect(component.profileForm.getRawValue()).toEqual({
      name: 'Urii Member',
      birth: '12/08/1998',
      phone: '0901234567',
      address: 'Thủ Đức, TP. Hồ Chí Minh',
      interests: 'Đồ handmade',
      gender: 'female',
    });
    expect(fixture.nativeElement.textContent).toContain('Thông tin cá nhân');
    expect(fixture.nativeElement.textContent).toContain('member@example.com');
    expect(fixture.nativeElement.querySelector('.profile-summary__name h1')?.textContent.trim())
      .toBe('Urii Member');
    expect(fixture.nativeElement.querySelector('.profile-summary__stats')).toBeNull();
    expect((fixture.nativeElement.querySelector('#profile-birth') as HTMLInputElement).value)
      .toBe('12/08/1998');
  });

  it('saves edited profile details through the authenticated self-update API', () => {
    localStorage.setItem('authToken', 'profile-token');
    localStorage.setItem('isLoggedIn', 'true');
    fixture.detectChanges();
    httpTestingController.expectOne('/api/auth/me').flush(profileResponse());

    component.startEditing();
    component.profileForm.setValue({
      name: 'New Name',
      birth: '01/02/2000',
      phone: '0912345678',
      address: 'Quận 1, TP. Hồ Chí Minh',
      interests: 'Làm hạt ủi',
      gender: 'female',
    });
    component.saveProfile();

    const request = httpTestingController.expectOne('/api/auth/me');
    expect(request.request.method).toBe('PATCH');
    expect(request.request.headers.get('Authorization')).toBe('Bearer profile-token');
    expect(request.request.body).toEqual({
      name: 'New Name',
      birth: '01/02/2000',
      phone: '0912345678',
      address: 'Quận 1, TP. Hồ Chí Minh',
      interests: 'Làm hạt ủi',
      gender: 'female',
    });
    request.flush({
      ...profileResponse(),
      name: 'New Name',
      birth: '01/02/2000',
      phone: '0912345678',
      address: 'Quận 1, TP. Hồ Chí Minh',
      interests: 'Làm hạt ủi',
      gender: 'female',
    });

    expect(component.profile?.name).toBe('New Name');
    expect(component.isEditing).toBe(false);
    expect(component.successMessage).toBe('Đã cập nhật hồ sơ thành công.');
    expect(localStorage.getItem('userName')).toBe('New Name');
  });

  it('clears optional profile fields through the backend update API', () => {
    localStorage.setItem('authToken', 'profile-token');
    localStorage.setItem('isLoggedIn', 'true');
    fixture.detectChanges();
    httpTestingController.expectOne('/api/auth/me').flush(profileResponse());

    component.startEditing();
    component.clearOptionalInformation();
    component.saveProfile();
    const request = httpTestingController.expectOne('/api/auth/me');

    expect(request.request.body).toMatchObject({
      birth: '12/08/1998',
      phone: '0901234567',
      address: '',
      interests: '',
      gender: '',
    });
    request.flush({ ...profileResponse(), address: '', interests: '', gender: '' });

    expect(component.profile?.birth).toBe('12/08/1998');
    expect(component.profile?.phone).toBe('0901234567');
    expect(component.profile?.address).toBe('');
    expect(component.profile?.interests).toBe('');
    expect(component.profile?.gender).toBe('');
  });

  it('requires a phone number and birth date before sending profile updates', () => {
    localStorage.setItem('authToken', 'profile-token');
    localStorage.setItem('isLoggedIn', 'true');
    fixture.detectChanges();
    httpTestingController.expectOne('/api/auth/me').flush(profileResponse());

    component.startEditing();
    component.profileForm.patchValue({ birth: '', phone: '' });
    component.saveProfile();

    expect(component.profileForm.controls.birth.hasError('required')).toBe(true);
    expect(component.profileForm.controls.phone.hasError('required')).toBe(true);
    httpTestingController.expectNone((request) => request.method === 'PATCH');
  });

  it('does not send invalid birth date or phone values', () => {
    localStorage.setItem('authToken', 'profile-token');
    localStorage.setItem('isLoggedIn', 'true');
    fixture.detectChanges();
    httpTestingController.expectOne('/api/auth/me').flush(profileResponse());

    component.startEditing();
    component.profileForm.patchValue({ birth: '31/02/2000', phone: 'not-a-phone' });
    component.saveProfile();

    expect(component.profileForm.controls.birth.invalid).toBe(true);
    expect(component.profileForm.controls.phone.invalid).toBe(true);
    httpTestingController.expectNone((request) => request.method === 'PATCH');
  });

  it('asks signed-out visitors to log in without requesting private profile data', () => {
    fixture.detectChanges();

    expect(component.requiresLogin).toBe(true);
    expect(fixture.nativeElement.textContent).toContain('Đăng nhập để xem hồ sơ');
    httpTestingController.expectNone('/api/auth/me');
  });

  it('opens and closes the avatar change modal', async () => {
    localStorage.setItem('authToken', 'profile-token');
    localStorage.setItem('isLoggedIn', 'true');
    fixture.detectChanges();
    httpTestingController.expectOne('/api/auth/me').flush(profileResponse());
    await fixture.whenStable();
    fixture.detectChanges();

    expect(component.isAvatarModalOpen).toBe(false);
    expect(fixture.nativeElement.querySelector('.avatar-modal')).toBeNull();

    // Click on avatar button
    const avatarButton = fixture.nativeElement.querySelector('.profile-avatar--actionable') as HTMLButtonElement;
    expect(avatarButton).not.toBeNull();
    avatarButton.click();
    await fixture.whenStable();
    fixture.detectChanges();

    expect(component.isAvatarModalOpen).toBe(true);
    expect(fixture.nativeElement.querySelector('.avatar-modal')).not.toBeNull();

    // Close modal
    const closeButton = fixture.nativeElement.querySelector('.avatar-modal__close') as HTMLButtonElement;
    closeButton.click();
    await fixture.whenStable();
    fixture.detectChanges();

    expect(component.isAvatarModalOpen).toBe(false);
    expect(fixture.nativeElement.querySelector('.avatar-modal')).toBeNull();
  });

  it('updates the avatar via preset selection and saves to the backend', async () => {
    localStorage.setItem('authToken', 'profile-token');
    localStorage.setItem('isLoggedIn', 'true');
    fixture.detectChanges();
    httpTestingController.expectOne('/api/auth/me').flush(profileResponse());
    await fixture.whenStable();
    fixture.detectChanges();

    component.openAvatarModal();
    fixture.detectChanges();

    // Select preset
    component.selectPresetAvatar('/images/avatar_user1.jpeg');
    expect(component.avatarPreview).toBe('/images/avatar_user1.jpeg');

    component.saveAvatar();

    const patchReq = httpTestingController.expectOne('/api/auth/me');
    expect(patchReq.request.method).toBe('PATCH');
    expect(patchReq.request.body).toEqual({ avatar: '/images/avatar_user1.jpeg' });

    patchReq.flush({
      ...profileResponse(),
      avatar: '/images/avatar_user1.jpeg',
    });

    await fixture.whenStable();
    fixture.detectChanges();

    expect(component.isAvatarModalOpen).toBe(false);
    expect(component.profile?.avatar).toBe('/api/images/avatar_user1.jpeg');
    expect(localStorage.getItem('userAvatar')).toBe('/api/images/avatar_user1.jpeg');
    expect(component.successMessage).toBe('Đã cập nhật ảnh đại diện thành công.');
  });

  it('uploads a custom image file and updates the profile avatar', async () => {
    localStorage.setItem('authToken', 'profile-token');
    localStorage.setItem('isLoggedIn', 'true');
    fixture.detectChanges();
    httpTestingController.expectOne('/api/auth/me').flush(profileResponse());
    await fixture.whenStable();
    fixture.detectChanges();

    component.openAvatarModal();
    fixture.detectChanges();

    const dummyFile = new File(['dummy-content'], 'avatar.png', { type: 'image/png' });
    component.avatarFile = dummyFile;
    component.avatarPreview = 'data:image/png;base64,dummy';

    component.saveAvatar();

    // Expect upload request first
    const uploadReq = httpTestingController.expectOne('/api/upload');
    expect(uploadReq.request.method).toBe('POST');
    expect(uploadReq.request.headers.get('Content-Type')).toBe('image/png');
    uploadReq.flush({ imageUrl: '/images/uploads/uploaded-avatar.png' });

    // Expect patch request next
    const patchReq = httpTestingController.expectOne('/api/auth/me');
    expect(patchReq.request.method).toBe('PATCH');
    expect(patchReq.request.body).toEqual({ avatar: '/images/uploads/uploaded-avatar.png' });
    patchReq.flush({
      ...profileResponse(),
      avatar: '/images/uploads/uploaded-avatar.png',
    });

    await fixture.whenStable();
    fixture.detectChanges();

    expect(component.isAvatarModalOpen).toBe(false);
    expect(component.profile?.avatar).toBe('/api/images/uploads/uploaded-avatar.png');
    expect(localStorage.getItem('userAvatar')).toBe('/api/images/uploads/uploaded-avatar.png');
  });
});

function profileResponse() {
  return {
    id: 'user-id',
    name: 'Urii Member',
    email: 'member@example.com',
    role: 'user',
    avatar: '/images/avatar-user.jpg',
    phone: '0901234567',
    birth: '12/08/1998',
    address: 'Thủ Đức, TP. Hồ Chí Minh',
    interests: 'Đồ handmade',
    gender: 'female',
    joinDate: '2024',
    orders: 3,
    maps: 5,
    authProviders: ['password'],
  };
}

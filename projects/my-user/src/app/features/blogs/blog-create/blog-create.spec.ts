import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { provideRouter, Router } from '@angular/router';
import { DialogService } from '../../../core/services/dialog.service';
import { BlogCreateComponent } from './blog-create';

describe('BlogCreateComponent', () => {
  let component: BlogCreateComponent;
  let fixture: ComponentFixture<BlogCreateComponent>;
  let httpTestingController: HttpTestingController;

  beforeEach(async () => {
    vi.restoreAllMocks();
    await TestBed.configureTestingModule({
      imports: [BlogCreateComponent],
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        provideRouter([{ path: 'blog-list', component: BlogCreateComponent }]),
      ],
    }).compileComponents();

    localStorage.clear();
    fixture = TestBed.createComponent(BlogCreateComponent);
    component = fixture.componentInstance;
    httpTestingController = TestBed.inject(HttpTestingController);
    await fixture.whenStable();
  });

  afterEach(() => httpTestingController.verify());

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  it('requires login before publishing a blog', () => {
    const dialogService = TestBed.inject(DialogService);
    const promptSpy = vi.spyOn(dialogService, 'promptLogin');

    component.publish();

    expect(promptSpy).toHaveBeenCalledWith(expect.objectContaining({
      title: expect.stringContaining('Đăng nhập'),
    }));
    httpTestingController.expectNone('/api/blogs');
  });

  it('posts the blog to the API with the signed-in token', async () => {
    const navigateSpy = vi.spyOn(TestBed.inject(Router), 'navigate').mockResolvedValue(true);
    localStorage.setItem('authToken', 'test-user-token');
    localStorage.setItem('isLoggedIn', 'true');
    component.blogForm.patchValue({
      title: 'Hướng dẫn làm mẫu',
      content: '<p>Nội dung bài viết</p>',
      category: 'huong-dan-diy',
    });

    component.publish();
    await Promise.resolve();

    const request = httpTestingController.expectOne('/api/blogs');
    expect(request.request.method).toBe('POST');
    expect(request.request.headers.get('Authorization')).toBe('Bearer test-user-token');
    expect(request.request.body).toMatchObject({
      title: 'Hướng dẫn làm mẫu',
      excerpt: 'Nội dung bài viết',
      content: '<p>Nội dung bài viết</p>',
      category: 'Hướng dẫn DIY',
      categorySlug: 'huong-dan-diy',
    });
    expect(request.request.body.date).toEqual(expect.any(String));
    request.flush({
      id: 21,
      slug: 'huong-dan-lam-mau-21',
      title: 'Hướng dẫn làm mẫu',
      content: '<p>Nội dung bài viết</p>',
      category: 'Hướng dẫn DIY',
      date: request.request.body.date,
    });
    await fixture.whenStable();

    expect(component.successMessage).toBe('Đăng bài thành công!');
    expect(localStorage.getItem('blogDraft')).toBeNull();
    expect(navigateSpy).toHaveBeenCalledWith(['/blog-detail', 'huong-dan-lam-mau-21']);
  });

  it('shows validation feedback without posting an incomplete blog', () => {
    localStorage.setItem('authToken', 'test-user-token');
    localStorage.setItem('isLoggedIn', 'true');

    component.publish();

    expect(component.errorMessage).toBe('Vui lòng nhập Tiêu đề và Nội dung bài viết!');
    httpTestingController.expectNone('/api/blogs');
  });

  it('should show a confirmation after saving a draft', () => {
    const dialogService = TestBed.inject(DialogService);
    const alertSpy = vi.spyOn(dialogService, 'alert').mockResolvedValue();
    component.blogForm.patchValue({ title: 'Bản nháp của tôi' });

    component.saveDraft();

    expect(localStorage.getItem('blogDraft')).toContain('Bản nháp của tôi');
    expect(alertSpy).toHaveBeenCalledWith(expect.stringContaining('Đã lưu bản nháp'), expect.any(String), 'info');
  });
});

import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { provideRouter } from '@angular/router';
import { BlogCreateComponent } from './blog-create';

describe('BlogCreateComponent', () => {
  let component: BlogCreateComponent;
  let fixture: ComponentFixture<BlogCreateComponent>;
  let httpTestingController: HttpTestingController;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [BlogCreateComponent],
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        provideRouter([{ path: 'blog-list', component: BlogCreateComponent }]),
      ],
    }).compileComponents();

    localStorage.removeItem('blogDraft');
    fixture = TestBed.createComponent(BlogCreateComponent);
    component = fixture.componentInstance;
    httpTestingController = TestBed.inject(HttpTestingController);
    await fixture.whenStable();
  });

  afterEach(() => httpTestingController.verify());

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  it('should submit the blog post to the API', () => {
    const alertSpy = vi.spyOn(window, 'alert').mockImplementation(() => undefined);
    fixture.detectChanges();
    component.blogForm.patchValue({
      title: 'Hướng dẫn làm mẫu',
      content: '<p>Nội dung bài viết</p>',
      category: 'huong-dan-diy',
    });

    component.publish();

    const request = httpTestingController.expectOne('/api/blogs');
    expect(request.request.method).toBe('POST');
    expect(request.request.body.title).toBe('Hướng dẫn làm mẫu');
    expect(request.request.body.categorySlug).toBe('huong-dan-diy');
    expect(request.request.body.image).toBe('');
    request.flush({ slug: 'huong-dan-lam-mau' });

    expect(alertSpy).toHaveBeenCalledWith('Bài viết đã được xuất bản thành công!');
    alertSpy.mockRestore();
  });

  it('should show a dialog when required publish fields are missing', () => {
    const alertSpy = vi.spyOn(window, 'alert').mockImplementation(() => undefined);

    component.publish();

    expect(alertSpy).toHaveBeenCalledWith('Vui lòng nhập Tiêu đề và Nội dung bài viết!');
    httpTestingController.expectNone('/api/blogs');
    alertSpy.mockRestore();
  });

  it('should show a helpful dialog when the API rejects the cover image', () => {
    const alertSpy = vi.spyOn(window, 'alert').mockImplementation(() => undefined);
    component.blogForm.patchValue({
      title: 'Hướng dẫn làm mẫu',
      content: '<p>Nội dung bài viết</p>',
    });

    component.publish();

    const request = httpTestingController.expectOne('/api/blogs');
    request.flush(
      { message: 'Image must be a supported base64 image' },
      { status: 400, statusText: 'Bad Request' },
    );

    expect(alertSpy).toHaveBeenCalledWith(
      'Ảnh bìa không hợp lệ. Hãy chọn ảnh PNG, JPG, WEBP hoặc GIF bằng nút Thêm ảnh.',
    );
    alertSpy.mockRestore();
  });

  it('should show a confirmation after saving a draft', () => {
    const alertSpy = vi.spyOn(window, 'alert').mockImplementation(() => undefined);
    component.blogForm.patchValue({ title: 'Bản nháp của tôi' });

    component.saveDraft();

    expect(localStorage.getItem('blogDraft')).toContain('Bản nháp của tôi');
    expect(alertSpy).toHaveBeenCalledWith('Đã lưu bản nháp thành công!');
    alertSpy.mockRestore();
  });
});

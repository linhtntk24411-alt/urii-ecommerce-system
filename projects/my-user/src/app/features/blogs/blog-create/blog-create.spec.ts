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

  it('keeps publishing local and does not write to the shared API', () => {
    const alertSpy = vi.spyOn(window, 'alert').mockImplementation(() => undefined);
    fixture.detectChanges();
    component.blogForm.patchValue({
      title: 'Hướng dẫn làm mẫu',
      content: '<p>Nội dung bài viết</p>',
      category: 'huong-dan-diy',
    });

    component.publish();

    expect(localStorage.getItem('blogDraft')).toContain('Hướng dẫn làm mẫu');
    expect(alertSpy).toHaveBeenCalledWith(
      'Bản nháp đã lưu trên thiết bị. Chức năng đăng bài lên backend nhóm đang tắt để chỉ đọc dữ liệu.',
    );
    httpTestingController.expectNone('/api/blogs');
    alertSpy.mockRestore();
  });

  it('should show a dialog when required publish fields are missing', () => {
    const alertSpy = vi.spyOn(window, 'alert').mockImplementation(() => undefined);

    component.publish();

    expect(alertSpy).toHaveBeenCalledWith('Vui lòng nhập Tiêu đề và Nội dung bài viết!');
    httpTestingController.expectNone('/api/blogs');
    alertSpy.mockRestore();
  });

  it('never sends a valid post to the shared API', () => {
    const alertSpy = vi.spyOn(window, 'alert').mockImplementation(() => undefined);
    component.blogForm.patchValue({
      title: 'Hướng dẫn làm mẫu',
      content: '<p>Nội dung bài viết</p>',
    });

    component.publish();

    httpTestingController.expectNone('/api/blogs');
    expect(alertSpy).toHaveBeenCalledWith(
      'Bản nháp đã lưu trên thiết bị. Chức năng đăng bài lên backend nhóm đang tắt để chỉ đọc dữ liệu.',
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

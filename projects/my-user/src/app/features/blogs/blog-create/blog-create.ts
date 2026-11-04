import { AfterViewInit, Component, ElementRef, OnDestroy, OnInit, ViewChild, Inject, PLATFORM_ID } from '@angular/core';
import { CommonModule, isPlatformBrowser } from '@angular/common';
import { FormBuilder, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { Subscription } from 'rxjs';

interface BlogDraft {
  title: string;
  category: string;
  content: string;
  tags: string;
  seoTitle: string;
  seoDesc: string;
  imagePreviewUrls: string[];
}

@Component({
  selector: 'app-blog-create',
  standalone: true,
  imports: [CommonModule, ReactiveFormsModule, RouterLink],
  templateUrl: './blog-create.html',
  styleUrl: './blog-create.css'
})
export class BlogCreateComponent implements OnInit, AfterViewInit, OnDestroy {
  @ViewChild('editor') editor?: ElementRef<HTMLDivElement>;
  @ViewChild('fileInput') fileInput?: ElementRef<HTMLInputElement>;

  blogForm: FormGroup;
  imagePreviewUrls: string[] = [];
  isSeoOpen = false;
  wordCount: number = 0;
  autoSaveMessage = 'Chưa lưu';
  isSaving = false;
  isPublishing = false;
  errorMessage = '';
  successMessage = '';

  private readonly maxImageBytes = 6 * 1024 * 1024;
  private readonly draftStorageKey = 'blogDraft';
  private autoSaveTimer?: ReturnType<typeof setTimeout>;
  private formChanges?: Subscription;

  constructor(
    private fb: FormBuilder,
    @Inject(PLATFORM_ID) private platformId: Object
  ) {
    this.blogForm = this.fb.group({
      title: ['', Validators.required],
      category: ['huong-dan-diy', Validators.required],
      content: ['', Validators.required],
      tags: [''],
      seoTitle: [''],
      seoDesc: ['']
    });
  }

  ngOnInit(): void {
    this.restoreDraft();
    this.formChanges = this.blogForm.valueChanges.subscribe(() => this.scheduleAutoSave());
  }

  ngAfterViewInit(): void {
    const content = this.blogForm.get('content')?.value ?? '';
    if (this.editor) {
      this.editor.nativeElement.innerHTML = content;
      this.updateWordCount();
    }
  }

  ngOnDestroy(): void {
    if (this.autoSaveTimer) clearTimeout(this.autoSaveTimer);
    this.formChanges?.unsubscribe();
  }

  triggerFileInput(): void {
    if (this.fileInput) {
      this.fileInput.nativeElement.click();
    }
  }

  async onFileSelected(event: Event): Promise<void> {
    const input = event.currentTarget as HTMLInputElement;
    const files = Array.from(input.files ?? []);
    input.value = '';
    this.errorMessage = '';

    if (files.length === 0) return;
    const supportedImageTypes = ['image/png', 'image/jpeg', 'image/webp', 'image/gif'];
    if (files.some((file) => !supportedImageTypes.includes(file.type))) {
      this.errorMessage = 'Chỉ hỗ trợ ảnh PNG, JPG, WEBP hoặc GIF.';
      return;
    }
    if (files.reduce((total, file) => total + file.size, 0) +
      this.imagePreviewUrls.reduce((total, image) => total + this.dataUrlSize(image), 0) > this.maxImageBytes) {
      this.errorMessage = 'Tổng dung lượng ảnh không được vượt quá 6MB.';
      return;
    }

    try {
      const previews = await Promise.all(files.map((file) => this.readImage(file)));
      this.imagePreviewUrls = [...this.imagePreviewUrls, ...previews];
      this.scheduleAutoSave();
    } catch (error: unknown) {
      console.error('Lỗi đọc ảnh bài viết:', error);
      this.errorMessage = 'Không thể đọc ảnh đã chọn. Vui lòng thử lại.';
    }
  }

  removeImage(index: number, event: Event): void {
    event.stopPropagation();
    this.imagePreviewUrls.splice(index, 1);
    this.scheduleAutoSave();
  }

  onContentChange(): void {
    const editor = this.editor?.nativeElement;
    if (!editor) return;

    this.blogForm.patchValue({ content: editor.innerHTML }, { emitEvent: false });
    this.updateWordCount();
    this.scheduleAutoSave();
  }

  formatText(command: string, value = ''): void {
    const editor = this.editor?.nativeElement;
    if (!editor) return;

    document.execCommand(command, false, value);
    editor.focus();
    this.onContentChange();
  }

  toggleSeo(): void {
    this.isSeoOpen = !this.isSeoOpen;
  }

  saveDraft(): void {
    const saved = this.persistDraft();
    if (!isPlatformBrowser(this.platformId)) return;

    if (saved) {
      this.showDialog('Đã lưu bản nháp thành công!');
    } else {
      this.showDialog(this.errorMessage || 'Không thể lưu bản nháp. Vui lòng thử lại.');
    }
  }

  publish(): void {
    if (this.isPublishing) return;

    const title = String(this.blogForm.get('title')?.value ?? '').trim();
    const content = String(this.blogForm.get('content')?.value ?? '');
    if (!title || !this.contentText(content).trim()) {
      this.blogForm.get('title')?.markAsTouched();
      this.errorMessage = 'Vui lòng nhập Tiêu đề và Nội dung bài viết!';
      this.showDialog(this.errorMessage);
      return;
    }

    if (this.autoSaveTimer) clearTimeout(this.autoSaveTimer);
    this.isSaving = false;
    const saved = this.persistDraft();
    const message = saved
      ? 'Bản nháp đã lưu trên thiết bị. Chức năng đăng bài lên backend nhóm đang tắt để chỉ đọc dữ liệu.'
      : this.errorMessage;
    this.errorMessage = saved ? '' : message;
    this.successMessage = saved ? message : '';
    this.showDialog(message);
  }

  private showDialog(message: string): void {
    if (isPlatformBrowser(this.platformId)) {
      alert(message);
    }
  }

  private persistDraft(): boolean {
    if (!isPlatformBrowser(this.platformId)) return false;

    if (this.autoSaveTimer) clearTimeout(this.autoSaveTimer);
    this.isSaving = false;
    try {
      localStorage.setItem(this.draftStorageKey, JSON.stringify(this.getDraft()));
      this.autoSaveMessage = 'Đã lưu bản nháp';
      this.successMessage = 'Bản nháp đã được lưu trên thiết bị này.';
      this.errorMessage = '';
      return true;
    } catch (error: unknown) {
      console.error('Lỗi lưu bản nháp blog:', error);
      this.errorMessage = 'Không thể lưu bản nháp. Vui lòng kiểm tra dung lượng trình duyệt.';
      return false;
    }
  }

  private scheduleAutoSave(): void {
    if (!isPlatformBrowser(this.platformId)) return;

    if (this.autoSaveTimer) clearTimeout(this.autoSaveTimer);
    this.isSaving = true;
    this.autoSaveTimer = setTimeout(() => {
      try {
        localStorage.setItem(this.draftStorageKey, JSON.stringify(this.getDraft()));
        const now = new Date();
        this.autoSaveMessage = `Đã lưu tự động lúc ${now.getHours()}:${now.getMinutes().toString().padStart(2, '0')}`;
        this.errorMessage = '';
      } catch (error: unknown) {
        console.error('Lỗi tự động lưu bản nháp blog:', error);
        this.errorMessage = 'Không thể tự động lưu bản nháp.';
      } finally {
        this.isSaving = false;
      }
    }, 800);
  }

  private restoreDraft(): void {
    if (!isPlatformBrowser(this.platformId)) return;

    try {
      const storedDraft = localStorage.getItem(this.draftStorageKey);
      if (!storedDraft) return;

      const draft: unknown = JSON.parse(storedDraft);
      if (!this.isDraft(draft)) {
        this.errorMessage = 'Bản nháp đã lưu không đúng định dạng.';
        return;
      }
      this.blogForm.patchValue({
        title: draft.title,
        category: draft.category,
        content: draft.content,
        tags: draft.tags,
        seoTitle: draft.seoTitle,
        seoDesc: draft.seoDesc,
      });
      this.imagePreviewUrls = draft.imagePreviewUrls;
      this.autoSaveMessage = 'Đã khôi phục bản nháp';
    } catch (error: unknown) {
      console.error('Lỗi khôi phục bản nháp blog:', error);
      this.errorMessage = 'Không thể khôi phục bản nháp đã lưu.';
    }
  }

  private getDraft(): BlogDraft {
    return {
      title: String(this.blogForm.get('title')?.value ?? ''),
      category: String(this.blogForm.get('category')?.value ?? 'huong-dan-diy'),
      content: String(this.blogForm.get('content')?.value ?? ''),
      tags: String(this.blogForm.get('tags')?.value ?? ''),
      seoTitle: String(this.blogForm.get('seoTitle')?.value ?? ''),
      seoDesc: String(this.blogForm.get('seoDesc')?.value ?? ''),
      imagePreviewUrls: [...this.imagePreviewUrls],
    };
  }

  private readImage(file: File): Promise<string> {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => {
        if (typeof reader.result === 'string') resolve(reader.result);
        else reject(new Error('Invalid image data'));
      };
      reader.onerror = () => reject(reader.error ?? new Error('Could not read image'));
      reader.readAsDataURL(file);
    });
  }

  private contentText(content: string): string {
    const container = document.createElement('div');
    container.innerHTML = content;
    return container.textContent ?? '';
  }

  private updateWordCount(): void {
    const text = this.editor?.nativeElement.innerText ?? '';
    this.wordCount = text.trim().split(/\s+/).filter(Boolean).length;
  }

  private dataUrlSize(image: string): number {
    const base64 = image.split(',')[1] ?? '';
    return Math.ceil(base64.length * 3 / 4);
  }

  private isDraft(value: unknown): value is BlogDraft {
    if (typeof value !== 'object' || value === null) return false;
    const draft = value as Record<string, unknown>;
    return typeof draft['title'] === 'string'
      && typeof draft['category'] === 'string'
      && typeof draft['content'] === 'string'
      && typeof draft['tags'] === 'string'
      && typeof draft['seoTitle'] === 'string'
      && typeof draft['seoDesc'] === 'string'
      && Array.isArray(draft['imagePreviewUrls'])
      && draft['imagePreviewUrls'].every((image) =>
        typeof image === 'string'
        && /^data:image\/(?:png|jpeg|webp|gif);base64,[A-Za-z0-9+/]+={0,2}$/.test(image));
  }
}
import { Component, ElementRef, ViewChild, Inject, PLATFORM_ID } from '@angular/core';
import { CommonModule, isPlatformBrowser } from '@angular/common';
import { FormBuilder, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';

@Component({
  selector: 'app-blog-create',
  standalone: true,
  imports: [CommonModule, ReactiveFormsModule, RouterLink],
  templateUrl: './blog-create.html',
  styleUrl: './blog-create.css'
})
export class BlogCreateComponent {
  @ViewChild('editor') editor!: ElementRef;
  @ViewChild('fileInput') fileInput!: ElementRef; 

  blogForm: FormGroup;
  imagePreviewUrls: string[] = [];
  isSeoOpen: boolean = false;
  wordCount: number = 0;
  autoSaveMessage: string = 'Đã lưu tự động';
  isSaving: boolean = false;

  constructor(
    private fb: FormBuilder,
    private router: Router,
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

  triggerFileInput() {
    if (this.fileInput) {
      this.fileInput.nativeElement.click();
    }
  }

  onFileSelected(event: any) {
    const files = event.target.files;
    if (files && files.length > 0) {
      for (let file of files) {
        if (file.type.startsWith('image/')) {
          const reader = new FileReader();
          reader.onload = (e: any) => {
            this.imagePreviewUrls.push(e.target.result);
          };
          reader.readAsDataURL(file);
        }
      }
    }
    event.target.value = '';
  }

  removeImage(index: number) {
    this.imagePreviewUrls.splice(index, 1);
  }

  onContentChange() {
    const text = this.editor.nativeElement.innerText || '';
    this.wordCount = text.trim().split(/\s+/).filter((w: string) => w.length > 0).length;
    this.blogForm.patchValue({ content: this.editor.nativeElement.innerHTML });
    this.autoSave();
  }

  autoSave() {
    this.isSaving = true;
    setTimeout(() => {
      const now = new Date();
      this.autoSaveMessage = `Đã lưu tự động lúc ${now.getHours()}:${now.getMinutes().toString().padStart(2, '0')}`;
      this.isSaving = false;
    }, 1000);
  }

  formatText(command: string, value: string = '') {
    document.execCommand(command, false, value);
    this.editor.nativeElement.focus();
  }

  toggleSeo() {
    this.isSeoOpen = !this.isSeoOpen;
  }

  saveDraft() {
    const data = { ...this.blogForm.value, status: 'draft', date: new Date().toISOString() };
    this.saveToLocalStorage(data);
    alert('Đã lưu bản nháp thành công!');
  }

  publish() {
    if (this.blogForm.invalid) {
      alert('Vui lòng nhập Tiêu đề và Nội dung bài viết!');
      return;
    }
    const data = { ...this.blogForm.value, status: 'published', date: new Date().toISOString() };
    this.saveToLocalStorage(data);
    alert('Bài viết đã được xuất bản!');
    this.router.navigate(['/blog-list']);
  }

  saveToLocalStorage(data: any) {
    if (isPlatformBrowser(this.platformId)) {
      let posts = JSON.parse(localStorage.getItem('userBlogs') || '[]');
      posts.push({ ...data, id: Date.now() });
      localStorage.setItem('userBlogs', JSON.stringify(posts));
    }
  }
}
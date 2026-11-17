import { Component, Inject, OnInit, PLATFORM_ID, ChangeDetectorRef, inject } from '@angular/core';
import { CommonModule, isPlatformBrowser } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { firstValueFrom } from 'rxjs';
import { ActivatedRoute } from '@angular/router';
import { AdminApiService } from '../../core/services/admin-api.service';
import { AdminSocketService } from '../../core/services/admin-socket.service';

declare var bootstrap: any;

@Component({
  selector: 'app-map-admin',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './map-admin.html',
  styleUrls: ['./map-admin.css']
})
export class MapAdmin implements OnInit {
  private readonly socket = inject(AdminSocketService);
  constructor(
    private adminApi: AdminApiService,
    private changeDetectorRef: ChangeDetectorRef,
    @Inject(PLATFORM_ID) private platformId: object,
    private route: ActivatedRoute
  ) {}

  Math = Math;
  maps: any[] = [];
  isLoading = false;
  mapLoadError = '';
  currentPage = 1;
  ITEMS_PER_PAGE = 8;
  editingId: string | null = null;
  isSaving = false;
  saveError = '';
  saveSuccess = '';
  imageError = '';
  imagePreview: string | null = null;
  selectedImage: File | null = null;
  private uploadedImage: string | null = null;
  private pendingMapId: string | null = null;
  private imageReader: FileReader | null = null;
  private initialForm: Record<string, unknown> = {};
  private pendingSearchId: string | null = null;
  showDeleteConfirm = false;
  deletingMapId: string | null = null;
  deletingMapName = '';

  // Form Model
  mapIdInput: string = '';
  mapName: string = '';
  mapAuthor: string = '';
  mapImage: string = '';
  mapDifficulty: string = 'Dễ';
  mapGridSize: string = '';
  mapTotalBeads: number | null = null;
  mapBeadType: string = 'Midi 5mm';
  mapTime: string = '';
  mapDesc: string = '';

  ngOnInit(): void {
    this.route.queryParamMap.subscribe(params => {
      this.pendingSearchId = params.get('searchType') === 'map'
        ? params.get('searchId')
        : null;
      this.applySearchTarget();
    });
    this.loadMaps();
    this.socket.onCrudChange('gallery').subscribe(() => this.loadMaps());
  }

  loadMaps(): void {
    if (!isPlatformBrowser(this.platformId)) {
      return;
    }

    this.maps = this.readCachedMaps();
    this.applySearchTarget();
    this.mapLoadError = '';
    this.isLoading = true;

    this.adminApi.getLibraryMaps().subscribe({
      next: (response: any) => {
        const mapList = Array.isArray(response)
          ? response
          : Array.isArray(response?.maps)
            ? response.maps
            : null;

        if (!mapList) {
          this.mapLoadError = 'Máy chủ trả về dữ liệu mẫu không hợp lệ.';
          console.error('API thư viện map trả về dữ liệu không hợp lệ:', response);
        } else {
          this.maps = mapList;
          this.currentPage = 1;
          this.applySearchTarget();
          try {
            localStorage.setItem('library_maps', JSON.stringify(mapList));
          } catch (error) {
            console.error('Không thể lưu cache thư viện map:', error);
          }
        }

        this.isLoading = false;
        this.changeDetectorRef.markForCheck();
      },
      error: (error) => {
        console.error('Lỗi tải thư viện map:', error);
        this.mapLoadError = 'Không thể tải danh sách mẫu. Vui lòng thử lại sau.';
        this.isLoading = false;
        this.changeDetectorRef.markForCheck();
      }
    });
  }

  private readCachedMaps(): any[] {
    try {
      const cached = localStorage.getItem('library_maps');
      if (!cached) return [];

      const maps = JSON.parse(cached);
      if (Array.isArray(maps)) return maps;
      console.error('Cache thư viện map không đúng định dạng.');
    } catch (error) {
      console.error('Không thể đọc cache thư viện map:', error);
    }

    return [];
  }

  get pagedMaps() {
    const start = (this.currentPage - 1) * this.ITEMS_PER_PAGE;
    return this.maps.slice(start, start + this.ITEMS_PER_PAGE);
  }

  getPageArray(): number[] {
    const totalPages = Math.ceil(this.maps.length / this.ITEMS_PER_PAGE) || 1;
    return Array.from({ length: totalPages }, (_, i) => i + 1);
  }

  changePage(page: number) {
    if (page >= 1 && page <= Math.ceil(this.maps.length / this.ITEMS_PER_PAGE)) {
      this.currentPage = page;
    }
  }

  searchTargetId(id: string | number | undefined | null): string {
    return `admin-search-target-map-${encodeURIComponent(String(id ?? ''))}`;
  }

  private applySearchTarget(): void {
    const id = this.pendingSearchId;
    if (!id) return;

    const index = this.maps.findIndex(map =>
      String(map.map_id || map.id || map._id || '') === id
    );
    if (index < 0) return;

    this.currentPage = Math.floor(index / this.ITEMS_PER_PAGE) + 1;
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

  getImagePath(path: string): string {
    if (!path) return '';
    if (path.startsWith('http') || path.startsWith('data:')) return path;
    return this.adminApi.getLibraryMapImageUrl(path);
  }

  getDifficultyBadgeClass(diff: string): string {
    const normalized = String(diff || '').normalize('NFC').trim().replace(/\s+/g, ' ').toLocaleLowerCase('vi-VN');
    if (normalized === 'dễ') return 'bg-success';
    if (normalized === 'trung bình') return 'bg-warning text-dark';
    if (normalized === 'khó') return 'bg-danger';
    return 'bg-secondary';
  }

  openModal(id: string | null = null) {
    if (this.isSaving) return;
    this.imageReader?.abort();
    this.imageReader = null;
    this.selectedImage = null;
    this.imagePreview = null;
    this.uploadedImage = null;
    this.pendingMapId = null;
    this.imageError = '';
    this.saveError = '';
    this.saveSuccess = '';
    this.editingId = id;
    const imageInput = document.getElementById('map-image-file') as HTMLInputElement | null;
    if (imageInput) imageInput.value = '';
    const modalTitleEl = document.getElementById('modalTitle');

    if (id) {
      if (modalTitleEl) modalTitleEl.innerText = "Chỉnh sửa mẫu";
      const m = this.maps.find(item => item.map_id === id);
      if (!m) {
        this.saveError = 'Không tìm thấy Map mẫu cần chỉnh sửa. Vui lòng tải lại danh sách.';
        return;
      }
      if (m) {
        this.mapIdInput = m.map_id;
        this.mapName = m.map_name || '';
        this.mapAuthor = m.author ?? '';
        this.mapImage = m.main_image || '';
        this.mapDifficulty = m.difficulty || 'Dễ';
        this.mapGridSize = m.grid_size || '';
        this.mapTotalBeads = m.total_beads ?? null;
        this.mapBeadType = m.bead_type || 'Midi 5mm';
        this.mapTime = m.time || '';
        this.mapDesc = m.description || '';
      }
    } else {
      if (modalTitleEl) modalTitleEl.innerText = "Thêm mẫu mới";
      this.mapIdInput = '';
      this.mapName = '';
      this.mapAuthor = '';
      this.mapImage = '';
      this.mapDifficulty = 'Dễ';
      this.mapGridSize = '';
      this.mapTotalBeads = null;
      this.mapBeadType = 'Midi 5mm';
      this.mapTime = '';
      this.mapDesc = '';
    }

    this.initialForm = {
      map_name: this.mapName.trim(), author: this.mapAuthor.trim(), difficulty: this.mapDifficulty,
      grid_size: this.mapGridSize.trim(), total_beads: this.mapTotalBeads,
      bead_type: this.mapBeadType.trim(), description: this.mapDesc.trim(), time: this.mapTime.trim()
    };
    const modalEl = document.getElementById('mapModal');
    if (modalEl) {
      new bootstrap.Modal(modalEl).show();
    }
  }

  onImageSelected(event: Event): void {
    if (this.isSaving) return;
    this.imageReader?.abort();
    this.imageReader = null;
    this.selectedImage = null;
    this.imagePreview = null;
    this.uploadedImage = null;
    this.imageError = '';
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    if (!file) return;
    if (!['image/png', 'image/jpeg', 'image/jpg', 'image/webp'].includes(file.type) ||
        file.size === 0 || file.size > 8 * 1024 * 1024) {
      this.imageError = 'Chỉ nhận PNG, JPG, JPEG, WEBP lớn hơn 0 và tối đa 8 MB.';
      input.value = '';
      return;
    }
    this.selectedImage = file;
    const reader = new FileReader();
    this.imageReader = reader;
    reader.onload = () => {
      if (this.imageReader !== reader) return;
      this.imagePreview = reader.result as string;
      this.changeDetectorRef.markForCheck();
    };
    reader.onerror = () => {
      if (this.imageReader !== reader) return;
      this.imageError = 'Không thể đọc ảnh. Vui lòng chọn lại.';
      this.changeDetectorRef.markForCheck();
    };
    reader.readAsDataURL(file);
  }

  async saveMap(): Promise<void> {
    if (this.isSaving) return;
    this.saveError = '';
    this.saveSuccess = '';
    const existing = this.editingId ? this.maps.find(m => m.map_id === this.editingId) : null;
    if (this.editingId && !existing) {
      this.saveError = 'Không tìm thấy Map mẫu cần chỉnh sửa. Vui lòng tải lại danh sách.';
      return;
    }
    if (!this.mapName.trim() || !this.mapAuthor.trim()) {
      this.saveError = 'Vui lòng nhập tên mẫu và tác giả, không chỉ nhập khoảng trắng.';
      return;
    }
    if (typeof this.mapTotalBeads !== 'number' || !Number.isSafeInteger(this.mapTotalBeads) || this.mapTotalBeads < 0) {
      this.saveError = 'Tổng số hạt phải là số nguyên không âm, có thể bằng 0.';
      return;
    }
    if (this.imageError || (!this.editingId && !this.selectedImage)) {
      this.saveError = this.imageError || 'Vui lòng chọn hình ảnh mẫu.';
      return;
    }

    this.isSaving = true;
    let uploading = false;
    try {
      let image = existing ? existing.main_image : '';
      if (this.selectedImage) {
        uploading = true;
        if (!this.uploadedImage) {
          this.uploadedImage = await firstValueFrom(this.adminApi.uploadProductImage(this.selectedImage));
        }
        image = this.uploadedImage;
        uploading = false;
      }
      let difficultyClass = 'badge-easy';
      if (this.mapDifficulty === 'Trung bình') difficultyClass = 'badge-medium';
      else if (this.mapDifficulty === 'Khó') difficultyClass = 'badge-hard';
      const payload: any = {
        map_name: this.mapName.trim(), author: this.mapAuthor.trim(),
        difficulty: this.mapDifficulty, difficultyClass,
        grid_size: this.mapGridSize.trim(), total_beads: this.mapTotalBeads,
        bead_type: this.mapBeadType.trim(), description: this.mapDesc.trim(),
        time: this.mapTime.trim() || (existing ? '' : '15-20 phút')
      };
      // Omit the old image on updates unless a replacement was uploaded.
      if (!existing || this.selectedImage) payload.main_image = image;
      if (existing) {
        if (payload.difficulty === this.initialForm['difficulty']) delete payload.difficultyClass;
        for (const key of Object.keys(this.initialForm)) {
          if (payload[key] === this.initialForm[key]) delete payload[key];
        }
        await firstValueFrom(this.adminApi.updateLibraryMap(this.editingId!, payload));
      } else {
        if (!this.pendingMapId) {
          const nextNum = this.maps.length > 0 ? Math.max(...this.maps.map(m => {
            const num = parseInt(m.map_id?.substring(1));
            return isNaN(num) ? 0 : num;
          })) + 1 : 1;
          this.pendingMapId = 'M' + nextNum.toString().padStart(2, '0');
        }
        await firstValueFrom(this.adminApi.saveLibraryMap({
          ...payload, map_id: this.pendingMapId, gallery_images: [],
          categories: ['Trang trí'], download_link: '', related_product_ids: []
        }));
      }
      this.saveSuccess = existing ? 'Đã cập nhật Map mẫu.' : 'Đã thêm Map mẫu thành công.';
      const modalEl = document.getElementById('mapModal');
      if (modalEl) bootstrap.Modal.getInstance(modalEl)?.hide();
      this.loadMaps();
    } catch (error: any) {
      const detail = error?.error?.message || error?.message;
      this.saveError = error?.status === 409
        ? 'Mã Map mẫu đã tồn tại. Vui lòng tải lại danh sách để kiểm tra trước khi thêm lại.'
        : `${uploading ? 'Không thể tải ảnh lên' : 'Không thể lưu Map mẫu'}${detail ? ': ' + detail : '. Vui lòng thử lại.'}`;
    } finally {
      this.isSaving = false;
      this.changeDetectorRef.markForCheck();
    }
  }

  deleteMap(id: string) {
    const map = this.maps.find(item => String(item.map_id || item.id || item._id || '') === id);
    this.deletingMapId = id;
    this.deletingMapName = map?.map_name || map?.name || 'mẫu này';
    this.showDeleteConfirm = true;
  }

  closeDeleteConfirm(): void {
    this.showDeleteConfirm = false;
    this.deletingMapId = null;
    this.deletingMapName = '';
  }

  confirmDeleteMap(): void {
    const id = this.deletingMapId;
    if (!id) return;

    this.adminApi.deleteLibraryMap(id).subscribe({
      next: () => this.loadMaps(),
      error: (err) => console.error('Lỗi xóa map qua API:', err)
    });

    this.maps = this.maps.filter(m => String(m.map_id || m.id || m._id || '') !== id);
    if (typeof window !== 'undefined' && typeof localStorage !== 'undefined') {
      localStorage.setItem('library_maps', JSON.stringify(this.maps));
    }
    this.closeDeleteConfirm();
  }
}

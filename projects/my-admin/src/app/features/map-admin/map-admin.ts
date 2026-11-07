import { Component, Inject, OnInit, PLATFORM_ID, ChangeDetectorRef } from '@angular/core';
import { CommonModule, isPlatformBrowser } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute } from '@angular/router';
import { AdminApiService } from '../../core/services/admin-api.service';

declare var bootstrap: any;

@Component({
  selector: 'app-map-admin',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './map-admin.html',
  styleUrls: ['./map-admin.css']
})
export class MapAdmin implements OnInit {
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
    if (diff === 'Dễ') return 'bg-success';
    if (diff === 'Trung bình') return 'bg-warning text-dark';
    if (diff === 'Khó') return 'bg-danger';
    return 'bg-secondary';
  }

  openModal(id: string | null = null) {
    this.editingId = id;
    const modalTitleEl = document.getElementById('modalTitle');

    if (id) {
      if (modalTitleEl) modalTitleEl.innerText = "Chỉnh sửa mẫu";
      const m = this.maps.find(item => item.map_id === id);
      if (m) {
        this.mapIdInput = m.map_id;
        this.mapName = m.map_name || '';
        this.mapAuthor = m.author || 'Urii Thiết kế';
        this.mapImage = m.main_image || '';
        this.mapDifficulty = m.difficulty || 'Dễ';
        this.mapGridSize = m.grid_size || '';
        this.mapTotalBeads = m.total_beads || null;
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

    const modalEl = document.getElementById('mapModal');
    if (modalEl) {
      new bootstrap.Modal(modalEl).show();
    }
  }

  saveMap() {
    if (!this.mapName.trim()) {
      alert("Vui lòng điền tên mẫu!");
      return;
    }

    let difficultyClass = 'badge-easy';
    if (this.mapDifficulty === 'Trung bình') difficultyClass = 'badge-medium';
    else if (this.mapDifficulty === 'Khó') difficultyClass = 'badge-hard';

    if (this.editingId) {
      const index = this.maps.findIndex(m => m.map_id === this.editingId);
      if (index !== -1) {
        this.maps[index] = {
          ...this.maps[index],
          map_name: this.mapName.trim(),
          author: this.mapAuthor.trim() || 'Urii Thiết kế',
          main_image: this.mapImage.trim(),
          difficulty: this.mapDifficulty,
          difficultyClass,
          grid_size: this.mapGridSize.trim(),
          total_beads: Number(this.mapTotalBeads) || 0,
          bead_type: this.mapBeadType.trim(),
          description: this.mapDesc.trim(),
          time: this.mapTime.trim() || '15-20 phút'
        };
      }
    } else {
      const nextNum = this.maps.length > 0 ? Math.max(...this.maps.map(m => {
        const num = parseInt(m.map_id?.substring(1));
        return isNaN(num) ? 0 : num;
      })) + 1 : 1;

      const map_id = 'M' + nextNum.toString().padStart(2, '0');
      this.maps.push({
        map_id,
        map_name: this.mapName.trim(),
        author: this.mapAuthor.trim() || 'Urii Thiết kế',
        main_image: this.mapImage.trim(),
        gallery_images: [],
        difficulty: this.mapDifficulty,
        difficultyClass,
        categories: ["Trang trí"],
        grid_size: this.mapGridSize.trim(),
        bead_type: this.mapBeadType.trim(),
        total_beads: Number(this.mapTotalBeads) || 0,
        download_link: "",
        description: this.mapDesc.trim(),
        time: this.mapTime.trim() || "15-20 phút",
        related_product_ids: []
      });
    }

    if (typeof window !== 'undefined' && typeof localStorage !== 'undefined') {
      localStorage.setItem('library_maps', JSON.stringify(this.maps));
    }

    const modalEl = document.getElementById('mapModal');
    if (modalEl) {
      const modalInstance = bootstrap.Modal.getInstance(modalEl);
      if (modalInstance) modalInstance.hide();
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

    this.maps = this.maps.filter(m => String(m.map_id || m.id || m._id || '') !== id);
    if (typeof window !== 'undefined' && typeof localStorage !== 'undefined') {
      localStorage.setItem('library_maps', JSON.stringify(this.maps));
    }
    this.closeDeleteConfirm();
  }
}

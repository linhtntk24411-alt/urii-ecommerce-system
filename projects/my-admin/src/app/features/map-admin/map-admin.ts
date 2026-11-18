import { Component, Inject, OnInit, PLATFORM_ID, ChangeDetectorRef, DestroyRef, inject } from '@angular/core';
import { CommonModule, isPlatformBrowser } from '@angular/common';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormsModule } from '@angular/forms';
import { firstValueFrom, timeout } from 'rxjs';
import { ActivatedRoute } from '@angular/router';
import { AdminApiService } from '../../core/services/admin-api.service';
import { AdminSocketService } from '../../core/services/admin-socket.service';

declare var bootstrap: any;

const MAP_COLUMNS = [
  'map_id', 'map_name', 'author', 'main_image', 'gallery_images', 'difficulty',
  'difficultyClass', 'categories', 'grid_size', 'bead_type', 'total_beads',
  'download_link', 'description', 'related_product_ids', 'time'
] as const;
type MapColumn = typeof MAP_COLUMNS[number];
type MapPayload = Record<Exclude<MapColumn, 'gallery_images' | 'categories' | 'related_product_ids' | 'total_beads'>, string> & {
  gallery_images: string[];
  categories: string[];
  related_product_ids: string[];
  total_beads: number;
};
type ImportStatus = 'ready' | 'invalid' | 'saved' | 'failed' | 'unknown';
type ImportRow = {
  line: number;
  map: MapPayload;
  errors: string[];
  status: ImportStatus;
  previewImage: string;
  imageUnavailable?: boolean;
};
type TableRow = { line: number; cells: unknown[] };

@Component({
  selector: 'app-map-admin',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './map-admin.html',
  styleUrls: ['./map-admin.css']
})
export class MapAdmin implements OnInit {
  private readonly socket = inject(AdminSocketService);
  private readonly destroyRef = inject(DestroyRef);
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
  importFile: File | null = null;
  importFormat = '';
  importSheet = '';
  importError = '';
  importRows: ImportRow[] = [];
  importChecking = false;
  importing = false;
  importFinished = false;
  importTotal = 0;
  importProcessed = 0;
  readonly importLabels: Record<ImportStatus, string> = {
    ready: 'Hợp lệ', invalid: 'Lỗi dữ liệu', saved: 'Đã lưu',
    failed: 'Lưu thất bại', unknown: 'Chưa xác định'
  };
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
    this.route.queryParamMap.pipe(takeUntilDestroyed(this.destroyRef)).subscribe(params => {
      this.pendingSearchId = params.get('searchType') === 'map'
        ? params.get('searchId')
        : null;
      this.applySearchTarget();
    });
    this.loadMaps();
    this.socket.onCrudChange('gallery').pipe(takeUntilDestroyed(this.destroyRef)).subscribe(() => {
      if (!this.importing) this.loadMaps();
    });
  }

  loadMaps(): void {
    if (!isPlatformBrowser(this.platformId)) {
      return;
    }

    this.maps = this.readCachedMaps();
    this.applySearchTarget();
    this.mapLoadError = '';
    this.isLoading = true;

    this.adminApi.getLibraryMaps().pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
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

  openImport(): void {
    if (this.isSaving || this.importChecking || this.importing) return;
    const modal = document.getElementById('mapImportModal');
    if (modal) bootstrap.Modal.getOrCreateInstance(modal).show();
  }

  selectImportFile(event: Event): void {
    const input = event.target as HTMLInputElement;
    this.importFile = input.files?.[0] ?? null;
    input.value = '';
    this.importFormat = this.importFile?.name.match(/\.([^.]+)$/)?.[1].toLowerCase() ?? '';
    this.importRows = [];
    this.importError = '';
    this.importSheet = '';
    this.importFinished = false;
  }

  get importCounts(): Record<ImportStatus, number> {
    const counts = { ready: 0, invalid: 0, saved: 0, failed: 0, unknown: 0 };
    for (const row of this.importRows) counts[row.status]++;
    return counts;
  }

  async checkImportFile(): Promise<void> {
    if (!this.importFile || this.importChecking || this.importing || this.importFinished) return;
    this.importChecking = true;
    this.importError = '';
    this.importRows = [];
    this.importSheet = '';
    try {
      const rows = await this.readImportFile(this.importFile);
      const header = rows.shift();
      if (!header) throw new Error('File rỗng hoặc không có tiêu đề.');
      const headerError = this.checkImportHeader(header.cells);
      if (headerError) throw new Error(headerError);
      const data = rows.filter(row => row.cells.some(value => value != null && String(value).trim() !== ''));
      if (!data.length) throw new Error('File không có dòng dữ liệu.');
      const columns = new Map(header.cells.map((name, index) => [name, index]));
      const validated = data.map(row => this.validateImportRow(row, columns));
      let next = validated.some(row => row.status === 'ready') ? await this.lastMapNumber() : 0n;
      for (const row of validated) {
        if (row.status === 'ready') row.map.map_id = this.formatMapId(++next);
      }
      this.importRows = validated;
    } catch (error) {
      this.importError = error instanceof Error ? error.message : 'Không thể kiểm tra file.';
    } finally {
      this.importChecking = false;
      this.changeDetectorRef.markForCheck();
    }
  }

  private checkImportHeader(cells: unknown[]): string {
    const missing = MAP_COLUMNS.filter(column => !cells.includes(column));
    const extra = cells.filter(cell => !MAP_COLUMNS.some(column => column === cell));
    const duplicate = [...new Set(cells.filter((cell, index) => cells.indexOf(cell) !== index))];
    const labels = (values: unknown[]) => values.map(value => String(value ?? '') || '(trống)').join(', ');
    return [
      cells.length !== MAP_COLUMNS.length ? 'File phải có đúng 15 cột.' : '',
      missing.length ? `Thiếu cột: ${labels(missing)}.` : '',
      extra.length ? `Cột thừa hoặc sai tên: ${labels(extra)}.` : '',
      duplicate.length ? `Trùng tên cột: ${labels(duplicate)}.` : ''
    ].filter(Boolean).join(' ');
  }

  private async readImportFile(file: File): Promise<TableRow[]> {
    if (!['csv', 'xlsx', 'xls'].includes(this.importFormat)) {
      throw new Error('Chỉ hỗ trợ file CSV, XLSX và XLS.');
    }
    if (!file.size) throw new Error('File rỗng.');
    if (file.size > 5 * 1024 * 1024) throw new Error('File vượt quá 5 MB.');
    const buffer = await file.arrayBuffer();
    if (this.importFormat === 'csv') {
      let text: string;
      try {
        text = new TextDecoder('utf-8', { fatal: true }).decode(buffer);
      } catch {
        throw new Error('File CSV phải dùng mã hóa UTF-8.');
      }
      if (text.includes('\0')) throw new Error('Nội dung file CSV không hợp lệ.');
      return this.readMapCsv(text);
    }
    const bytes = new Uint8Array(buffer);
    const isZip = bytes[0] === 0x50 && bytes[1] === 0x4b && bytes[2] === 3 && bytes[3] === 4;
    const xlsSignature = [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1];
    const isLegacyBiff = bytes[0] === 0x09 && [0, 2, 4, 8].includes(bytes[1]);
    if (this.importFormat === 'xlsx' ? !isZip : !(isLegacyBiff || xlsSignature.every((b, i) => bytes[i] === b))) {
      throw new Error('Nội dung file không khớp định dạng Excel đã chọn.');
    }
    const { read, utils } = await import('xlsx');
    const workbook = read(bytes, {
      type: 'array', cellFormula: true, cellHTML: false, cellText: false,
      sheetStubs: true, bookFiles: isZip
    });
    const archiveEntries = 'keys' in workbook && Array.isArray(workbook.keys) ? workbook.keys : [];
    if (isZip && !archiveEntries.includes('xl/workbook.xml')) {
      throw new Error('Nội dung file không phải workbook XLSX.');
    }
    let firstHeaderError = '';
    for (const name of workbook.SheetNames) {
      const sheet = workbook.Sheets[name];
      if (!sheet?.['!ref'] || sheet['!type']) continue;
      const range = utils.decode_range(sheet['!ref']);
      const readRow = (r: number): TableRow => {
        const cells = [];
        for (let c = range.s.c; c <= range.e.c; c++) {
          const cell = sheet[utils.encode_cell({ r, c })];
          cells.push(cell?.t === 'e' || cell?.t === 'b' || ((cell?.f || cell?.F) && cell.v == null)
            ? Symbol('invalidExcelCell') : cell?.v);
        }
        return { line: r + 1, cells };
      };
      if (range.e.c - range.s.c + 1 > MAP_COLUMNS.length) {
        firstHeaderError ||= 'Worksheet có cột thừa. File phải có đúng 15 cột.';
        continue;
      }
      const header = readRow(range.s.r);
      const headerError = this.checkImportHeader(header.cells);
      if (headerError) {
        firstHeaderError ||= headerError;
        continue;
      }
      if (range.e.r - range.s.r > 5000) throw new Error('Worksheet vượt quá 5.000 hàng dữ liệu.');
      this.importSheet = name;
      const rows = [header];
      for (let r = range.s.r + 1; r <= range.e.r; r++) rows.push(readRow(r));
      return rows;
    }
    throw new Error(firstHeaderError || 'Không tìm thấy worksheet có cấu trúc phù hợp.');
  }

  private readMapCsv(text: string): TableRow[] {
    const rows: TableRow[] = [];
    let cells: string[] = [];
    let value = '';
    let quoted = false;
    let closedQuote = false;
    let line = 1;
    let rowLine = 1;
    const endCell = () => {
      cells.push(value);
      value = '';
      closedQuote = false;
    };
    const endRow = () => {
      endCell();
      rows.push({ line: rowLine, cells });
      cells = [];
      if (rows.length > 5001) throw new Error('CSV vượt quá 5.000 hàng dữ liệu.');
    };
    for (let i = 0; i < text.length; i++) {
      const char = text[i];
      const newline = char === '\r' || char === '\n';
      const crlf = char === '\r' && text[i + 1] === '\n';
      if (quoted) {
        if (char === '"' && text[i + 1] === '"') {
          value += '"';
          i++;
        } else if (char === '"') {
          quoted = false;
          closedQuote = true;
        } else {
          value += crlf ? '\r\n' : char;
          if (crlf) i++;
          if (newline) line++;
        }
      } else if (char === ',') {
        endCell();
      } else if (newline) {
        endRow();
        if (crlf) i++;
        rowLine = ++line;
      } else if (closedQuote || (char === '"' && value !== '')) {
        throw new Error(`Dòng ${rowLine}: dấu ngoặc kép CSV không hợp lệ.`);
      } else if (char === '"') {
        quoted = true;
      } else {
        value += char;
      }
    }
    if (quoted) throw new Error(`Dòng ${rowLine}: ô CSV chưa đóng dấu ngoặc kép.`);
    if (cells.length || value || closedQuote) endRow();
    return rows;
  }

  private validateImportRow(row: TableRow, columns: Map<unknown, number>): ImportRow {
    const errors: string[] = [];
    if (row.cells.length > MAP_COLUMNS.length) errors.push('Dòng có ô thừa.');
    const readCell = (column: MapColumn) => row.cells[columns.get(column)!];
    const readText = (column: MapColumn, fallback = ''): string => {
      const value = readCell(column);
      if (value == null || (typeof value === 'string' && !value.trim())) return fallback;
      if (typeof value === 'string') return value;
      errors.push(`${column} phải là văn bản.`);
      return fallback;
    };
    const readArray = (column: MapColumn): string[] => {
      const value = readText(column, '[]');
      try {
        const parsed = JSON.parse(value);
        if (Array.isArray(parsed) && parsed.every(item => typeof item === 'string')) return parsed;
      } catch {
        // Report invalid JSON and invalid element types with the same field message.
      }
      errors.push(`${column} phải là JSON array chứa chuỗi.`);
      return [];
    };
    const rawBeads = readCell('total_beads');
    const totalBeads = typeof rawBeads === 'number' ? rawBeads
      : typeof rawBeads === 'string' && /^\d+$/.test(rawBeads.trim()) ? Number(rawBeads) : NaN;
    const difficulty = readText('difficulty', 'Dễ');
    const expectedClass = new Map([
      ['Dễ', 'badge-easy'], ['Trung bình', 'badge-medium'], ['Khó', 'badge-hard']
    ]).get(difficulty);
    const map: MapPayload = {
      map_id: '', map_name: readText('map_name'), author: readText('author'),
      main_image: readText('main_image'), gallery_images: readArray('gallery_images'),
      difficulty, difficultyClass: readText('difficultyClass', expectedClass ?? ''),
      categories: readArray('categories'), grid_size: readText('grid_size'),
      bead_type: readText('bead_type', 'Midi 5mm'), total_beads: totalBeads,
      download_link: readText('download_link'), description: readText('description'),
      related_product_ids: readArray('related_product_ids'), time: readText('time', '15-20 phút')
    };
    for (const field of ['map_name', 'author', 'main_image'] as const) {
      if (!map[field]) errors.push(`Thiếu ${field}.`);
    }
    if (!Number.isSafeInteger(totalBeads) || totalBeads < 0) {
      errors.push('total_beads phải là số nguyên an toàn, không âm.');
    }
    if (!expectedClass || expectedClass !== map.difficultyClass) {
      errors.push('difficulty và difficultyClass không tạo thành cặp hợp lệ.');
    }
    if (map.main_image && !this.validImportPath(map.main_image, 'images')) {
      errors.push('main_image có URL hoặc đường dẫn không hợp lệ.');
    }
    map.gallery_images.forEach((path, index) => {
      if (!this.validImportPath(path, 'images')) errors.push(`gallery_images[${index}] có đường dẫn không hợp lệ.`);
    });
    if (map.download_link && !this.validImportPath(map.download_link, 'files')) {
      errors.push('download_link có URL hoặc đường dẫn PDF không hợp lệ.');
    }
    return {
      line: row.line, map, errors, status: errors.length ? 'invalid' : 'ready',
      previewImage: this.validImportPath(map.main_image, 'images') ? this.getImagePath(map.main_image) : ''
    };
  }

  private validImportPath(path: string, folder: 'images' | 'files'): boolean {
    if (/[\s\\\u0000-\u001f\u007f]/.test(path) || /%(?![\da-f]{2})/i.test(path)) return false;
    if (/^https?:\/\//.test(path)) {
      try {
        const url = new URL(path);
        return !!url.hostname && !url.username && !url.password;
      } catch {
        return false;
      }
    }
    const internal = path.replace(/^\//, '');
    if (!internal.startsWith(folder + '/') || /[:?#]/.test(internal)) return false;
    if (folder === 'files' && !/\.pdf$/i.test(internal)) return false;
    try {
      return internal.split('/').every(segment => {
        const decoded = decodeURIComponent(segment);
        return !!decoded && decoded !== '.' && decoded !== '..' && !/[\/\\\u0000-\u001f]/.test(decoded);
      });
    } catch {
      return false;
    }
  }

  private async lastMapNumber(): Promise<bigint> {
    let max = 0n;
    const seen = new Set<string>();
    try {
      for (let page = 1; ; page++) {
        const reply = await firstValueFrom(this.adminApi.getLibraryMaps(page, 100).pipe(timeout(15000)));
        const maps = Array.isArray(reply) ? reply : reply?.maps;
        if (!Array.isArray(maps) || maps.length > 100) throw new Error();
        for (const map of maps) {
          const id = map?.map_id;
          if (typeof id !== 'string' || !id || seen.has(id)) throw new Error();
          seen.add(id);
          if (/^M\d+$/.test(id)) {
            const number = BigInt(id.slice(1));
            if (number > max) max = number;
          }
        }
        if (maps.length < 100) return max;
      }
    } catch {
      throw new Error('Không thể xác minh toàn bộ mã Map từ máy chủ. Vui lòng kiểm tra lại.');
    }
  }

  private formatMapId(number: bigint): string {
    return 'M' + number.toString().padStart(2, '0');
  }

  async confirmImport(): Promise<void> {
    if (this.importing || this.importChecking || this.importFinished) return;
    const pending = this.importRows.filter(row => row.status === 'ready');
    if (!pending.length) return;
    this.importing = true;
    this.importError = '';
    this.importTotal = pending.length;
    this.importProcessed = 0;
    let sent = false;
    try {
      let last = await this.lastMapNumber();
      for (const row of pending) {
        for (let attempt = 0; ; attempt++) {
          row.map.map_id = this.formatMapId(++last);
          sent = true;
          try {
            const response = await firstValueFrom(this.adminApi.saveLibraryMap(row.map, true).pipe(timeout(20000)));
            if (response?.status === 201 && typeof response.body?._id === 'string' &&
                response.body._id.trim() && response.body.map_id === row.map.map_id) {
              row.status = 'saved';
            } else {
              row.status = 'unknown';
              row.errors.push('Phản hồi chưa xác nhận mã Map và bản ghi đã lưu.');
            }
          } catch (error: any) {
            const status = error?.status;
            if (status === 409 && attempt < 2) {
              try {
                const currentMax = await this.lastMapNumber();
                if (currentMax > last) last = currentMax;
              } catch (verificationError) {
                row.status = 'failed';
                row.errors.push('Mã Map đã trùng và không thể xác minh mã mới.');
                this.importProcessed++;
                throw verificationError;
              }
              continue;
            }
            row.status = !status || status >= 500 ? 'unknown' : 'failed';
            row.errors.push(status === 400 ? 'Máy chủ từ chối dữ liệu (400).'
              : status === 409 ? 'Mã Map bị trùng sau 3 lần thử (409).'
              : row.status === 'unknown' ? 'Không xác nhận được kết quả. Hãy tra cứu mã trước khi nhập lại.'
              : `Máy chủ từ chối lưu (${status}).`);
            if (status === 401 || status === 403) {
              this.importProcessed++;
              throw new Error('Đã dừng nhập vì phiên đăng nhập hoặc quyền truy cập không hợp lệ.');
            }
          }
          break;
        }
        this.importProcessed++;
        this.changeDetectorRef.markForCheck();
      }
    } catch (error) {
      this.importError = error instanceof Error ? error.message : 'Không thể tiếp tục nhập.';
    } finally {
      this.importFinished = sent;
      this.importing = false;
      if (sent) this.loadMaps();
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

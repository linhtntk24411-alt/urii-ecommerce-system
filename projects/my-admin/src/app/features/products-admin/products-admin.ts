import { ChangeDetectorRef, Component, inject, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { firstValueFrom, timeout } from 'rxjs';

import { ActivatedRoute, RouterLink } from '@angular/router';
import { AdminApiService } from '../../core/services/admin-api.service';
import { AdminSocketService } from '../../core/services/admin-socket.service';
import { Product } from '../../../../../my-user/src/app/models/uri.model';

declare var bootstrap: any;

type ImportedVariant = { name: string; price: number; stock: number; image?: string };
type ProductImportPayload = {
  id: string;
  name: string;
  slug: string;
  category: string;
  image: string;
  stock: number;
  originalPrice: number;
  currentPrice: number;
  description: string;
  isSale?: boolean;
  rating?: number;
  reviewCount?: number;
  variants?: ImportedVariant[];
  specifications?: Record<string, string>;
};
type ImportStatus = 'ready' | 'invalid' | 'saved' | 'failed' | 'unknown';
type ProductImportRow = {
  line: number;
  product: ProductImportPayload;
  errors: string[];
  warnings: string[];
  status: ImportStatus;
};
type ProductTableRow = { line: number; cells: unknown[] };


@Component({
  selector: 'app-products-admin',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './products-admin.html',
  styleUrls: ['./products-admin.css']
})
export class ProductsAdmin implements OnInit {
  private readonly changeDetector = inject(ChangeDetectorRef);
  products: Product[] = [];
  currentPage = 1;
  itemsPerPage = 5;

  statTotal = 0;
  statWarning = 0;
  statDanger = 0;
  statNew = 0;
  statHot = 0;

  searchName = '';
  filterCategory = '';
  filterStatus = '';
  filterPrice = '';

  totalItems = 0;
  totalPages = 1;
  totalPagesArray: number[] = [];
  pageItems: Product[] = [];
  startIdx = 0;
  mathMin = Math.min;

  readonly defaultProductImage = '/images/Logo.png';
  editData: any = { id: null, name: '', category: 'HN', currentPrice: 0, stock: 0, image: this.defaultProductImage };
  isSaving = false;
  isReadingImage = false;
  saveError = '';
  imageError = '';
  saveSuccess = '';
  private createSlug = '';
  private createProductId = '';
  private uploadedImage: string | null = null;

  get isEditMode(): boolean {
    return !!(this.editData.id || this.editData._id);
  }

  categoriesMap: { [key: string]: string } = { 
    "HN": "Hạt nhựa", "DC": "Dụng cụ", "BST": "Bộ sưu tập", "KIT": "Bộ Kit", "TP": "Thành phần"
  };

  statusMap: { [key: string]: { text: string, class: string } } = { 
    "normal": { text: "Bình thường", class: "badge-status-normal" },
    "sap-het": { text: "Sắp hết hàng", class: "badge-status-sap-het" },
    "het-hang": { text: "Hết hàng", class: "badge-status-het-hang" },
    "new": { text: "Mới", class: "badge-status-new" },
    "hot": { text: "Bán chạy", class: "badge-status-hot" }
  };
  // Các biến quản lý file ảnh tải lên
  selectedFile: File | null = null;
  imagePreview: string | null = null;
  showDeleteConfirm = false;
  deletingProductId: string | number | null = null;
  deletingProductName = '';



  importFile: File | null = null;
  importSheet = '';
  importError = '';
  importRows: ProductImportRow[] = [];
  importChecking = false;
  importing = false;
  importFinished = false;
  importProcessed = 0;
  importTotal = 0;
  readonly importLabels: Record<ImportStatus, string> = {
    ready: 'Hợp lệ', invalid: 'Không hợp lệ', saved: 'Đã lưu',
    failed: 'Thất bại', unknown: 'Chưa xác định'
  };

  constructor(
    private adminApi: AdminApiService,
    private route: ActivatedRoute
  ) {}
  private pendingSearchId: string | null = null;

//  ngOnInit() {
//     // 1. Đăng ký lắng nghe dữ liệu sản phẩm như cũ
//     this.adminApi.products$.subscribe(data => {
//       this.products = data;
//       this.updateStats();
//       this.renderProducts();
//     });

//     // 2. BỔ SUNG THÊM: Gọi luôn hàm lấy dữ liệu từ API ngay khi vừa vào trang
//     if (this.adminApi.loadProducts) {
//       this.adminApi.loadProducts(); 
//     }
//   }
ngOnInit() {
  this.route.queryParamMap.subscribe(params => {
    this.pendingSearchId = params.get('searchType') === 'product'
      ? params.get('searchId')
      : null;
    this.applySearchTarget();
  });

  // Lắng nghe dữ liệu thay đổi từ service
  this.adminApi.products$.subscribe({
    next: (data) => {
      if (data) {
        this.products = data;
        this.updateStats();
        if (typeof this.renderProducts === 'function') {
          this.renderProducts();
        }
        this.applySearchTarget();
        this.changeDetector.markForCheck();
      }
    }
  });

  // Gọi ngay lập tức khi vào trang (bao gồm cả lúc F5)
  this.adminApi.loadProducts();
}

  searchTargetId(id: string | number | undefined | null): string {
    return `admin-search-target-product-${encodeURIComponent(String(id))}`;
  }

  private applySearchTarget(): void {
    const id = this.pendingSearchId;
    if (!id) return;

    this.searchName = '';
    this.filterCategory = '';
    this.filterStatus = '';
    this.filterPrice = '';
    const index = this.products.findIndex(product => String(product.id || product._id || '') === id);
    if (index < 0) return;

    this.currentPage = Math.floor(index / this.itemsPerPage) + 1;
    this.renderProducts();
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
  updateStats() {
    this.statTotal = this.products.length;

    // Đếm Sắp hết hàng (stock từ 1 đến dưới 15)
    this.statWarning = this.products.filter(p => this.getDisplayStatus(p) === 'sap-het').length;

    // Đếm Hết hàng (stock = 0)
    this.statDanger = this.products.filter(p => this.getDisplayStatus(p) === 'het-hang').length;

    // Đếm Sản phẩm mới
    this.statNew = this.products.filter(p => this.getDisplayStatus(p) === 'new').length;

    // Đếm Sản phẩm hot
    this.statHot = this.products.filter(p => this.getDisplayStatus(p) === 'hot').length;
  }

  onFilter() {
    this.currentPage = 1;
    this.renderProducts();
  }

 renderProducts() {
    let filtered = this.products.filter(p => {
      // 1. Lọc theo tên sản phẩm
      const matchName = p.name ? p.name.toLowerCase().includes(this.searchName.toLowerCase()) : false;
      
      // 2. Lọc theo danh mục
      const matchCat = !this.filterCategory || p.category === this.filterCategory;

      let matchStatus = true;
      if (this.filterStatus) {
        // Lấy đúng trạng thái thực tế của sản phẩm từ hàm chuẩn hóa chung
        const realStatus = this.getDisplayStatus(p);
        matchStatus = (realStatus === this.filterStatus);
      }

      // 4. Lọc theo mức giá
      let matchPrice = true;
      if (this.filterPrice) {
        const [min, max] = this.filterPrice.split('-').map(Number);
        const priceToCompare = p.currentPrice || p.price || 0;
        matchPrice = priceToCompare >= min && priceToCompare <= max;
      }

      return matchName && matchCat && matchStatus && matchPrice;
    });

    this.totalItems = filtered.length;
    this.totalPages = Math.ceil(this.totalItems / this.itemsPerPage) || 1;
    if (this.currentPage > this.totalPages) this.currentPage = this.totalPages;

    this.startIdx = (this.currentPage - 1) * this.itemsPerPage;
    this.pageItems = filtered.slice(this.startIdx, this.startIdx + this.itemsPerPage);
    this.totalPagesArray = Array.from({ length: this.totalPages }, (_, i) => i + 1);
  }

  changePage(page: number) {
    if (page >= 1 && page <= this.totalPages) {
      this.currentPage = page;
      this.renderProducts();
    }
  }

  getSku(p: Product): string {
    const idVal = p.id || 1;
    return "KIT-" + idVal.toString().padStart(3, '0') + "-" + (p.name || 'PROD').substring(0,3).toUpperCase();
  }

  getCategoryName(cat: string): string {
    return this.categoriesMap[cat] || cat;
  }

  getStatusInfo(status: string) {
    return this.statusMap[status] || { text: status, class: "badge-status-normal" };
  }

  formatImagePath(imgPath: string): string {
    if (!imgPath) return 'assets/images/empty-cart.png';
    if (!imgPath.startsWith('http') && !imgPath.startsWith('data:')) {
      return imgPath.replace(/^(\.\.\/)?assets\//, 'assets/');
    }
    return imgPath;
  }

  openAddModal() {
    if (this.isSaving) return;
    this.editData = { id: null, name: '', category: 'HN', currentPrice: 0, stock: 10, image: this.defaultProductImage };
    this.resetProductForm();
  }

  openEditModal(p: Product) {
    if (this.isSaving) return;
    this.editData = { ...p, currentPrice: p.currentPrice ?? p.price ?? p.originalPrice ?? 0 };
    delete this.editData.status;
    delete this.editData.price;
    this.resetProductForm();
    const modalEl = document.getElementById('editProductModal');
    if (modalEl) {
      const modal = new bootstrap.Modal(modalEl);
      modal.show();
    }
  }

  deleteProduct(id: string | number) {
    const product = this.products.find(item => String(item.id || item._id || '') === String(id));
    this.deletingProductId = id;
    this.deletingProductName = product?.name || 'sản phẩm này';
    this.showDeleteConfirm = true;
  }

  closeDeleteConfirm(): void {
    this.showDeleteConfirm = false;
    this.deletingProductId = null;
    this.deletingProductName = '';
  }

  confirmDeleteProduct(): void {
    const id = this.deletingProductId;
    if (id === null) return;

    this.adminApi.deleteProduct(id).subscribe({
      next: () => {
        this.closeDeleteConfirm();
        this.adminApi.loadProducts();
      },
      error: (err) => console.error('Lỗi khi xóa sản phẩm:', err)
    });
  }

  private resetProductForm(): void {
    this.selectedFile = null;
    this.imagePreview = null;
    this.uploadedImage = null;
    this.isReadingImage = false;
    this.saveError = '';
    this.imageError = '';
    this.saveSuccess = '';
    this.createSlug = '';
    this.createProductId = '';
    const input = document.getElementById('edit-image-file') as HTMLInputElement | null;
    if (input) input.value = '';
  }

  async onSaveEdit(event: Event): Promise<void> {
    event.preventDefault();
    if (this.isSaving || this.isReadingImage) return;
    this.saveError = '';
    this.saveSuccess = '';
    const targetId = this.editData.id || this.editData._id;
    const name = String(this.editData.name ?? '').trim();
    const price = this.editData.currentPrice;
    const stock = this.editData.stock;
    if (!name || !Object.prototype.hasOwnProperty.call(this.categoriesMap, this.editData.category)) {
      this.saveError = 'Vui lòng nhập tên và chọn danh mục hợp lệ.';
      return;
    }
    if (typeof price !== 'number' || !Number.isFinite(price) || price < 0 ||
        typeof stock !== 'number' || !Number.isSafeInteger(stock) || stock < 0) {
      this.saveError = 'Giá bán phải là số không âm; tồn kho phải là số nguyên không âm.';
      return;
    }
    if (this.imageError) {
      this.saveError = this.imageError;
      return;
    }

    this.isSaving = true;
    let stage = 'upload';
    try {
      let image = this.uploadedImage || this.editData.image || this.defaultProductImage;
      if (this.selectedFile && !this.uploadedImage) {
        this.uploadedImage = await firstValueFrom(this.adminApi.uploadProductImage(this.selectedFile));
        image = this.uploadedImage;
      }
      if (String(image).startsWith('data:')) {
        throw new Error('Vui lòng chọn lại ảnh để tải lên trước khi lưu sản phẩm.');
      }
      stage = 'save';
      const payload: any = { name, category: this.editData.category, currentPrice: price, stock, image };
      if (!targetId) {
        if (!this.createProductId) {
          // Keep the existing numeric SKU format. The backend unique index is
          // authoritative; never replace this ID when retrying an uncertain POST.
          const random = new Uint32Array(1);
          do {
            globalThis.crypto.getRandomValues(random);
          } while (random[0] < 1_000_000_000 || this.products.some(product => String(product.id) === String(random[0])));
          this.createProductId = String(random[0]);
        }
        payload.id = this.createProductId;
        if (!this.createSlug) {
          const base = name.normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[đĐ]/g, 'd')
            .toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'san-pham';
          const suffix = Array.from(globalThis.crypto.getRandomValues(new Uint8Array(16)), value => value.toString(16).padStart(2, '0')).join('');
          this.createSlug = `${base}-${suffix}`;
        }
        payload.slug = this.createSlug;
        payload.originalPrice = price;
      }
      await firstValueFrom(targetId
        ? this.adminApi.updateProduct(targetId, payload)
        : this.adminApi.addProduct(payload));
      this.saveSuccess = targetId ? 'Đã cập nhật sản phẩm.' : 'Đã thêm sản phẩm thành công.';
      const modalEl = document.getElementById('editProductModal');
      if (modalEl) bootstrap.Modal.getInstance(modalEl)?.hide();
    } catch (error: any) {
      const detail = error?.error?.message || error?.message;
      this.saveError = error?.status === 409
        ? 'Mã hoặc slug sản phẩm đã tồn tại. Chưa tạo thêm bản ghi; vui lòng tải lại danh sách để kiểm tra.'
        : `${stage === 'upload' ? 'Không thể tải ảnh lên' : 'Không thể lưu sản phẩm'}${detail ? ': ' + detail : '. Vui lòng thử lại.'}`;
    } finally {
      this.isSaving = false;
      this.changeDetector.markForCheck();
    }
  }

  openProductImport(): void {
    const modal = document.getElementById('productImportModal');
    if (modal) bootstrap.Modal.getOrCreateInstance(modal).show();
  }

  selectProductImport(event: Event): void {
    const input = event.target as HTMLInputElement;
    this.importFile = input.files?.[0] ?? null;
    input.value = '';
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

  async checkProductImport(): Promise<void> {
    if (!this.importFile || this.importChecking || this.importing || this.importFinished) return;
    this.importChecking = true;
    this.importRows = [];
    this.importError = '';
    this.importSheet = '';
    try {
      const rows = await this.readProductImport(this.importFile);
      const header = rows.shift();
      const headers = this.productHeaders(header?.cells ?? []);
      const data = rows.filter(row => row.cells.some(cell => cell != null && String(cell).trim()));
      if (!data.length) throw new Error('File không có dòng dữ liệu.');
      const parsed = data.map(row => this.validateProductRow(row, headers));
      for (const field of ['id', 'slug'] as const) {
        const counts = new Map<string, number>();
        for (const row of parsed) {
          const key = row.product[field];
          if (key) counts.set(key, (counts.get(key) ?? 0) + 1);
        }
        for (const row of parsed) {
          if ((counts.get(row.product[field]) ?? 0) > 1) {
            row.errors.push(field + ' bị trùng trong file.');
            row.status = 'invalid';
          }
        }
      }
      this.importRows = parsed;
    } catch (error) {
      this.importError = error instanceof Error ? error.message : 'Không thể đọc file.';
    } finally {
      this.importChecking = false;
      this.changeDetector.markForCheck();
    }
  }

  private productHeaders(cells: unknown[]): string[] {
    const headers = cells.map(cell => typeof cell === 'string' ? cell.trim() : '');
    const missing = ['name', 'category', 'stock'].filter(field => !headers.includes(field));
    if (missing.length) throw new Error('Thiếu cột: ' + missing.join(', ') + '.');
    if (headers.includes('') || new Set(headers).size !== headers.length) {
      throw new Error('Có tên cột trùng hoặc không hợp lệ.');
    }
    return headers;
  }

  private async readProductImport(file: File): Promise<ProductTableRow[]> {
    const format = file.name.match(/\.([^.]+)$/)?.[1].toLowerCase();
    if (format !== 'csv' && format !== 'xlsx' && format !== 'xls') throw new Error('Chỉ hỗ trợ CSV, XLSX và XLS.');
    if (!file.size) throw new Error('File rỗng.');
    if (file.size > 5 * 1024 * 1024) throw new Error('File vượt quá 5 MB.');
    const buffer = await file.arrayBuffer();
    if (format === 'csv') {
      let text: string;
      try {
        text = new TextDecoder('utf-8', { fatal: true }).decode(buffer);
      } catch {
        throw new Error('File CSV phải dùng mã hóa UTF-8.');
      }
      if (text.includes('\0')) throw new Error('Nội dung CSV không hợp lệ.');
      return this.readProductCsv(text);
    }
    const bytes = new Uint8Array(buffer);
    const zip = [0x50, 0x4b, 3, 4].every((byte, i) => bytes[i] === byte);
    const ole = [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1].every((byte, i) => bytes[i] === byte);
    if (format === 'xlsx' ? !zip : !(ole || (bytes[0] === 9 && [0, 2, 4, 8].includes(bytes[1])))) {
      throw new Error('Nội dung file không khớp định dạng Excel.');
    }
    const { read, utils } = await import('xlsx');
    const book = read(bytes, { type: 'array', cellHTML: false, sheetStubs: true, bookFiles: zip });
    if (zip && !('keys' in book && Array.isArray(book.keys) && book.keys.includes('xl/workbook.xml'))) {
      throw new Error('Nội dung file không phải workbook XLSX.');
    }
    let sheetError = 'Không tìm thấy worksheet phù hợp.';
    for (const name of book.SheetNames) {
      const sheet = book.Sheets[name];
      if (!sheet?.['!ref'] || sheet['!type']) continue;
      const range = utils.decode_range(sheet['!ref']);
      const readRow = (r: number): ProductTableRow => {
        const cells: unknown[] = [];
        for (let c = range.s.c; c <= range.e.c; c++) {
          const cell = sheet[utils.encode_cell({ r, c })];
          cells.push(cell?.t === 'e' || ((cell?.f || cell?.F) && cell.v == null)
            ? Symbol('invalidExcelCell') : cell?.v);
        }
        return { line: r + 1, cells };
      };
      const header = readRow(range.s.r);
      try {
        this.productHeaders(header.cells);
      } catch (error) {
        if (error instanceof Error) sheetError = error.message;
        continue;
      }
      if (range.e.r - range.s.r > 5000) throw new Error('Worksheet vượt quá 5.000 hàng dữ liệu.');
      const data: ProductTableRow[] = [];
      for (let r = range.s.r + 1; r <= range.e.r; r++) {
        const row = readRow(r);
        if (row.cells.some(cell => cell != null && String(cell).trim())) data.push(row);
      }
      if (!data.length) continue;
      this.importSheet = name;
      return [header, ...data];
    }
    throw new Error(sheetError);
  }

  private validateProductRow(row: ProductTableRow, headers: string[]): ProductImportRow {
    const errors: string[] = [];
    const warnings: string[] = [];
    const cell = (field: string) => row.cells[headers.indexOf(field)];
    const blank = (value: unknown) => value == null || (typeof value === 'string' && !value.trim());
    if (row.cells.length > headers.length) errors.push('Dòng có cột thừa.');
    const text = (field: string, fallback = ''): string => {
      const value = cell(field);
      if (blank(value)) return fallback;
      if (typeof value === 'string') return value;
      if (field === 'id' && typeof value === 'number' && Number.isSafeInteger(value) && value >= 0) return String(value);
      errors.push(field + ' phải là văn bản.');
      return fallback;
    };
    const number = (field: string, value: unknown, fallback = 0, integer = false, max = Infinity) => {
      const parsed = typeof value === 'number' ? value
        : typeof value === 'string' && /^\+?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?$/i.test(value.trim())
          ? Number(value) : NaN;
      if (Number.isFinite(parsed) && parsed >= 0 && parsed <= max && (!integer || Number.isSafeInteger(parsed))) return parsed;
      errors.push(field + ' phải là ' + (integer ? 'số nguyên' : 'số') + ' không âm' + (max < Infinity ? ', tối đa ' + max : '') + '.');
      return fallback;
    };
    const numberField = (field: string, fallback = 0, integer = false, max = Infinity) =>
      blank(cell(field)) ? fallback : number(field, cell(field), fallback, integer, max);
    const json = (field: string): unknown => {
      try {
        const value = cell(field);
        if (typeof value === 'string') return JSON.parse(value);
      } catch {
        // Report the field below.
      }
      errors.push(field + ' chứa JSON không hợp lệ.');
      return undefined;
    };

    const name = text('name').trim();
    if (!name) errors.push('Thiếu name.');
    const category = text('category', 'TP').trim();
    if (!Object.hasOwn(this.categoriesMap, category)) errors.push('category không hợp lệ.');
    const image = text('image', 'assets/images/banner-home.webp');
    if (!this.validImportImage(image)) errors.push('image có URL hoặc đường dẫn không hợp lệ.');
    const product: ProductImportPayload = {
      id: text('id').trim() || Math.floor(100000000 + Math.random() * 900000000).toString(),
      name,
      slug: text('slug').trim() || name.toLowerCase().replace(/ /g, '-').replace(/[^\w-]+/g, ''),
      category, image,
      originalPrice: numberField('originalPrice'),
      currentPrice: blank(cell('currentPrice')) ? numberField('price') : numberField('currentPrice'),
      stock: numberField('stock', 10, true),
      description: text('description')
    };
    if (name && !product.slug) errors.push('Không thể tạo slug từ tên. Vui lòng cung cấp slug.');

    const sale = cell('isSale');
    if (!blank(sale)) {
      const value = typeof sale === 'string' ? sale.trim().toLowerCase() : sale;
      if (value === true || value === 'true') product.isSale = true;
      else if (value === false || value === 'false') product.isSale = false;
      else errors.push('isSale phải là TRUE hoặc FALSE.');
    }
    if (!blank(cell('rating'))) product.rating = numberField('rating', 0, false, 5);
    if (!blank(cell('reviewCount'))) product.reviewCount = numberField('reviewCount', 0, true);
    if (!blank(cell('specifications'))) {
      const specs = json('specifications');
      if (specs && typeof specs === 'object' && !Array.isArray(specs)
          && Object.values(specs).every(value => typeof value === 'string')) {
        product.specifications = specs as Record<string, string>;
      } else if (specs !== undefined) {
        errors.push('specifications phải là JSON object có giá trị chuỗi.');
      }
    }
    if (!blank(cell('variants'))) {
      const variants = json('variants');
      if (Array.isArray(variants)) {
        const names = new Set<string>();
        product.variants = variants.flatMap((value: unknown, index) => {
          const label = 'Biến thể ' + (index + 1);
          if (!value || typeof value !== 'object' || Array.isArray(value)) {
            errors.push(label + ' phải là object.');
            return [];
          }
          const variant = value as Record<string, unknown>;
          const name = typeof variant['name'] === 'string' ? variant['name'].trim() : '';
          if (!name) errors.push(label + ' thiếu name.');
          const key = name.normalize('NFC').toLocaleLowerCase('vi-VN');
          if (key && names.has(key)) errors.push(label + ' trùng tên.');
          if (key) names.add(key);
          const result: ImportedVariant = {
            name,
            price: number(label + ' · price', variant['price']),
            stock: number(label + ' · stock', variant['stock'], 0, true)
          };
          const image = variant['image'];
          if (!blank(image)) {
            if (typeof image === 'string' && this.validImportImage(image)) result.image = image;
            else errors.push(label + ' có URL hoặc đường dẫn ảnh không hợp lệ.');
          }
          return [result];
        });
        const total = product.variants.reduce((sum, variant) => sum + BigInt(variant.stock), 0n);
        if (product.variants.length && !errors.length && total !== BigInt(product.stock)) {
          warnings.push('Tổng tồn kho biến thể (' + total + ') khác tồn kho sản phẩm (' + product.stock + ').');
        }
      } else if (variants !== undefined) {
        errors.push('variants phải là JSON array.');
      }
    }
    return { line: row.line, product, errors, warnings, status: errors.length ? 'invalid' : 'ready' };
  }

  private validImportImage(path: string): boolean {
    if (/[\s\\\u0000-\u001f\u007f]/.test(path) || /%(?![\da-f]{2})/i.test(path)) return false;
    if (/^https?:\/\//.test(path)) {
      try {
        const url = new URL(path);
        return !!url.hostname && !url.username && !url.password;
      } catch {
        return false;
      }
    }
    const relative = path.replace(/^\/|^\.\.\//, '');
    if (!/^(?:images|assets)\//.test(relative) || /[:?#]/.test(relative)) return false;
    try {
      return relative.split('/').every(segment => {
        const decoded = decodeURIComponent(segment);
        return !!decoded && decoded !== '.' && decoded !== '..' && !/[\/\\\u0000-\u001f]/.test(decoded);
      });
    } catch {
      return false;
    }
  }

  async confirmProductImport(): Promise<void> {
    if (this.importing || this.importChecking || this.importFinished) return;
    const pending = this.importRows.filter(row => row.status === 'ready');
    if (!pending.length) return;
    this.importing = true;
    this.importTotal = pending.length;
    this.importProcessed = 0;
    try {
      for (const row of pending) {
        let stop = false;
        try {
          const saved = await firstValueFrom(this.adminApi.addProduct(row.product).pipe(timeout(20000)));
          if (saved?._id && saved.id === row.product.id && saved.slug === row.product.slug) {
            row.status = 'saved';
          } else {
            row.status = 'unknown';
            row.errors.push('Phản hồi không xác nhận đúng bản ghi. Hãy tra cứu mã trước khi nhập lại.');
          }
        } catch (error: any) {
          const status = error?.status;
          row.status = !status || status >= 500 ? 'unknown' : 'failed';
          row.errors.push(status === 409 ? 'Mã hoặc slug đã tồn tại.'
            : row.status === 'unknown' ? 'Chưa xác nhận được kết quả. Hãy tra cứu mã trước khi thử lại.'
            : error?.error?.message || 'Máy chủ từ chối lưu (HTTP ' + status + ').');
          stop = status === 401 || status === 403;
          if (stop) this.importError = 'Đã dừng nhập do phiên đăng nhập hoặc quyền truy cập không hợp lệ.';
        }
        this.importProcessed++;
        this.changeDetector.markForCheck();
        if (stop) break;
      }
    } finally {
      this.importFinished = true;
      this.importing = false;
      this.changeDetector.markForCheck();
    }
  }

  private readProductCsv(text: string): ProductTableRow[] {
    const rows: ProductTableRow[] = [];
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


  // Hàm chạy khi người dùng chọn file ảnh từ máy tính
  onFileSelected(event: any) {
    if (this.isSaving) return;
    const file = event.target.files[0];
    this.selectedFile = null;
    this.imagePreview = null;
    this.uploadedImage = null;
    this.imageError = '';
    this.isReadingImage = false;
    if (file) {
      if (!['image/png', 'image/jpeg', 'image/jpg', 'image/webp', 'image/gif'].includes(file.type) ||
          file.size === 0 || file.size > 8 * 1024 * 1024) {
        this.imageError = 'Chỉ nhận PNG, JPG, WEBP, GIF có dung lượng lớn hơn 0 và tối đa 8 MB.';
        event.target.value = '';
        return;
      }
      this.selectedFile = file;
      this.isReadingImage = true;
      const reader = new FileReader();
      reader.onload = () => {
        if (this.selectedFile !== file) return;
        this.imagePreview = reader.result as string;
        this.isReadingImage = false;
        this.changeDetector.markForCheck();
      };
      reader.onerror = () => {
        if (this.selectedFile !== file) return;
        this.isReadingImage = false;
        this.imageError = 'Không thể đọc ảnh đã chọn. Vui lòng chọn lại.';
        this.changeDetector.markForCheck();
      };
      reader.readAsDataURL(file);
    }
  }


  getDisplayStatus(p: Product): string {
    const prod = p as any;
    const stock = Number(prod.stock ?? 0);

    // 1. Hết hàng ưu tiên số 1
    if (stock === 0) return 'het-hang';

    // 2. Sắp hết hàng (< 15 đúng như yêu cầu của bạn)
    if (stock > 0 && stock < 15) return 'sap-het';

    // 4. Hàng Mới (Trong vòng 7 ngày)
    if (prod.createdAt) {
      const createdDate = new Date(prod.createdAt).getTime();
      const daysDiff = (Date.now() - createdDate) / (1000 * 60 * 60 * 24);
      if (daysDiff >= 0 && daysDiff <= 7) return 'new';
    }

    // 5. Còn lại là Bình thường
    return 'normal';
  }
}

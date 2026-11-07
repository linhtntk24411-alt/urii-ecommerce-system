import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { AdminApiService } from '../../core/services/admin-api.service';
import { Product } from '../../../../../my-user/src/app/models/uri.model';

declare var bootstrap: any;

@Component({
  selector: 'app-products-admin',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterLink],
  templateUrl: './products-admin.html',
  styleUrls: ['./products-admin.css']
})
export class ProductsAdmin implements OnInit {
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

  editData: any = { id: null, name: '', category: 'HN', status: 'normal', price: 0, stock: 0, image: '' };

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
    this.editData = { id: null, name: '', category: 'hat-nhua', status: 'normal', price: 0, stock: 10, image: 'assets/images/banner-home.webp' };
    this.selectedFile = null;
    this.imagePreview = null;
  }

  openEditModal(p: Product) {
    this.editData = { ...p };
    this.selectedFile = null;
    this.imagePreview = null;
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

  onSaveEdit(event: Event) {
    event.preventDefault();
    const targetId = this.editData.id || this.editData._id;
    // --- THÊM ĐOẠN NÀY ĐỂ NHẬN ẢNH MỚI CHỌN ---
    if (this.imagePreview) {
      this.editData.image = this.imagePreview;
    }
    // ------------------------------------------

    if (targetId) {
      this.adminApi.updateProduct(targetId, this.editData).subscribe({
        next: () => {
          this.adminApi.loadProducts();
          const modalEl = document.getElementById('editProductModal');
          if (modalEl) {
            const modalInstance = bootstrap.Modal.getInstance(modalEl);
            if (modalInstance) modalInstance.hide();
          }
        },
        error: (err) => console.error('Lỗi khi cập nhật sản phẩm:', err)
      });
    }
  }
  // Hàm xử lý khi người dùng chọn file
  onFileImport(event: any): void {
    const file = event.target.files[0];
    if (!file) return;

    const fileName = file.name.toLowerCase();

    // 1. KIỂM TRA ĐỊNH DẠNG FILE (Chỉ nhận .csv)
    if (!fileName.endsWith('.csv')) {
      alert('❌ Lỗi định dạng! Vui lòng chọn file có định dạng .csv (Bạn có thể chuyển file Excel .xlsx sang .csv trước khi tải lên).');
      event.target.value = '';
      return;
    }

    // Đọc nội dung file CSV
    const reader = new FileReader();
    reader.onload = (e: any) => {
      const text = e.target.result;
      this.parseCSVAndImport(text);
      event.target.value = ''; // Reset input để có thể chọn lại file cũ nếu cần
    };
    reader.readAsText(file, 'UTF-8');
  }

  // Hàm phân tích và kiểm tra tính hợp lệ của các cột dữ liệu
  parseCSVAndImport(csvText: string): void {
    const lines = csvText.split('\n').map(l => l.trim()).filter(l => l.length > 0);
    
    if (lines.length < 2) {
      alert('❌ Lỗi: File CSV trống hoặc không có dữ liệu sản phẩm!');
      return;
    }

    // 2. KIỂM TRA TÊN CÁC CỘT DỮ LIỆU (HEADER)
    // Đọc dòng đầu tiên và tách tên các cột
    const headers = lines[0].split(',').map(h => h.trim().replace(/^"|"$/g, ''));
    
    // Đặt các cột bắt buộc phải có trong file để hệ thống nhận diện đúng
    const requiredColumns = ['name', 'category', 'stock']; 
    const missingColumns = requiredColumns.filter(col => !headers.includes(col));

    if (missingColumns.length > 0) {
      alert(`❌ Lỗi tên cột dữ liệu!\nFile của bạn đang thiếu các cột bắt buộc sau: [ ${missingColumns.join(', ')} ]\nHãy đảm bảo tên các cột trùng khớp với dữ liệu hiện tại (Ví dụ: name, category, stock, currentPrice, image...).`);
      return;
    }

    let successCount = 0;

    // Duyệt qua từng dòng dữ liệu sản phẩm bên dưới
    for (let i = 1; i < lines.length; i++) {
      const line = lines[i];
      if (!line) continue;

      const values = line.split(',').map(v => v.trim().replace(/^"|"$/g, ''));
      const productObj: any = {};
      
      headers.forEach((header, index) => {
        productObj[header] = values[index] !== undefined ? values[index] : '';
      });

      // Kiểm tra nếu có tên sản phẩm thì tiến hành thêm vào hệ thống
      if (productObj.name) {
        // Sinh ID tự động duy nhất cho mỗi sản phẩm khác nhau
        const generatedId = Math.floor(100000000 + Math.random() * 900000000).toString();
        
        const newProduct = {
          id: productObj.id || generatedId,
          name: productObj.name,
          slug: productObj.slug || productObj.name.toLowerCase().replace(/ /g, '-').replace(/[^\w-]+/g, ''),
          category: productObj.category || 'TP',
          image: productObj.image || 'assets/images/banner-home.webp',
          originalPrice: Number(productObj.originalPrice) || 0,
          currentPrice: Number(productObj.currentPrice) || Number(productObj.price) || 0,
          stock: Number(productObj.stock) || 10,
          description: productObj.description || '',
          createdAt: new Date().toISOString()
        };

        // Gửi API thêm sản phẩm
        this.adminApi.addProduct(newProduct).subscribe({
          next: () => {
            successCount++;
            if (i === lines.length - 1 || successCount === lines.length - 1) {
              this.adminApi.loadProducts();
              alert(`✅ Nhập thành công ${successCount} sản phẩm từ file vào hệ thống!`);
            }
          },
          error: (err) => console.error('Lỗi khi thêm sản phẩm từ file:', err)
        });
      }
    }
  }
  // Hàm chạy khi người dùng chọn file ảnh từ máy tính
  onFileSelected(event: any) {
    const file = event.target.files[0];
    if (file) {
      this.selectedFile = file;
      
      const reader = new FileReader();
      reader.onload = () => {
        this.imagePreview = reader.result as string;
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
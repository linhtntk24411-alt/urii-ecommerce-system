import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
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
export class ProductsAdminComponent implements OnInit {
  products: Product[] = [];
  currentPage = 1;
  itemsPerPage = 4;

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

  editData: any = { id: null, name: '', category: 'hat-nhua', status: 'normal', price: 0, stock: 0, image: '' };

  categoriesMap: { [key: string]: string } = { 
    "hat-nhua": "Hạt nhựa", "dung-cu": "Dụng cụ", "handmade": "Handmade", "kit": "Bộ Kit"
  };

  statusMap: { [key: string]: { text: string, class: string } } = { 
    "normal": { text: "Bình thường", class: "badge-status-normal" },
    "sap-het": { text: "Sắp hết hàng", class: "badge-status-sap-het" },
    "het-hang": { text: "Hết hàng", class: "badge-status-het-hang" },
    "new": { text: "Mới", class: "badge-status-new" },
    "hot": { text: "Bán chạy", class: "badge-status-hot" }
  };

  constructor(private adminApi: AdminApiService) {}

  ngOnInit() {
    this.adminApi.products$.subscribe(data => {
      this.products = data;
      this.updateStats();
      this.renderProducts();
    });
  }

  updateStats() {
    this.statTotal = this.products.length;
    this.statWarning = this.products.filter(p => p.status === 'sap-het').length;
    this.statDanger = this.products.filter(p => p.status === 'het-hang').length;
    this.statNew = this.products.filter(p => p.status === 'new').length;
    this.statHot = this.products.filter(p => p.status === 'hot').length;
  }

  onFilter() {
    this.currentPage = 1;
    this.renderProducts();
  }

  renderProducts() {
    let filtered = this.products.filter(p => {
      const matchName = p.name ? p.name.toLowerCase().includes(this.searchName.toLowerCase()) : false;
      const matchCat = !this.filterCategory || p.category === this.filterCategory;
      const matchStatus = !this.filterStatus || p.status === this.filterStatus;
      let matchPrice = true;
      if (this.filterPrice) {
        const [min, max] = this.filterPrice.split('-').map(Number);
        matchPrice = p.price >= min && p.price <= max;
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
  }

  openEditModal(p: Product) {
    this.editData = { ...p };
    const modalEl = document.getElementById('editProductModal');
    if (modalEl) {
      const modal = new bootstrap.Modal(modalEl);
      modal.show();
    }
  }

  deleteProduct(id: string | number) {
    if (confirm('Bạn có chắc muốn xóa sản phẩm này?')) {
      this.adminApi.deleteProduct(id).subscribe({
        next: () => {
          this.adminApi.loadProducts();
        },
        error: (err) => console.error('Lỗi khi xóa sản phẩm:', err)
      });
    }
  }

  onSaveEdit(event: Event) {
    event.preventDefault();
    const targetId = this.editData.id || this.editData._id;

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
}
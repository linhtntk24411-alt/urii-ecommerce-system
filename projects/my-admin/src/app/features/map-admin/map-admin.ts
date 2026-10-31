import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';

declare var bootstrap: any;

@Component({
  selector: 'app-map-admin',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './map-admin.html',
  styleUrls: ['./map-admin.css']
})
export class MapAdmin implements OnInit {
  Math = Math;
  maps: any[] = [];
  currentPage = 1;
  ITEMS_PER_PAGE = 4;
  editingId: string | null = null;

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
    this.loadMaps();
  }

  async loadMaps() {
    if (typeof window !== 'undefined' && typeof localStorage !== 'undefined') {
      const localData = localStorage.getItem('library_maps');
      if (localData) {
        try {
          this.maps = JSON.parse(localData);
          if (Array.isArray(this.maps) && this.maps.length > 0) return;
        } catch (e) {
          console.error(e);
        }
      }
    }

    try {
      const response = await fetch('../../user/data/gallery.json');
      if (!response.ok) throw new Error(`Không thể tải file gallery.json`);
      this.maps = await response.json();
      if (typeof window !== 'undefined' && typeof localStorage !== 'undefined') {
        localStorage.setItem('library_maps', JSON.stringify(this.maps));
      }
    } catch (error) {
      console.error("❌ LỖI TẢI DỮ LIỆU:", error);
      this.maps = [];
    }
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

  getImagePath(path: string): string {
    if (!path) return '';
    if (path.startsWith('http') || path.startsWith('data:')) return path;
    return '../../user/' + path;
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
    if (confirm("Bạn có chắc muốn xóa mẫu này?")) {
      this.maps = this.maps.filter(m => m.map_id !== id);
      if (typeof window !== 'undefined' && typeof localStorage !== 'undefined') {
        localStorage.setItem('library_maps', JSON.stringify(this.maps));
      }
    }
  }
}
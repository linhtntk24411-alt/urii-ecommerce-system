import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterLink } from '@angular/router';

interface SampleMap {
  map_id: string;
  map_name: string;
  main_image: string;
  categories: string[];
  difficulty: string;
  difficultyClass: string;
  grid_size: string;
  total_beads: number;
  time: string;
  isPopular?: boolean;
  isNew?: boolean;
}

@Component({
  selector: 'app-sample-maps',
  standalone: true,
  imports: [CommonModule, RouterLink],
  templateUrl: './sample-maps.html',
  styleUrls: ['./sample-maps.css']
})
export class SampleMapsComponent implements OnInit {
  // Dữ liệu mẫu (Bạn có thể thêm bớt tùy ý)
  allMaps: SampleMap[] = [
    { map_id: '1', map_name: 'Map mẫu: Bạch tuộc tím cute', main_image: 'assets/gallery_assets/mau-bach-tuoc.webp', categories: ['Con vật'], difficulty: 'Dễ', difficultyClass: 'badge-easy', grid_size: '32 x 32 ô', total_beads: 242, time: '15-20 phút', isPopular: true },
    { map_id: '2', map_name: 'Map mẫu: Bướm đêm dạ quang', main_image: 'assets/gallery_assets/mau-buom.webp', categories: ['Con vật'], difficulty: 'Trung bình', difficultyClass: 'badge-medium', grid_size: '26 x 20 ô', total_beads: 315, time: '35-45 phút' },
    { map_id: '3', map_name: 'Map mẫu: Cá heo xanh tinh nghịch', main_image: 'assets/gallery_assets/mau-ca-heo.webp', categories: ['Con vật'], difficulty: 'Dễ', difficultyClass: 'badge-easy', grid_size: '25 x 22 ô', total_beads: 198, time: '15 phút', isNew: true },
    { map_id: '4', map_name: 'Map mẫu: Cá mập ôm phao', main_image: 'assets/gallery_assets/mau-ca-map-cut-e.webp', categories: ['Con vật'], difficulty: 'Khó', difficultyClass: 'badge-hard', grid_size: '60 x 60 ô', total_beads: 1450, time: '70-85 phút' },
    { map_id: '5', map_name: 'Map mẫu: Cá ngựa đại dương', main_image: 'assets/gallery_assets/mau-ca-ngua.webp', categories: ['Con vật'], difficulty: 'Dễ', difficultyClass: 'badge-easy', grid_size: '32 x 32 ô', total_beads: 218, time: '20 phút' },
    { map_id: '6', map_name: 'Map mẫu: Cáo lửa rực rỡ', main_image: 'assets/gallery_assets/mau-cao.webp', categories: ['Con vật'], difficulty: 'Dễ', difficultyClass: 'badge-easy', grid_size: '32 x 32 ô', total_beads: 286, time: '20-25 phút' },
  ];

  filteredMaps: SampleMap[] = [];
  paginatedMaps: SampleMap[] = [];

  // Mảng danh mục (Đã fix lỗi bấm vào Con vật bị mất)
  categories = [
    { name: 'Tất cả mẫu', count: 0 },
    { name: 'Con vật', count: 0 },
    { name: 'Hoạt hình', count: 0 },
    { name: 'Logo', count: 0 },
    { name: 'Trang trí', count: 0 },
    { name: 'Trái cây', count: 0 }
  ];
  
  selectedCategory: string = 'Tất cả mẫu';
  selectedDifficulties: string[] = [];
  currentSort: string = 'default';

  currentPage: number = 1;
  itemsPerPage: number = 6; // Đổi thành 6 để hiển thị đẹp 2 hàng 3 cột
  totalPages: number = 1;

  ngOnInit() {
    this.updateCategoryCounts();
    this.applyFilters();
  }

  updateCategoryCounts() {
    this.categories.forEach(cat => {
      if (cat.name === 'Tất cả mẫu') {
        cat.count = this.allMaps.length;
      } else {
        cat.count = this.allMaps.filter(m => m.categories.includes(cat.name)).length;
      }
    });
  }

  selectCategory(categoryName: string) {
    this.selectedCategory = categoryName;
    this.currentPage = 1;
    this.applyFilters();
  }

  onDifficultyChange(difficulty: string, event: any) {
    if (event.target.checked) {
      this.selectedDifficulties.push(difficulty);
    } else {
      this.selectedDifficulties = this.selectedDifficulties.filter(d => d !== difficulty);
    }
    this.currentPage = 1;
    this.applyFilters();
  }

  onSortChange(event: any) {
    this.currentSort = event.target.value;
    this.applyFilters();
  }

  applyFilters() {
    this.filteredMaps = this.allMaps.filter(map => {
      const matchCategory = this.selectedCategory === 'Tất cả mẫu' || map.categories.includes(this.selectedCategory);
      const matchDifficulty = this.selectedDifficulties.length === 0 || this.selectedDifficulties.includes(map.difficulty);
      return matchCategory && matchDifficulty;
    });

    if (this.currentSort === 'name-az') {
      this.filteredMaps.sort((a, b) => a.map_name.localeCompare(b.map_name, 'vi'));
    } else if (this.currentSort === 'beads-asc') {
      this.filteredMaps.sort((a, b) => a.total_beads - b.total_beads);
    }

    this.updatePagination();
  }

  updatePagination() {
    this.totalPages = Math.ceil(this.filteredMaps.length / this.itemsPerPage);
    if (this.currentPage > this.totalPages) {
      this.currentPage = 1;
    }
    const startIndex = (this.currentPage - 1) * this.itemsPerPage;
    this.paginatedMaps = this.filteredMaps.slice(startIndex, startIndex + this.itemsPerPage);
  }

  changePage(page: number) {
    if (page >= 1 && page <= this.totalPages) {
      this.currentPage = page;
      this.updatePagination();
      window.scrollTo({ top: 0, behavior: 'smooth' });
    }
  }

  saveMap(map: SampleMap) {
    let savedMaps = JSON.parse(localStorage.getItem('savedMaps') || '[]');
    const isExist = savedMaps.some((item: any) => item.id === map.map_id);

    if (!isExist) {
      savedMaps.push({
        id: map.map_id,
        title: map.map_name,
        author: "Urii Thiết kế",
        image: map.main_image,
        rating: 5.0,
        liked: true
      });
      localStorage.setItem('savedMaps', JSON.stringify(savedMaps));
      alert(`Đã lưu "${map.map_name}" vào danh sách của bạn!`);
    } else {
      alert(`Mẫu "${map.map_name}" đã tồn tại trong danh sách lưu.`);
    }
  }
}
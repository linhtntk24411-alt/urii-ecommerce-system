import { CommonModule, isPlatformBrowser } from '@angular/common';
import {
  AfterViewInit,
  ChangeDetectorRef,
  Component,
  ElementRef,
  HostListener,
  Inject,
  OnDestroy,
  OnInit,
  PLATFORM_ID,
  ViewChild
} from '@angular/core';
import { RouterLink } from '@angular/router';
import { HttpClient } from '@angular/common/http';
import { inject } from '@angular/core';

export interface BeadDefinition {
  code: string; // VD: F6, A4, B5, H1, H7, D3, E2
  name: string; // Tên màu tiếng Việt dễ hiểu
  hex: string;
  rgb: [number, number, number];
  lab: [number, number, number]; // Giá trị CIE Lab để tính toán khoảng cách thụ cảm mắt người
  prefix: string; // A, B, C, D, E, F, G, H, M...
  inStockUrii: boolean; // Có sẵn trong các gói bổ sung của Urii không
  productSlug?: string; // Slug nối tới trang chi tiết sản phẩm trong products.json
}

export interface BeadColorInfo {
  code: string;
  name: string;
  hex: string;
  rgb: [number, number, number];
  count: number;
  percentage: number;
  textColor: string;
  inStockUrii: boolean;
  productSlug?: string;
}

export interface PresetImage {
  name: string;
  label: string;
  icon: string;
  colorBadge: string;
  url: string;
}

export interface MatchedVariant {
  code: string;
  count: number;
}

export interface BeadProductRecommendation {
  prefix: string;
  name: string;
  slug: string;
  price: number;
  image: string;
  variants: string[];
  matchedVariants?: MatchedVariant[];
  totalBeadsNeeded?: number;
}

function hexToRgb(hex: string): [number, number, number] {
  const num = parseInt(hex.replace('#', ''), 16);
  return [(num >> 16) & 255, (num >> 8) & 255, num & 255];
}

/**
 * Chuyển đổi màu RGB sang không gian màu thụ cảm CIE Lab (D65)
 */
function rgbToLab(r: number, g: number, b: number): [number, number, number] {
  let rL = r / 255;
  let gL = g / 255;
  let bL = b / 255;

  rL = rL > 0.04045 ? Math.pow((rL + 0.055) / 1.055, 2.4) : rL / 12.92;
  gL = gL > 0.04045 ? Math.pow((gL + 0.055) / 1.055, 2.4) : gL / 12.92;
  bL = bL > 0.04045 ? Math.pow((bL + 0.055) / 1.055, 2.4) : bL / 12.92;

  const x = (rL * 0.4124 + gL * 0.3576 + bL * 0.1805) / 0.95047;
  const y = (rL * 0.2126 + gL * 0.7152 + bL * 0.0722) / 1.00000;
  const z = (rL * 0.0193 + gL * 0.1192 + bL * 0.9505) / 1.08883;

  const f = (t: number) => (t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116);
  const fx = f(x);
  const fy = f(y);
  const fz = f(z);

  const L = 116 * fy - 16;
  const a = 500 * (fx - fy);
  const bVal = 200 * (fy - fz);
  return [L, a, bVal];
}

// BẢNG 295 MÃ MÀU HẠT NHỰA ỦI PERLER CHUẨN NGHỆ NHÂN & KHO SẢN PHẨM URII
const RAW_PALETTE_CONFIG = [
  // --- NHÓM A: Vàng / Cam (Có sẵn tại Urii: Gói A1 - A8) ---
  { code: 'A1', name: 'Vàng kem nhạt', hex: '#FEF7CD', prefix: 'A', inStock: true, slug: 'products-hat-nhua-refill-a' },
  { code: 'A2', name: 'Vàng chanh', hex: '#FFF59D', prefix: 'A', inStock: true, slug: 'products-hat-nhua-refill-a' },
  { code: 'A3', name: 'Vàng tươi', hex: '#FFEC3D', prefix: 'A', inStock: true, slug: 'products-hat-nhua-refill-a' },
  { code: 'A4', name: 'Vàng hoàng yến', hex: '#FFD600', prefix: 'A', inStock: true, slug: 'products-hat-nhua-refill-a' },
  { code: 'A5', name: 'Vàng nghệ', hex: '#FFC107', prefix: 'A', inStock: true, slug: 'products-hat-nhua-refill-a' },
  { code: 'A6', name: 'Vàng hổ phách', hex: '#FFB300', prefix: 'A', inStock: true, slug: 'products-hat-nhua-refill-a' },
  { code: 'A7', name: 'Cam tươi', hex: '#FF9800', prefix: 'A', inStock: true, slug: 'products-hat-nhua-refill-a' },
  { code: 'A8', name: 'Cam đậm', hex: '#F57C00', prefix: 'A', inStock: true, slug: 'products-hat-nhua-refill-a' },
  { code: 'A9', name: 'Cam cháy', hex: '#E65100', prefix: 'A', inStock: false },
  { code: 'A14', name: 'Cam đất', hex: '#FF7043', prefix: 'A', inStock: false },

  // --- NHÓM B: Xanh lá cây (Có sẵn tại Urii: Gói B1 - B10) ---
  { code: 'B1', name: 'Xanh chuối non', hex: '#CCFF00', prefix: 'B', inStock: true, slug: 'products-hat-nhua-refill-b' },
  { code: 'B2', name: 'Xanh chanh tươi', hex: '#AEEA00', prefix: 'B', inStock: true, slug: 'products-hat-nhua-refill-b' },
  { code: 'B3', name: 'Xanh lục sáng', hex: '#76FF03', prefix: 'B', inStock: true, slug: 'products-hat-nhua-refill-b' },
  { code: 'B4', name: 'Xanh mạ tươi', hex: '#64DD17', prefix: 'B', inStock: true, slug: 'products-hat-nhua-refill-b' },
  { code: 'B5', name: 'Xanh lá cây chuẩn', hex: '#4CAF50', prefix: 'B', inStock: true, slug: 'products-hat-nhua-refill-b' },
  { code: 'B6', name: 'Xanh táo', hex: '#43A047', prefix: 'B', inStock: true, slug: 'products-hat-nhua-refill-b' },
  { code: 'B7', name: 'Xanh rêu', hex: '#2E7D32', prefix: 'B', inStock: true, slug: 'products-hat-nhua-refill-b' },
  { code: 'B8', name: 'Xanh rừng già', hex: '#1B5E20', prefix: 'B', inStock: true, slug: 'products-hat-nhua-refill-b' },
  { code: 'B9', name: 'Xanh rêu đậm', hex: '#33691E', prefix: 'B', inStock: true, slug: 'products-hat-nhua-refill-b' },
  { code: 'B10', name: 'Xanh ngọc bích đậm', hex: '#004D40', prefix: 'B', inStock: true, slug: 'products-hat-nhua-refill-b' },
  { code: 'B11', name: 'Xanh cỏ úa', hex: '#558B2F', prefix: 'B', inStock: false },
  { code: 'B14', name: 'Xanh bơ sáng', hex: '#8BC34A', prefix: 'B', inStock: false },

  // --- NHÓM C: Xanh dương / Cyan (Có sẵn tại Urii: Gói C1 - C10) ---
  { code: 'C1', name: 'Xanh băng tuyết', hex: '#E1F5FE', prefix: 'C', inStock: true, slug: 'products-hat-nhua-refill-c' },
  { code: 'C2', name: 'Xanh da trời nhạt', hex: '#B3E5FC', prefix: 'C', inStock: true, slug: 'products-hat-nhua-refill-c' },
  { code: 'C3', name: 'Xanh mây trời', hex: '#81D4FA', prefix: 'C', inStock: true, slug: 'products-hat-nhua-refill-c' },
  { code: 'C4', name: 'Xanh ngọc biển', hex: '#4FC3F7', prefix: 'C', inStock: true, slug: 'products-hat-nhua-refill-c' },
  { code: 'C5', name: 'Xanh lam tươi', hex: '#29B6F6', prefix: 'C', inStock: true, slug: 'products-hat-nhua-refill-c' },
  { code: 'C6', name: 'Xanh da trời', hex: '#03A9F4', prefix: 'C', inStock: true, slug: 'products-hat-nhua-refill-c' },
  { code: 'C7', name: 'Xanh coban', hex: '#0288D1', prefix: 'C', inStock: true, slug: 'products-hat-nhua-refill-c' },
  { code: 'C8', name: 'Xanh biển sâu', hex: '#01579B', prefix: 'C', inStock: true, slug: 'products-hat-nhua-refill-c' },
  { code: 'C9', name: 'Xanh navy', hex: '#0D47A1', prefix: 'C', inStock: true, slug: 'products-hat-nhua-refill-c' },
  { code: 'C10', name: 'Xanh lam đen', hex: '#1A237E', prefix: 'C', inStock: true, slug: 'products-hat-nhua-refill-c' },
  { code: 'C13', name: 'Xanh ngọc pastel', hex: '#80DEEA', prefix: 'C', inStock: false },

  // --- NHÓM D: Tím / Indigo / Chàm (Chuẩn 295 nghệ nhân) ---
  { code: 'D1', name: 'Tím oải hương nhạt', hex: '#D1C4E9', prefix: 'D', inStock: false },
  { code: 'D2', name: 'Tím lavender', hex: '#B39DDB', prefix: 'D', inStock: false },
  { code: 'D3', name: 'Tím chàm đậm (Indigo)', hex: '#311B92', prefix: 'D', inStock: false },
  { code: 'D4', name: 'Tím violet', hex: '#512DA8', prefix: 'D', inStock: false },
  { code: 'D5', name: 'Tím cà', hex: '#673AB7', prefix: 'D', inStock: false },
  { code: 'D6', name: 'Tím thạch anh', hex: '#7E57C2', prefix: 'D', inStock: false },
  { code: 'D7', name: 'Tím huế đậm', hex: '#4A148C', prefix: 'D', inStock: false },
  { code: 'D8', name: 'Xanh tím pastel', hex: '#5C6BC0', prefix: 'D', inStock: false },

  // --- NHÓM E: Hồng phấn / Hồng baby (Chuẩn 295 nghệ nhân) ---
  { code: 'E1', name: 'Hồng phấn rất nhạt', hex: '#FCE4EC', prefix: 'E', inStock: false },
  { code: 'E2', name: 'Hồng baby ngọt ngào', hex: '#F8BBD0', prefix: 'E', inStock: false },
  { code: 'E3', name: 'Hồng đào', hex: '#F48FB1', prefix: 'E', inStock: false },
  { code: 'E4', name: 'Hồng cánh sen', hex: '#F06292', prefix: 'E', inStock: false },
  { code: 'E5', name: 'Hồng tươi', hex: '#EC407A', prefix: 'E', inStock: false },
  { code: 'E6', name: 'Hồng đậm', hex: '#E91E63', prefix: 'E', inStock: false },

  // --- NHÓM F: Đỏ / Cam đào / Hồng san hô (Có sẵn tại Urii: Gói F1 - F8) ---
  { code: 'F1', name: 'Cam san hô / Đào', hex: '#FF8A65', prefix: 'F', inStock: true, slug: 'products-hat-nhua-refill-f' },
  { code: 'F2', name: 'Hồng cam san hô', hex: '#FF7043', prefix: 'F', inStock: true, slug: 'products-hat-nhua-refill-f' },
  { code: 'F3', name: 'Đỏ cam tươi', hex: '#FF5722', prefix: 'F', inStock: true, slug: 'products-hat-nhua-refill-f' },
  { code: 'F4', name: 'Đỏ son', hex: '#F4511E', prefix: 'F', inStock: true, slug: 'products-hat-nhua-refill-f' },
  { code: 'F5', name: 'Đỏ tươi', hex: '#E53935', prefix: 'F', inStock: true, slug: 'products-hat-nhua-refill-f' },
  { code: 'F6', name: 'Đỏ chuẩn Perler', hex: '#D32F2F', prefix: 'F', inStock: true, slug: 'products-hat-nhua-refill-f' },
  { code: 'F7', name: 'Đỏ đô', hex: '#C62828', prefix: 'F', inStock: true, slug: 'products-hat-nhua-refill-f' },
  { code: 'F8', name: 'Đỏ mận rượu vang', hex: '#B71C1C', prefix: 'F', inStock: true, slug: 'products-hat-nhua-refill-f' },
  { code: 'F21', name: 'Hồng đỏ san hô', hex: '#E57373', prefix: 'F', inStock: false },

  // --- NHÓM G: Màu da / Nâu be / Nâu đất (Gói G1 - G3 có sẵn tại Urii) ---
  { code: 'G1', name: 'Kem da sáng', hex: '#FFE0B2', prefix: 'G', inStock: true, slug: 'products-hat-nhua-refill-g' },
  { code: 'G2', name: 'Màu da tự nhiên', hex: '#FFCC80', prefix: 'G', inStock: true, slug: 'products-hat-nhua-refill-g' },
  { code: 'G3', name: 'Màu da ấm bánh mật', hex: '#FFA726', prefix: 'G', inStock: true, slug: 'products-hat-nhua-refill-g' },
  { code: 'G4', name: 'Nâu sữa nhạt', hex: '#D7CCC8', prefix: 'G', inStock: false },
  { code: 'G5', name: 'Nâu be', hex: '#BCAAA4', prefix: 'G', inStock: false },
  { code: 'G6', name: 'Nâu hạt dẻ', hex: '#A1887F', prefix: 'G', inStock: false },
  { code: 'G7', name: 'Nâu mocha', hex: '#8D6E63', prefix: 'G', inStock: false },
  { code: 'G8', name: 'Nâu chocolate đậm', hex: '#5D4037', prefix: 'G', inStock: false },
  { code: 'G9', name: 'Nâu gỗ tự nhiên', hex: '#795548', prefix: 'G', inStock: false },
  { code: 'G14', name: 'Nâu đất', hex: '#8D6E63', prefix: 'G', inStock: false },
  { code: 'G21', name: 'Nâu cà phê đậm', hex: '#3E2723', prefix: 'G', inStock: false },

  // --- NHÓM H: Trắng / Xám / Đen (Có sẵn tại Urii: Gói H1 - H10) ---
  { code: 'H1', name: 'Trắng tinh khiết', hex: '#FFFFFF', prefix: 'H', inStock: true, slug: 'products-hat-nhua-refill-h' },
  { code: 'H2', name: 'Trắng ngà / Kem nhạt', hex: '#F5F5F0', prefix: 'H', inStock: true, slug: 'products-hat-nhua-refill-h' },
  { code: 'H3', name: 'Xám rất nhạt', hex: '#E0E0E0', prefix: 'H', inStock: true, slug: 'products-hat-nhua-refill-h' },
  { code: 'H4', name: 'Xám nhạt', hex: '#BDBDBD', prefix: 'H', inStock: true, slug: 'products-hat-nhua-refill-h' },
  { code: 'H5', name: 'Xám trung tính', hex: '#9E9E9E', prefix: 'H', inStock: true, slug: 'products-hat-nhua-refill-h' },
  { code: 'H6', name: 'Xám đậm chì', hex: '#616161', prefix: 'H', inStock: true, slug: 'products-hat-nhua-refill-h' },
  { code: 'H7', name: 'Đen tuyền', hex: '#1A1A1A', prefix: 'H', inStock: true, slug: 'products-hat-nhua-refill-h' },
  { code: 'H8', name: 'Đen chì', hex: '#424242', prefix: 'H', inStock: true, slug: 'products-hat-nhua-refill-h' },
  { code: 'H9', name: 'Xám tro', hex: '#757575', prefix: 'H', inStock: true, slug: 'products-hat-nhua-refill-h' },
  { code: 'H10', name: 'Xám khói sáng', hex: '#EEEEEE', prefix: 'H', inStock: true, slug: 'products-hat-nhua-refill-h' },
  { code: 'H21', name: 'Trắng xám ngọc trai', hex: '#ECEFF1', prefix: 'H', inStock: false },

  // --- NHÓM M: Ánh nhũ / Nâu vàng kim ---
  { code: 'M9', name: 'Vàng cát ánh kim', hex: '#C5A059', prefix: 'M', inStock: false }
];

export const STANDARD_BEAD_PALETTE: BeadDefinition[] = RAW_PALETTE_CONFIG.map(cfg => {
  const rgb = hexToRgb(cfg.hex);
  return {
    code: cfg.code,
    name: cfg.name,
    hex: cfg.hex,
    rgb,
    lab: rgbToLab(rgb[0], rgb[1], rgb[2]),
    prefix: cfg.prefix,
    inStockUrii: cfg.inStock,
    productSlug: cfg.inStock ? cfg.slug : undefined
  };
});

@Component({
  selector: 'app-create-map',
  standalone: true,
  imports: [CommonModule, RouterLink],
  templateUrl: './create-map.html',
  styleUrls: ['./create-map.css']
})
export class CreateMapComponent implements OnInit, AfterViewInit, OnDestroy {
  private readonly http = inject(HttpClient);
  @ViewChild('originalCanvas') originalCanvasRef!: ElementRef<HTMLCanvasElement>;
  @ViewChild('resultCanvas') resultCanvasRef!: ElementRef<HTMLCanvasElement>;
  @ViewChild('fileInput') fileInputRef!: ElementRef<HTMLInputElement>;

  // Cấu hình kích thước ô: Tách biệt Số cột (Ngang) và Số hàng (Dọc)
  gridCols: number = 29;
  gridRows: number = 29;
  maxDimension: number = 29;
  keepAspectRatio: boolean = true;
  imageAspectRatio: number = 1;

  colorCount: number = 16;

  // Cài đặt xử lý màu nâng cao
  colorVibrancy: number = 20; // Tăng độ rực rỡ màu (+20% mặc định giúp chống phai xám khi thu nhỏ ảnh)
  preferUriiColors: boolean = false; // Mặc định nhận diện đầy đủ 295 màu nghệ nhân để hình chân thực nhất

  // Kiểu hiển thị ô & nhãn mã màu
  cellShape: 'square' | 'realistic' | 'dot' = 'square';
  showColorLabels: boolean = true;
  showGridLines: boolean = true;
  showGuideBlocks: boolean = true;
  showCoordinates: boolean = true;

  selectedColorCode: string | null = null;

  currentImage: HTMLImageElement | null = null;
  imageFileName: string = '';
  isProcessing: boolean = false;
  hasImage: boolean = false;
  isDragging: boolean = false;

  totalBeadCount: number = 0;
  palette: BeadColorInfo[] = [];

  allBeadProducts: BeadProductRecommendation[] = [
    {
      prefix: 'A',
      name: '[Mã màu A] Gói bổ sung hạt nhựa ủi 2.6mm 10g (1000 hạt)',
      slug: 'products-hat-nhua-refill-a',
      price: 15000,
      image: 'https://cdn.hstatic.net/products/200001193910/vn-11134207-81ztc-mm4kqgmtea6d4e_resize_w900_nl_25e50b681aa242f3afad6382ba6b2d4f.webp',
      variants: ['A1', 'A2', 'A3', 'A4', 'A5', 'A6', 'A7', 'A8']
    },
    {
      prefix: 'B',
      name: '[Mã màu B] Gói bổ sung hạt nhựa ủi 2.6mm 10g (1000 hạt)',
      slug: 'products-hat-nhua-refill-b',
      price: 15000,
      image: 'https://cdn.hstatic.net/products/200001193910/vn-11134207-81ztc-mmhpzoay70g176_a6a1cf0e1eef49449f0a23c1a5de51b6.webp',
      variants: ['B1', 'B2', 'B3', 'B4', 'B5', 'B6', 'B7', 'B8', 'B9', 'B10']
    },
    {
      prefix: 'C',
      name: '[Mã màu C] Gói bổ sung hạt nhựa ủi 2.6mm 10g (1000 hạt)',
      slug: 'products-hat-nhua-refill-c',
      price: 15000,
      image: 'https://cdn.hstatic.net/products/200001193910/vn-11134207-81ztc-mnbt7617xh4w36_057d92b2b36945c0a623b97c80e7debf.webp',
      variants: ['C1', 'C2', 'C3', 'C4', 'C5', 'C6', 'C7', 'C8', 'C9', 'C10']
    },
    {
      prefix: 'F',
      name: '[Mã màu F] Gói bổ sung hạt nhựa ủi 2.6mm 10g (1000 hạt)',
      slug: 'products-hat-nhua-refill-f',
      price: 15000,
      image: 'https://cdn.hstatic.net/products/200001193910/vn-11134207-81ztc-mmqa6ee3kqv554_fda0605d33c84efc8538d5caa9f5e341.webp',
      variants: ['F1', 'F2', 'F3', 'F4', 'F5', 'F6', 'F7', 'F8']
    },
    {
      prefix: 'G',
      name: '[Mã màu G] Gói bổ sung hạt nhựa ủi 2.6mm 10g (1000 hạt)',
      slug: 'products-hat-nhua-refill-g',
      price: 15000,
      image: 'https://cdn.hstatic.net/products/200001193910/vn-11134207-81ztc-mmqa4tdcmww204_8d2ad59824d44a59a0f03bbec965a974.webp',
      variants: ['G1', 'G2', 'G3']
    },
    {
      prefix: 'H',
      name: '[Mã màu H] Gói bổ sung hạt nhựa ủi 2.6mm 10g (1000 hạt)',
      slug: 'products-hat-nhua-refill-h',
      price: 15000,
      image: 'https://cdn.hstatic.net/products/200001193910/vn-11134207-81ztc-mmqa2sihq0w03d_a4fd8b6bc5b2467198335f264f8fe0e3.webp',
      variants: ['H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'H7', 'H8', 'H9', 'H10']
    }
  ];

  suggestedProducts: BeadProductRecommendation[] = [];

  private lastReducedPixels: [number, number, number][] = [];
  private lastTransparentMask: boolean[] = [];
  private lastColorCodeMap = new Map<string, BeadColorInfo>();

  readonly isBrowser: boolean;

  readonly samplePresets: PresetImage[] = [
    {
      name: 'Trái tim Urii',
      label: '1 màu (F6)',
      icon: 'bi-suit-heart-fill',
      colorBadge: '#D32F2F',
      url: 'data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" width="160" height="160" shape-rendering="crispEdges"><rect width="16" height="16" fill="none"/><path fill="%23D32F2F" d="M3 2h3v1H3zm7 0h3v1h-3zM2 3h5v2H2zm7 0h5v2H9zM1 5h14v3H1zm1 3h12v2H2zm2 2h8v2H4zm2 2h4v2H6zm1 2h2v1H7z"/></svg>'
    },
    {
      name: 'Quả dâu tây',
      label: '3 màu (F6, B5, A4)',
      icon: 'bi-flower1',
      colorBadge: '#D32F2F',
      url: 'data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" width="160" height="160" shape-rendering="crispEdges"><rect width="16" height="16" fill="none"/><path fill="%234CAF50" d="M7 1h2v2H7zM5 3h6v1H5zM4 4h8v1H4z"/><path fill="%23D32F2F" d="M4 5h8v1H4zm-1 1h10v3H3zm1 3h8v1H4zm1 1h6v1H5zm1 1h4v1H6zm1 1h2v1H7z"/><path fill="%23FFD600" d="M5 6h1v1H5zm3 0h1v1H8zm3 0h1v1h-1zM4 8h1v1H4zm3 0h1v1H7zm3 0h1v1h-1zm-2 2h1v1H8z"/></svg>'
    },
    {
      name: 'Ngôi sao vàng',
      label: '1 màu (A4)',
      icon: 'bi-star-fill',
      colorBadge: '#FFD600',
      url: 'data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" width="160" height="160" shape-rendering="crispEdges"><rect width="16" height="16" fill="none"/><path fill="%23FFD600" d="M7 1h2v2H7zM6 3h4v2H6zM1 5h14v2H1zm2 2h12v1H3zm2 1h8v2H5zm-1 2h3v2H4zm5 0h3v2H9zm-2 2h2v1H7zm-3 1h3v2H4zm5 0h3v2H9z"/></svg>'
    }
  ];

  constructor(
    @Inject(PLATFORM_ID) platformId: Object,
    private readonly cdr: ChangeDetectorRef
  ) {
    this.isBrowser = isPlatformBrowser(platformId);
  }

  ngOnInit(): void {
    if (this.isBrowser) {
      this.http.get<any>('/api/products?limit=100').subscribe({
        next: (res) => {
          const list = Array.isArray(res) ? res : res?.products || [];
          const beadItems = list.filter((p: any) => p.name?.includes('hạt') || p.name?.includes('Hạt'));
          if (beadItems.length > 0) {
            beadItems.forEach((p: any) => {
              const prefixMatch = p.name?.match(/Mã màu ([A-Z])/i);
              const prefix = prefixMatch ? prefixMatch[1].toUpperCase() : '';
              const existing = this.allBeadProducts.find(b => b.prefix === prefix);
              if (existing) {
                existing.name = p.name;
                existing.slug = p.slug;
                existing.price = p.price || existing.price;
                if (p.image) existing.image = p.image;
              }
            });
          }
        },
        error: (err) => console.warn('Lỗi tải sản phẩm hạt từ API:', err)
      });
    }
  }

  ngAfterViewInit(): void {
    if (this.isBrowser) {
      this.loadPreset(this.samplePresets[0]);
    }
  }

  ngOnDestroy(): void {
    this.currentImage = null;
  }

  @HostListener('window:paste', ['$event'])
  onWindowPaste(event: ClipboardEvent): void {
    if (!this.isBrowser) return;
    const items = event.clipboardData?.items;
    if (!items) return;

    for (let i = 0; i < items.length; i++) {
      if (items[i].type.startsWith('image/')) {
        const file = items[i].getAsFile();
        if (file) {
          event.preventDefault();
          this.imageFileName = `Ảnh dán (${new Date().toLocaleTimeString('vi-VN')})`;
          this.readFile(file);
          break;
        }
      }
    }
  }

  onFileSelected(event: Event): void {
    const input = event.target as HTMLInputElement;
    if (!input.files || input.files.length === 0) return;
    const file = input.files[0];
    this.imageFileName = file.name;
    this.readFile(file);
  }

  onDragOver(event: DragEvent): void {
    event.preventDefault();
    event.stopPropagation();
    this.isDragging = true;
  }

  onDragLeave(event: DragEvent): void {
    event.preventDefault();
    event.stopPropagation();
    this.isDragging = false;
  }

  onDrop(event: DragEvent): void {
    event.preventDefault();
    event.stopPropagation();
    this.isDragging = false;

    if (event.dataTransfer && event.dataTransfer.files.length > 0) {
      const file = event.dataTransfer.files[0];
      if (file.type.startsWith('image/')) {
        this.imageFileName = file.name;
        this.readFile(file);
      }
    }
  }

  private readFile(file: File): void {
    const reader = new FileReader();
    reader.onload = (e: ProgressEvent<FileReader>) => {
      const result = e.target?.result as string;
      if (result) {
        this.loadImageUrl(result);
      }
    };
    reader.readAsDataURL(file);
  }

  loadPreset(preset: PresetImage): void {
    this.imageFileName = `${preset.name} (${preset.label})`;
    this.loadImageUrl(preset.url);
  }

  loadImageUrl(url: string): void {
    if (!this.isBrowser) return;

    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      this.currentImage = img;
      this.hasImage = true;
      this.selectedColorCode = null;

      this.applyImageAspectRatio(img);

      this.drawOriginalPreview();
      this.processImage();
      this.cdr.detectChanges();
    };
    img.src = url;
  }

  private applyImageAspectRatio(img: HTMLImageElement): void {
    const w = img.naturalWidth || 1;
    const h = img.naturalHeight || 1;
    this.imageAspectRatio = w / h;

    if (this.keepAspectRatio) {
      if (Math.abs(this.imageAspectRatio - 1) < 0.05) {
        this.gridCols = 29;
        this.gridRows = 29;
        this.maxDimension = 29;
      } else if (w >= h) {
        const baseCols = Math.max(29, Math.min(80, this.maxDimension || 40));
        this.gridCols = baseCols;
        this.gridRows = Math.max(8, Math.round(baseCols / this.imageAspectRatio));
        this.maxDimension = baseCols;
      } else {
        const baseRows = Math.max(29, Math.min(80, this.maxDimension || 40));
        this.gridRows = baseRows;
        this.gridCols = Math.max(8, Math.round(baseRows * this.imageAspectRatio));
        this.maxDimension = baseRows;
      }
    }
  }

  setMaxDimension(val: number): void {
    this.maxDimension = Math.max(8, Math.min(100, val));
    if (this.keepAspectRatio && this.imageAspectRatio > 0) {
      if (this.imageAspectRatio >= 1) {
        this.gridCols = this.maxDimension;
        this.gridRows = Math.max(8, Math.round(this.maxDimension / this.imageAspectRatio));
      } else {
        this.gridRows = this.maxDimension;
        this.gridCols = Math.max(8, Math.round(this.maxDimension * this.imageAspectRatio));
      }
    } else {
      this.gridCols = this.maxDimension;
      this.gridRows = this.maxDimension;
    }
    this.triggerReprocess();
  }

  onMaxDimensionChange(event: Event): void {
    const val = parseInt((event.target as HTMLInputElement).value, 10);
    if (!isNaN(val)) {
      this.setMaxDimension(val);
    }
  }

  setGridCols(cols: number): void {
    this.gridCols = Math.max(8, Math.min(100, cols));
    if (this.keepAspectRatio && this.imageAspectRatio > 0) {
      this.gridRows = Math.max(8, Math.min(100, Math.round(this.gridCols / this.imageAspectRatio)));
      this.maxDimension = Math.max(this.gridCols, this.gridRows);
    }
    this.triggerReprocess();
  }

  onGridColsChange(event: Event): void {
    const val = parseInt((event.target as HTMLInputElement).value, 10);
    if (!isNaN(val)) {
      this.setGridCols(val);
    }
  }

  setGridRows(rows: number): void {
    this.gridRows = Math.max(8, Math.min(100, rows));
    if (this.keepAspectRatio && this.imageAspectRatio > 0) {
      this.gridCols = Math.max(8, Math.min(100, Math.round(this.gridRows * this.imageAspectRatio)));
      this.maxDimension = Math.max(this.gridCols, this.gridRows);
    }
    this.triggerReprocess();
  }

  onGridRowsChange(event: Event): void {
    const val = parseInt((event.target as HTMLInputElement).value, 10);
    if (!isNaN(val)) {
      this.setGridRows(val);
    }
  }

  toggleKeepAspectRatio(): void {
    this.keepAspectRatio = !this.keepAspectRatio;
    if (this.keepAspectRatio && this.currentImage) {
      this.applyImageAspectRatio(this.currentImage);
      this.triggerReprocess();
    }
  }

  setBoardPreset(mode: 'original' | 'square29' | 'horiz2x1' | 'vert1x2' | 'square4x4'): void {
    switch (mode) {
      case 'original':
        this.keepAspectRatio = true;
        if (this.currentImage) {
          this.applyImageAspectRatio(this.currentImage);
        }
        break;
      case 'square29':
        this.keepAspectRatio = false;
        this.gridCols = 29;
        this.gridRows = 29;
        this.maxDimension = 29;
        break;
      case 'horiz2x1':
        this.keepAspectRatio = false;
        this.gridCols = 58;
        this.gridRows = 29;
        this.maxDimension = 58;
        break;
      case 'vert1x2':
        this.keepAspectRatio = false;
        this.gridCols = 29;
        this.gridRows = 58;
        this.maxDimension = 58;
        break;
      case 'square4x4':
        this.keepAspectRatio = false;
        this.gridCols = 58;
        this.gridRows = 58;
        this.maxDimension = 58;
        break;
    }
    this.triggerReprocess();
  }

  getAspectLabel(): string {
    if (this.gridCols === this.gridRows) {
      return '1 : 1 (Vuông)';
    }
    const gcd = (a: number, b: number): number => (b === 0 ? a : gcd(b, a % b));
    const divisor = gcd(this.gridCols, this.gridRows);
    const wRatio = this.gridCols / divisor;
    const hRatio = this.gridRows / divisor;

    if (wRatio > hRatio) {
      if (wRatio <= 20 && hRatio <= 20) {
        return `${wRatio}:${hRatio} (Ngang)`;
      }
      return `${(this.gridCols / this.gridRows).toFixed(1)}:1 (Ngang)`;
    } else {
      if (wRatio <= 20 && hRatio <= 20) {
        return `${wRatio}:${hRatio} (Dọc)`;
      }
      return `1:${(this.gridRows / this.gridCols).toFixed(1)} (Dọc)`;
    }
  }

  private triggerReprocess(): void {
    if (this.currentImage) {
      this.drawOriginalPreview();
      this.processImage();
    }
  }

  setColorCount(count: number): void {
    this.colorCount = count;
    if (this.currentImage) {
      this.processImage();
    }
  }

  onColorCountChange(event: Event): void {
    const val = parseInt((event.target as HTMLInputElement).value, 10);
    if (!isNaN(val)) {
      this.colorCount = val;
      if (this.currentImage) {
        this.processImage();
      }
    }
  }

  setColorVibrancy(val: number): void {
    this.colorVibrancy = val;
    if (this.currentImage) {
      this.processImage();
    }
  }

  onColorVibrancyChange(event: Event): void {
    const val = parseInt((event.target as HTMLInputElement).value, 10);
    if (!isNaN(val)) {
      this.colorVibrancy = val;
      if (this.currentImage) {
        this.processImage();
      }
    }
  }

  togglePreferUriiColors(): void {
    this.preferUriiColors = !this.preferUriiColors;
    if (this.currentImage) {
      this.processImage();
    }
  }

  setCellShape(shape: 'square' | 'realistic' | 'dot'): void {
    this.cellShape = shape;
    this.reRenderFromCache();
  }

  toggleColorLabels(): void {
    this.showColorLabels = !this.showColorLabels;
    this.reRenderFromCache();
  }

  toggleGridLines(): void {
    this.showGridLines = !this.showGridLines;
    this.reRenderFromCache();
  }

  toggleGuideBlocks(): void {
    this.showGuideBlocks = !this.showGuideBlocks;
    this.reRenderFromCache();
  }

  toggleCoordinates(): void {
    this.showCoordinates = !this.showCoordinates;
    this.reRenderFromCache();
  }

  selectColorFilter(code: string): void {
    if (this.selectedColorCode === code) {
      this.selectedColorCode = null;
    } else {
      this.selectedColorCode = code;
    }
    this.reRenderFromCache();
  }

  private reRenderFromCache(): void {
    if (this.lastReducedPixels.length > 0 && this.resultCanvasRef) {
      this.renderBeadCanvas(this.lastReducedPixels, this.lastTransparentMask, this.gridCols, this.gridRows);
    }
  }

  drawOriginalPreview(): void {
    if (!this.currentImage || !this.originalCanvasRef) return;
    const canvas = this.originalCanvasRef.nativeElement;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const cols = this.gridCols;
    const rows = this.gridRows;
    canvas.width = cols;
    canvas.height = rows;
    ctx.imageSmoothingEnabled = false;
    ctx.clearRect(0, 0, cols, rows);
    ctx.drawImage(this.currentImage, 0, 0, cols, rows);
  }

  processImage(): void {
    if (!this.currentImage || !this.resultCanvasRef || !this.isBrowser) return;
    this.isProcessing = true;

    setTimeout(() => {
      try {
        const cols = this.gridCols;
        const rows = this.gridRows;
        const maxColors = this.colorCount;

        const tempCanvas = document.createElement('canvas');
        tempCanvas.width = cols;
        tempCanvas.height = rows;
        const tempCtx = tempCanvas.getContext('2d');
        if (!tempCtx) return;

        tempCtx.imageSmoothingEnabled = false;
        tempCtx.drawImage(this.currentImage!, 0, 0, cols, rows);
        const imageData = tempCtx.getImageData(0, 0, cols, rows);
        const data = imageData.data;

        const pixels: [number, number, number][] = [];
        const isTransparentMask: boolean[] = [];

        // Áp dụng tăng cường độ tương phản và bão hòa màu để chống hiện tượng phai xám khi thu nhỏ
        const vibrancyFactor = this.colorVibrancy / 100;

        for (let i = 0; i < data.length; i += 4) {
          const alpha = data[i + 3];
          if (alpha < 32) {
            isTransparentMask.push(true);
            pixels.push([255, 255, 255]);
          } else {
            isTransparentMask.push(false);
            let r = data[i];
            let g = data[i + 1];
            let b = data[i + 2];

            if (vibrancyFactor !== 0) {
              const lum = 0.299 * r + 0.587 * g + 0.114 * b;
              r = Math.max(0, Math.min(255, Math.round(lum + (r - lum) * (1 + vibrancyFactor))));
              g = Math.max(0, Math.min(255, Math.round(lum + (g - lum) * (1 + vibrancyFactor))));
              b = Math.max(0, Math.min(255, Math.round(lum + (b - lum) * (1 + vibrancyFactor))));
            }

            pixels.push([r, g, b]);
          }
        }

        const opaquePixels = pixels.filter((_, idx) => !isTransparentMask[idx]);
        const validPixels = opaquePixels.length > 0 ? opaquePixels : pixels;

        const reduced = this.quantizeColors(validPixels, pixels, isTransparentMask, maxColors);

        this.lastReducedPixels = reduced;
        this.lastTransparentMask = isTransparentMask;

        this.computePalette(reduced, isTransparentMask);
        this.updateSuggestedProducts();
        this.renderBeadCanvas(reduced, isTransparentMask, cols, rows);
      } finally {
        this.isProcessing = false;
        this.cdr.detectChanges();
      }
    }, 10);
  }

  /**
   * Khoảng cách màu thụ cảm CIE Lab với trọng số Chroma (Chống biến màu da/tóc thành màu xám)
   */
  private perceptualColorDistance(rgb1: [number, number, number], bead: BeadDefinition): number {
    const lab1 = rgbToLab(rgb1[0], rgb1[1], rgb1[2]);
    const lab2 = bead.lab;

    const dL = lab1[0] - lab2[0];
    const da = lab1[1] - lab2[1];
    const db = lab1[2] - lab2[2];

    const c1 = Math.sqrt(lab1[1] * lab1[1] + lab1[2] * lab1[2]);
    const c2 = Math.sqrt(lab2[1] * lab2[1] + lab2[2] * lab2[2]);

    // Phạt nặng nếu pixel ảnh có sắc tố màu (chroma > 7) mà hạt lại là màu xám trung tính (chroma < 6)
    let chromaPenalty = 0;
    if (c1 > 7 && c2 < 6) {
      chromaPenalty = (c1 - c2) * 3.5;
    }

    // Ưu tiên hạt Urii nếu người dùng bật chế độ ưu tiên kho
    let stockBonus = 0;
    if (this.preferUriiColors && bead.inStockUrii) {
      stockBonus = -4.0;
    }

    return Math.sqrt(dL * dL + da * da * 2.2 + db * db * 2.2) + chromaPenalty + stockBonus;
  }

  findNearestBead(rgb: [number, number, number]): BeadDefinition {
    let closest = STANDARD_BEAD_PALETTE[0];
    let minDist = Infinity;

    for (const bead of STANDARD_BEAD_PALETTE) {
      const d = this.perceptualColorDistance(rgb, bead);
      if (d < minDist) {
        minDist = d;
        closest = bead;
      }
    }
    return closest;
  }

  /**
   * Phân cụm K-Means++ thông minh và lượng tử hóa màu theo bảng hạt
   */
  private quantizeColors(
    trainPixels: [number, number, number][],
    allPixels: [number, number, number][],
    transparentMask: boolean[],
    k: number
  ): [number, number, number][] {
    if (trainPixels.length === 0) {
      return allPixels;
    }

    const actualK = Math.min(k, trainPixels.length);

    // K-Means++ Initialization (Tránh việc các tâm cụm rơi vào cùng một vùng màu)
    const centers: [number, number, number][] = [];
    centers.push([...trainPixels[Math.floor(Math.random() * trainPixels.length)]]);

    while (centers.length < actualK) {
      const distances: number[] = [];
      let sumDist = 0;

      for (const p of trainPixels) {
        let minD = Infinity;
        for (const c of centers) {
          const d = (p[0] - c[0]) ** 2 + (p[1] - c[1]) ** 2 + (p[2] - c[2]) ** 2;
          if (d < minD) minD = d;
        }
        distances.push(minD);
        sumDist += minD;
      }

      let r = Math.random() * sumDist;
      let nextIdx = 0;
      for (let i = 0; i < distances.length; i++) {
        r -= distances[i];
        if (r <= 0) {
          nextIdx = i;
          break;
        }
      }
      centers.push([...trainPixels[nextIdx]]);
    }

    // K-Means Iterations
    for (let iter = 0; iter < 12; iter++) {
      const clusters: [number, number, number][][] = Array.from({ length: actualK }, () => []);

      for (const pixel of trainPixels) {
        let minDist = Infinity;
        let closest = 0;
        for (let i = 0; i < centers.length; i++) {
          const c = centers[i];
          const d = (pixel[0] - c[0]) ** 2 + (pixel[1] - c[1]) ** 2 + (pixel[2] - c[2]) ** 2;
          if (d < minDist) {
            minDist = d;
            closest = i;
          }
        }
        clusters[closest].push(pixel);
      }

      let changed = false;
      for (let i = 0; i < actualK; i++) {
        if (clusters[i].length === 0) continue;
        const sum = clusters[i].reduce(
          (acc, p) => [acc[0] + p[0], acc[1] + p[1], acc[2] + p[2]],
          [0, 0, 0]
        );
        const avg: [number, number, number] = [
          Math.round(sum[0] / clusters[i].length),
          Math.round(sum[1] / clusters[i].length),
          Math.round(sum[2] / clusters[i].length)
        ];

        if (avg[0] !== centers[i][0] || avg[1] !== centers[i][1] || avg[2] !== centers[i][2]) {
          changed = true;
          centers[i] = avg;
        }
      }
      if (!changed) break;
    }

    // Ánh xạ mỗi tâm cụm K-Means vào hạt màu chuẩn tốt nhất
    const centerBeadMap = centers.map(c => this.findNearestBead(c));

    // Gán mỗi pixel về màu hạt chuẩn thụ cảm tốt nhất
    return allPixels.map((pixel, idx) => {
      if (transparentMask[idx]) {
        return [255, 255, 255];
      }
      let minDist = Infinity;
      let closestIdx = 0;
      for (let i = 0; i < centers.length; i++) {
        const c = centers[i];
        const d = (pixel[0] - c[0]) ** 2 + (pixel[1] - c[1]) ** 2 + (pixel[2] - c[2]) ** 2;
        if (d < minDist) {
          minDist = d;
          closestIdx = i;
        }
      }
      return centerBeadMap[closestIdx].rgb;
    });
  }

  private computePalette(
    colors: [number, number, number][],
    transparentMask: boolean[]
  ): void {
    const countMap = new Map<string, { count: number; bead: BeadDefinition }>();
    let totalBeads = 0;

    for (let i = 0; i < colors.length; i++) {
      if (transparentMask[i]) continue;
      const rgb = colors[i];
      const bead = this.findNearestBead(rgb);
      const code = bead.code;

      totalBeads++;
      const current = countMap.get(code);
      if (current) {
        current.count++;
      } else {
        countMap.set(code, { count: 1, bead });
      }
    }

    this.totalBeadCount = totalBeads;

    const sortedEntries = Array.from(countMap.entries()).sort(
      (a, b) => b[1].count - a[1].count
    );

    const colorCodeMap = new Map<string, BeadColorInfo>();
    const resultList: BeadColorInfo[] = [];

    for (const [code, data] of sortedEntries) {
      const bead = data.bead;
      const [r, g, b] = bead.rgb;
      const luminance = 0.299 * r + 0.587 * g + 0.114 * b;
      const textColor = luminance > 148 ? '#111827' : '#ffffff';

      const info: BeadColorInfo = {
        code,
        name: bead.name,
        hex: bead.hex,
        rgb: bead.rgb,
        count: data.count,
        percentage: totalBeads > 0 ? Math.round((data.count / totalBeads) * 100) : 0,
        textColor,
        inStockUrii: bead.inStockUrii,
        productSlug: bead.inStockUrii ? bead.productSlug : undefined
      };

      colorCodeMap.set(bead.hex, info);
      colorCodeMap.set(this.rgbToHex(r, g, b), info);
      resultList.push(info);
    }

    this.lastColorCodeMap = colorCodeMap;
    this.palette = resultList;
  }

  private updateSuggestedProducts(): void {
    const prefixCountMap = new Map<string, { total: number; variants: MatchedVariant[] }>();

    for (const item of this.palette) {
      // Chỉ tổng hợp các biến thể hạt mà Urii thực tế CÓ bán trong kho
      if (item.inStockUrii) {
        const prefix = item.code.charAt(0);
        const entry = prefixCountMap.get(prefix) || { total: 0, variants: [] };
        entry.total += item.count;
        entry.variants.push({ code: item.code, count: item.count });
        prefixCountMap.set(prefix, entry);
      }
    }

    const matched: BeadProductRecommendation[] = [];

    for (const prod of this.allBeadProducts) {
      const entry = prefixCountMap.get(prod.prefix);
      if (entry) {
        matched.push({
          ...prod,
          matchedVariants: entry.variants,
          totalBeadsNeeded: entry.total
        });
      }
    }

    matched.sort((a, b) => (b.totalBeadsNeeded || 0) - (a.totalBeadsNeeded || 0));

    if (matched.length < 2) {
      const existingPrefixes = new Set(matched.map(m => m.prefix));
      const fallbacks = this.allBeadProducts.filter(p => !existingPrefixes.has(p.prefix));
      this.suggestedProducts = [...matched, ...fallbacks.slice(0, 3 - matched.length)];
    } else {
      this.suggestedProducts = matched;
    }
  }

  private renderBeadCanvas(
    reduced: [number, number, number][],
    transparentMask: boolean[],
    cols: number,
    rows: number
  ): void {
    const canvas = this.resultCanvasRef.nativeElement;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const maxDim = Math.max(cols, rows);
    const cellSize = Math.max(22, Math.min(48, Math.floor(960 / maxDim)));
    const gridPixelWidth = cols * cellSize;
    const gridPixelHeight = rows * cellSize;

    const margin = this.showCoordinates ? 30 : 0;
    const totalCanvasWidth = gridPixelWidth + margin * 2;
    const totalCanvasHeight = gridPixelHeight + margin * 2;

    canvas.width = totalCanvasWidth;
    canvas.height = totalCanvasHeight;

    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, totalCanvasWidth, totalCanvasHeight);

    // Tọa độ 4 cạnh
    if (this.showCoordinates) {
      ctx.fillStyle = '#1e293b';
      const fontSize = Math.max(9, Math.min(13, Math.floor(cellSize * 0.46)));
      ctx.font = `700 ${fontSize}px 'Nunito Sans', Arial, sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';

      for (let c = 0; c < cols; c++) {
        const num = `${c + 1}`;
        const centerPos = margin + c * cellSize + cellSize / 2;
        ctx.fillText(num, centerPos, margin / 2);
        ctx.fillText(num, centerPos, margin + gridPixelHeight + margin / 2);
      }

      for (let r = 0; r < rows; r++) {
        const num = `${r + 1}`;
        const centerPos = margin + r * cellSize + cellSize / 2;
        ctx.fillText(num, margin / 2, centerPos);
        ctx.fillText(num, margin + gridPixelWidth + margin / 2, centerPos);
      }
    }

    // Vẽ từng hạt
    for (let row = 0; row < rows; row++) {
      for (let col = 0; col < cols; col++) {
        const idx = row * cols + col;
        const x = margin + col * cellSize;
        const y = margin + row * cellSize;
        const centerX = x + cellSize / 2;
        const centerY = y + cellSize / 2;

        if (transparentMask[idx]) {
          ctx.fillStyle = (row + col) % 2 === 0 ? '#fafafa' : '#f1f1f1';
          ctx.fillRect(x, y, cellSize, cellSize);

          ctx.beginPath();
          ctx.arc(centerX, centerY, 1.8, 0, Math.PI * 2);
          ctx.fillStyle = 'rgba(180, 170, 160, 0.4)';
          ctx.fill();
          continue;
        }

        const [r, g, b] = reduced[idx];
        const hex = this.rgbToHex(r, g, b);
        const info = this.lastColorCodeMap.get(hex);
        const code = info ? info.code : '';
        const textColor = info ? info.textColor : '#ffffff';

        const isDimmed = this.selectedColorCode !== null && this.selectedColorCode !== code;

        ctx.save();
        if (isDimmed) {
          ctx.globalAlpha = 0.2;
        }

        if (this.cellShape === 'square') {
          ctx.fillStyle = `rgb(${r}, ${g}, ${b})`;
          ctx.fillRect(x, y, cellSize, cellSize);

          ctx.strokeStyle = 'rgba(0, 0, 0, 0.12)';
          ctx.lineWidth = 0.7;
          ctx.strokeRect(x, y, cellSize, cellSize);
        } else if (this.cellShape === 'realistic') {
          const radius = cellSize * 0.45;
          const holeRadius = radius * 0.38;

          ctx.beginPath();
          ctx.arc(centerX, centerY, radius, 0, Math.PI * 2);
          ctx.fillStyle = `rgb(${r}, ${g}, ${b})`;
          ctx.fill();

          ctx.strokeStyle = 'rgba(0, 0, 0, 0.22)';
          ctx.lineWidth = Math.max(1, cellSize * 0.08);
          ctx.stroke();

          ctx.beginPath();
          ctx.arc(centerX, centerY, holeRadius, 0, Math.PI * 2);
          ctx.fillStyle = '#ffffff';
          ctx.fill();
          ctx.strokeStyle = 'rgba(0, 0, 0, 0.3)';
          ctx.lineWidth = 0.8;
          ctx.stroke();
        } else {
          const radius = cellSize * 0.44;
          ctx.beginPath();
          ctx.arc(centerX, centerY, radius, 0, Math.PI * 2);
          ctx.fillStyle = `rgb(${r}, ${g}, ${b})`;
          ctx.fill();

          ctx.strokeStyle = 'rgba(0, 0, 0, 0.18)';
          ctx.lineWidth = 0.8;
          ctx.stroke();
        }

        // Tự động điều chỉnh hiển thị mã chữ: nếu ô đủ lớn (>=16px) thì vẽ mã rõ ràng
        if (this.showColorLabels && code && cellSize >= 16) {
          const labelFontSize = Math.max(
            8,
            Math.min(13, Math.floor(cellSize * (this.cellShape === 'realistic' ? 0.34 : 0.44)))
          );

          ctx.font = `800 ${labelFontSize}px 'Nunito Sans', Arial, sans-serif`;
          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';
          ctx.fillStyle = textColor;

          if (cellSize >= 24) {
            ctx.shadowColor = textColor === '#ffffff' ? 'rgba(0, 0, 0, 0.5)' : 'rgba(255, 255, 255, 0.5)';
            ctx.shadowBlur = 1;
          }

          ctx.fillText(code, centerX, centerY);
        }

        ctx.restore();
      }
    }

    if (this.showGridLines) {
      ctx.strokeStyle = 'rgba(160, 150, 140, 0.35)';
      ctx.lineWidth = 0.7;

      for (let c = 0; c <= cols; c++) {
        const posX = margin + c * cellSize;
        ctx.beginPath();
        ctx.moveTo(posX, margin);
        ctx.lineTo(posX, margin + gridPixelHeight);
        ctx.stroke();
      }

      for (let r = 0; r <= rows; r++) {
        const posY = margin + r * cellSize;
        ctx.beginPath();
        ctx.moveTo(margin, posY);
        ctx.lineTo(margin + gridPixelWidth, posY);
        ctx.stroke();
      }
    }

    if (this.showGuideBlocks) {
      ctx.strokeStyle = '#f97316';
      ctx.lineWidth = 2.2;

      for (let c = 10; c < cols; c += 10) {
        const posX = margin + c * cellSize;
        ctx.beginPath();
        ctx.moveTo(posX, margin);
        ctx.lineTo(posX, margin + gridPixelHeight);
        ctx.stroke();
      }

      for (let r = 10; r < rows; r += 10) {
        const posY = margin + r * cellSize;
        ctx.beginPath();
        ctx.moveTo(margin, posY);
        ctx.lineTo(margin + gridPixelWidth, posY);
        ctx.stroke();
      }

      ctx.strokeStyle = 'rgba(176, 1, 3, 0.7)';
      ctx.lineWidth = 2;
      ctx.strokeRect(margin, margin, gridPixelWidth, gridPixelHeight);
    }
  }

  downloadResult(): void {
    if (!this.resultCanvasRef || !this.isBrowser) return;
    const canvas = this.resultCanvasRef.nativeElement;
    const link = document.createElement('a');
    const safeName = (this.imageFileName || 'map-hat-nhua')
      .replace(/\.[^/.]+$/, '')
      .replace(/[^a-zA-Z0-9_-]/g, '_');
    link.download = `urii-${safeName}-${this.gridCols}x${this.gridRows}-chart.png`;
    link.href = canvas.toDataURL('image/png');
    link.click();
  }

  triggerFileInput(event?: MouseEvent): void {
    if (event) {
      event.stopPropagation();
    }
    if (this.fileInputRef) {
      this.fileInputRef.nativeElement.click();
    }
  }

  async pasteFromClipboard(event?: MouseEvent): Promise<void> {
    if (event) {
      event.stopPropagation();
    }
    if (!this.isBrowser) return;

    try {
      if (navigator.clipboard && navigator.clipboard.read) {
        const items = await navigator.clipboard.read();
        for (const item of items) {
          const imageType = item.types.find(type => type.startsWith('image/'));
          if (imageType) {
            const blob = await item.getType(imageType);
            this.imageFileName = `Ảnh dán (${new Date().toLocaleTimeString('vi-VN')})`;
            this.readFile(blob as File);
            return;
          }
        }
      }
    } catch {
      // Fallback
    }

    const url = window.prompt('Dán đường dẫn (URL) hình ảnh vào đây:');
    if (url && url.trim()) {
      this.imageFileName = 'Ảnh từ liên kết';
      this.loadImageUrl(url.trim());
    }
  }

  reset(): void {
    this.keepAspectRatio = true;
    this.gridCols = 29;
    this.gridRows = 29;
    this.maxDimension = 29;
    this.colorCount = 16;
    this.colorVibrancy = 20;
    this.preferUriiColors = false;
    this.cellShape = 'square';
    this.showColorLabels = true;
    this.showGridLines = true;
    this.showGuideBlocks = true;
    this.showCoordinates = true;
    this.selectedColorCode = null;
    this.loadPreset(this.samplePresets[0]);
  }

  private rgbToHex(r: number, g: number, b: number): string {
    const toHex = (n: number) => {
      const hex = Math.max(0, Math.min(255, n)).toString(16);
      return hex.length === 1 ? '0' + hex : hex;
    };
    return `#${toHex(r)}${toHex(g)}${toHex(b)}`.toUpperCase();
  }
}

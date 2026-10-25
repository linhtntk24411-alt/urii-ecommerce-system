export interface Product {
  id?: number;
  _id?: string; // Bổ sung thuộc tính ID của MongoDB
  name: string;
  category: string;
  status: string;
  price: number;
  currentPrice?: number;
  originalPrice?: number;
  stock: number;
  image: string;
}
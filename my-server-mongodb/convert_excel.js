const fs = require('fs');
const path = require('path');
const XLSX = require('xlsx');

function buildProducts(rows) {
  if (!Array.isArray(rows)) {
    throw new TypeError('Excel rows must be an array.');
  }

  const products = new Map();
  for (const row of rows) {
    const productId = String(row['Mã sản phẩm'] || '').trim();
    if (!productId || productId === '0' || productId === 'undefined' || !row['Tên']) {
      continue;
    }

    const price = Number(row['Giá']) || 0;
    const comparePrice = Number(row['Giá so sánh']) || price;
    const stock = Number(row['Số lượng tồn kho']) || 0;
    const imageUrl = row['Link hình'] || '';

    if (!products.has(productId)) {
      products.set(productId, {
        id: productId,
        name: row['Tên'],
        slug: row['Url'] || `san-pham-${productId}`,
        category: row['Loại sản phẩm'] || 'Khác',
        image: imageUrl,
        isSale: comparePrice > price,
        originalPrice: comparePrice,
        currentPrice: price,
        stock: 0,
        description: row['Mô tả'] || '',
        specifications: {
          'Hãng': row['Hãng'] || 'Urii',
          'Chất liệu': row['Giá trị thuộc tính 3'] || 'Đang cập nhật',
          'Size': row['Giá trị thuộc tính 1'] || 'Tiêu chuẩn'
        },
        variants: []
      });
    }

    const product = products.get(productId);
    product.variants.push({
      name: row['Giá trị thuộc tính 2'] || row['Giá trị thuộc tính 1'] || 'Mặc định',
      price,
      stock,
      image: row['Ảnh biến thể'] || imageUrl
    });
    product.stock += stock;
  }

  return Array.from(products.values());
}

function convertExcel() {
  const excelFilePath = path.join(__dirname, 'data', 'Urii_Product.xlsx');
  const outputFilePath = path.join(__dirname, 'data', 'products.json');
  const workbook = XLSX.readFile(excelFilePath);
  const sheetName = workbook.SheetNames[0];
  if (!sheetName) {
    throw new Error('File Excel không có trang tính.');
  }

  const rows = XLSX.utils.sheet_to_json(workbook.Sheets[sheetName]);
  const products = buildProducts(rows);
  if (products.length === 0) {
    throw new Error('Không tìm thấy sản phẩm hợp lệ trong file Excel.');
  }

  fs.writeFileSync(outputFilePath, JSON.stringify({ products }, null, 2), 'utf8');
  console.log(`Đã tạo ${products.length} sản phẩm tại ${outputFilePath}`);
}

if (require.main === module) {
  try {
    convertExcel();
  } catch (error) {
    console.error('Không thể chuyển đổi file Excel:', error.message);
    process.exitCode = 1;
  }
}

module.exports = { buildProducts, convertExcel };

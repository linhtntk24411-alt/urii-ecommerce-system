require("dotenv").config();

const express = require("express");
const mongoose = require("mongoose");
const cors = require("cors");

const app = express();
const productsCacheDurationMs = 30_000;
let productsCache = null;
let productsCacheExpiresAt = 0;

// Middleware
app.use(cors());
app.use(express.json());

// Kiểm tra API
app.get("/", (req, res) => {
    res.send("Urii Backend is running!");
});

app.get("/api/products", async (req, res) => {
    if (productsCache && Date.now() < productsCacheExpiresAt) {
        return res.json(productsCache);
    }

    const productsCollection = mongoose.connection.db?.collection("products");
    if (!productsCollection) {
        return res.status(503).json({ message: "MongoDB is not connected" });
    }

    try {
        const products = await productsCollection.find({}, {
            projection: {
                _id: 1,
                id: 1,
                name: 1,
                productName: 1,
                category: 1,
                image: 1,
                imageUrl: 1,
                images: 1,
                isSale: 1,
                isHot: 1,
                originalPrice: 1,
                currentPrice: 1,
                price: 1,
                salePrice: 1,
                stock: 1,
                quantity: 1,
                description: 1,
                rating: 1,
                reviews: 1,
                reviewCount: 1,
                variants: 1
            }
        }).toArray();
        productsCache = products;
        productsCacheExpiresAt = Date.now() + productsCacheDurationMs;
        return res.json(products);
    } catch (error) {
        console.error("Could not load products from MongoDB:", error);
        return res.status(500).json({ message: "Could not load products" });
    }
});

// Kết nối MongoDB Atlas
mongoose.connect(process.env.MONGO_URI)
    .then(() => {
        console.log("MongoDB Atlas connected successfully!");
    })
    .catch((error) => {
        console.error("MongoDB connection error:", error.message);
    });

// Khởi chạy Server
const PORT = process.env.PORT || 3002;

app.listen(PORT, () => {
    console.log(`Server running at http://localhost:${PORT}`);
});

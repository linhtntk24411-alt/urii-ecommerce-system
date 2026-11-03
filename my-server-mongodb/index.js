require("dotenv").config();

const express = require("express");
const mongoose = require("mongoose");
const cors = require("cors");
const bcrypt = require("bcryptjs");

const app = express();
const productsCacheDurationMs = 30_000;
let productsCache = null;
let productsCacheExpiresAt = 0;

// Middleware
app.use(cors());
app.use(express.json({ limit: "10mb" }));

// Kiểm tra API
app.get("/", (req, res) => {
    res.send("Urii Backend is running!");
});

app.post("/api/auth/login", async (req, res) => {
    const usersCollection = mongoose.connection.db?.collection("users");
    if (!usersCollection) {
        return res.status(503).json({ message: "MongoDB is not connected" });
    }

    const email = typeof req.body?.email === "string" ? req.body.email.trim() : "";
    const password = typeof req.body?.password === "string" ? req.body.password : "";
    if (!email || !password) {
        return res.status(400).json({ message: "Email and password are required" });
    }

    try {
        const user = await usersCollection.findOne(
            { email },
            {
                projection: {
                    _id: 1,
                    name: 1,
                    email: 1,
                    role: 1,
                    avatar: 1,
                    password: 1
                },
                collation: { locale: "en", strength: 2 }
            }
        );
        if (!user || typeof user.password !== "string" || !await bcrypt.compare(password, user.password)) {
            return res.status(401).json({ message: "Email hoặc mật khẩu không chính xác" });
        }

        return res.json({
            user: {
                id: String(user._id),
                name: typeof user.name === "string" ? user.name : "",
                email: typeof user.email === "string" ? user.email : email,
                role: typeof user.role === "string" ? user.role : "user",
                avatar: typeof user.avatar === "string" ? user.avatar : ""
            }
        });
    } catch (error) {
        console.error("Could not authenticate user:", error);
        return res.status(500).json({ message: "Could not authenticate user" });
    }
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
                slug: 1,
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

app.get("/api/blogs", async (req, res) => {
    const blogsCollection = mongoose.connection.db?.collection("blogs");
    if (!blogsCollection) {
        return res.status(503).json({ message: "MongoDB is not connected" });
    }

    try {
        const blogs = await blogsCollection.find({}, {
            projection: {
                _id: 1,
                id: 1,
                slug: 1,
                title: 1,
                summary: 1,
                excerpt: 1,
                content: 1,
                author: 1,
                avatar: 1,
                date: 1,
                createdAt: 1,
                updatedAt: 1,
                image: 1,
                coverImage: 1,
                category: 1,
                categorySlug: 1,
                category_slug: 1,
                likes: 1,
                comments: 1,
                views: 1,
                isFeatured: 1,
                is_featured: 1,
                tags: 1
            }
        }).toArray();
        return res.json(blogs);
    } catch (error) {
        console.error("Could not load blogs from MongoDB:", error);
        return res.status(500).json({ message: "Could not load blogs" });
    }
});

app.get("/api/blogs/:blogId/comments", async (req, res) => {
    const blogsCollection = mongoose.connection.db?.collection("blogs");
    const commentsCollection = mongoose.connection.db?.collection("comments");
    if (!blogsCollection || !commentsCollection) {
        return res.status(503).json({ message: "MongoDB is not connected" });
    }

    const blogId = Number(req.params.blogId);
    if (!Number.isSafeInteger(blogId) || blogId < 0) {
        return res.status(400).json({ message: "Invalid blog ID" });
    }

    try {
        const comments = await commentsCollection.find({
            blogId: { $in: [blogId, String(blogId)] }
        }, {
            projection: {
                _id: 1,
                id: 1,
                blogId: 1,
                author: 1,
                avatar: 1,
                content: 1,
                createdAt: 1,
                time: 1,
                updatedAt: 1
            }
        }).sort({ createdAt: -1 }).toArray();
        return res.json(comments);
    } catch (error) {
        console.error("Could not load blog comments from MongoDB:", error);
        return res.status(500).json({ message: "Could not load blog comments" });
    }
});

async function nextBlogId(blogsCollection) {
    const countersCollection = mongoose.connection.db.collection("counters");
    const latestBlog = await blogsCollection.findOne(
        { id: { $type: "number" } },
        { sort: { id: -1 }, projection: { id: 1 } }
    );

    try {
        await countersCollection.updateOne(
            { _id: "blog-post-id" },
            { $max: { value: Number.isSafeInteger(latestBlog?.id) ? latestBlog.id : 0 } },
            { upsert: true }
        );
    } catch (error) {
        if (error?.code !== 11000) {
            throw error;
        }
    }

    const counter = await countersCollection.findOneAndUpdate(
        { _id: "blog-post-id" },
        { $inc: { value: 1 } },
        { returnDocument: "after" }
    );
    if (!Number.isSafeInteger(counter?.value)) {
        throw new Error("Could not allocate a blog ID");
    }
    return counter.value;
}

app.post("/api/blogs", async (req, res) => {
    const blogsCollection = mongoose.connection.db?.collection("blogs");
    if (!blogsCollection) {
        return res.status(503).json({ message: "MongoDB is not connected" });
    }

    const body = req.body;
    const title = typeof body?.title === "string" ? body.title.trim() : "";
    const content = typeof body?.content === "string" ? body.content.trim() : "";
    const category = typeof body?.category === "string" ? body.category.trim() : "";
    const categorySlug = typeof body?.categorySlug === "string" ? body.categorySlug.trim() : "";
    const image = typeof body?.image === "string" ? body.image : "";

    if (!title || !content || !category || !categorySlug) {
        return res.status(400).json({ message: "Title, content, and category are required" });
    }
    if (image && !/^data:image\/(?:png|jpeg|webp|gif);base64,[A-Za-z0-9+/]+={0,2}$/.test(image)) {
        return res.status(400).json({ message: "Image must be a supported base64 image" });
    }

    try {
        const baseSlug = (typeof body.slug === "string" ? body.slug : title)
            .normalize("NFD")
            .replace(/[\u0300-\u036f]/g, "")
            .replace(/[đĐ]/g, "d")
            .toLowerCase()
            .trim()
            .replace(/[^a-z0-9]+/g, "-")
            .replace(/^-|-$/g, "") || `blog-${Date.now()}`;
        const existing = await blogsCollection.findOne({ slug: baseSlug }, { projection: { _id: 1 } });
        const slug = existing ? `${baseSlug}-${Date.now()}` : baseSlug;
        const createdAt = new Date();
        const tags = Array.isArray(body.tags)
            ? body.tags.filter((tag) => typeof tag === "string").map((tag) => tag.trim()).filter(Boolean).slice(0, 20)
            : [];
        const post = {
            id: await nextBlogId(blogsCollection),
            slug,
            title,
            summary: typeof body.summary === "string" ? body.summary.trim().slice(0, 300) : "",
            excerpt: typeof body.excerpt === "string" ? body.excerpt.trim().slice(0, 300) : "",
            content,
            author: typeof body.author === "string" ? body.author.trim().slice(0, 100) : "Urii",
            avatar: typeof body.avatar === "string" ? body.avatar : "",
            date: createdAt.toISOString(),
            createdAt,
            image,
            category,
            categorySlug,
            likes: 0,
            comments: 0,
            views: 0,
            isFeatured: false,
            tags,
            seoTitle: typeof body.seoTitle === "string" ? body.seoTitle.trim().slice(0, 200) : "",
            seoDesc: typeof body.seoDesc === "string" ? body.seoDesc.trim().slice(0, 500) : ""
        };
        const result = await blogsCollection.insertOne(post);
        return res.status(201).json({ id: result.insertedId, slug });
    } catch (error) {
        console.error("Could not create blog in MongoDB:", error);
        return res.status(500).json({ message: "Could not create blog" });
    }
});

app.get("/api/samplemaps", async (req, res) => {
    const mapsCollection = mongoose.connection.db?.collection("gallery");
    if (!mapsCollection) {
        return res.status(503).json({ message: "MongoDB is not connected" });
    }

    try {
        const maps = await mapsCollection.find({}, {
            projection: {
                _id: 1,
                map_id: 1,
                title: 1,
                map_name: 1,
                name: 1,
                category: 1,
                categories: 1,
                image: 1,
                main_image: 1,
                imageUrl: 1,
                images: 1,
                difficulty: 1,
                difficultyClass: 1,
                difficulty_class: 1,
                gridSize: 1,
                grid_size: 1,
                totalBeads: 1,
                total_beads: 1,
                beadCount: 1,
                time: 1,
                estimatedTime: 1,
                duration: 1,
                isPopular: 1,
                is_popular: 1,
                isNew: 1,
                is_new: 1
            }
        }).toArray();
        return res.json(maps);
    } catch (error) {
        console.error("Could not load sample maps from MongoDB:", error);
        return res.status(500).json({ message: "Could not load sample maps" });
    }
});

app.get("/api/chatbot/faqs", async (req, res) => {
    const faqsCollection = mongoose.connection.db?.collection("chatbotfaqs");
    if (!faqsCollection) {
        return res.status(503).json({ message: "MongoDB is not connected" });
    }

    try {
        const faqs = await faqsCollection.find({}, {
            projection: {
                _id: 0,
                id: 1,
                title: 1,
                intent: 1,
                keywords: 1,
                response: 1,
                quickReplies: 1
            }
        }).toArray();
        return res.json(faqs);
    } catch (error) {
        console.error("Could not load chatbot FAQs from MongoDB:", error);
        return res.status(500).json({ message: "Could not load chatbot FAQs" });
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

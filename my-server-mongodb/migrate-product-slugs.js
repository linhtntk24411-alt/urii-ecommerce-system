require("dotenv").config();

const mongoose = require("mongoose");

function slugify(value) {
    return value
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .replace(/[đĐ]/g, "d")
        .toLowerCase()
        .trim()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-|-$/g, "");
}

function getProductName(product) {
    return typeof product.name === "string" && product.name.trim()
        ? product.name.trim()
        : typeof product.productName === "string"
            ? product.productName.trim()
            : "";
}

async function migrateProductSlugs() {
    if (!process.env.MONGO_URI) {
        throw new Error("MONGO_URI is not configured");
    }

    await mongoose.connect(process.env.MONGO_URI);
    const productsCollection = mongoose.connection.db.collection("products");
    const products = await productsCollection.find({}).toArray();
    const reservedSlugs = new Set(
        products
            .filter((product) => typeof product.slug === "string" && product.slug.trim())
            .map((product) => product.slug.trim()),
    );
    const alreadyHadSlug = products.filter(
        (product) => typeof product.slug === "string" && product.slug.trim(),
    ).length;
    const updates = [];
    let skipped = 0;

    for (const product of products) {
        if (typeof product.slug === "string" && product.slug.trim()) {
            continue;
        }

        const name = getProductName(product);
        const baseSlug = slugify(name);
        if (!baseSlug) {
            console.warn(`Skipping product ${product._id}: no usable name for slug`);
            skipped++;
            continue;
        }

        let slug = baseSlug;
        if (reservedSlugs.has(slug)) {
            const idSuffix = String(product._id).replace(/[^a-zA-Z0-9]/g, "").slice(-8).toLowerCase();
            slug = `${baseSlug}-${idSuffix}`;
            let suffix = 2;
            while (reservedSlugs.has(slug)) {
                slug = `${baseSlug}-${idSuffix}-${suffix++}`;
            }
        }

        reservedSlugs.add(slug);
        updates.push({
            updateOne: {
                filter: {
                    _id: product._id,
                    $or: [
                        { slug: { $exists: false } },
                        { slug: null },
                        { slug: { $regex: /^\s*$/ } },
                    ],
                },
                update: { $set: { slug } },
            },
        });
    }

    if (updates.length > 0) {
        const result = await productsCollection.bulkWrite(updates, { ordered: true });
        console.log(
            `Product slug migration complete: scanned ${products.length}, `
            + `updated ${result.modifiedCount}, already had slug ${alreadyHadSlug}, skipped ${skipped}.`,
        );
    } else {
        console.log(
            `Product slug migration complete: scanned ${products.length}, updated 0, `
            + `already had slug ${alreadyHadSlug}, skipped ${skipped}.`,
        );
    }
}

migrateProductSlugs()
    .catch((error) => {
        console.error("Product slug migration failed:", error);
        process.exitCode = 1;
    })
    .finally(async () => {
        if (mongoose.connection.readyState !== 0) {
            await mongoose.disconnect();
        }
    });

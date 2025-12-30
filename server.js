require('dotenv').config();
const express = require('express');
const admin = require('firebase-admin');
const cloudinary = require('cloudinary').v2;
const multer = require('multer');
const { Readable } = require('stream');
const path = require('path');

const app = express();
const upload = multer({ storage: multer.memoryStorage() });

// --- 1. إعداد Firebase (حل مشكلة الخطأ 16 في Vercel) ---
try {
    if (!process.env.SERVICE_ACCOUNT_KEY) {
        throw new Error("متغير SERVICE_ACCOUNT_KEY غير موجود في إعدادات البيئة");
    }

    const serviceAccount = JSON.parse(process.env.SERVICE_ACCOUNT_KEY);
    
    // هذا السطر يحل مشكلة الـ Private Key في Vercel نهائياً
    if (serviceAccount.private_key) {
        serviceAccount.private_key = serviceAccount.private_key.replace(/\\n/g, '\n');
    }

    if (!admin.apps.length) {
        admin.initializeApp({
            credential: admin.credential.cert(serviceAccount)
        });
        console.log("✅ تم الاتصال بـ Firebase بنجاح");
    }
} catch (error) {
    console.error("❌ خطأ في إعداد Firebase:", error.message);
}

const db = admin.firestore();

// --- 2. إعداد Cloudinary ---
cloudinary.config({
    cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
    api_key: process.env.CLOUDINARY_API_KEY,
    api_secret: process.env.CLOUDINARY_API_SECRET
});

// --- 3. إعدادات القوالب والملفات ---
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));

// دالة مساعدة لرفع الصور إلى كلوديناري
const uploadToCloudinary = (buffer) => {
    return new Promise((resolve, reject) => {
        const stream = cloudinary.uploader.upload_stream(
            { folder: "fatima_shop" },
            (error, result) => {
                if (error) reject(error);
                else resolve(result.secure_url);
            }
        );
        Readable.from(buffer).pipe(stream);
    });
};

// --- 4. المسارات (Routes) ---

// الصفحة الرئيسية: عرض قائمة الزبائن والمنتجات
app.get('/', async (req, res) => {
    try {
        const snapshot = await db.collection('customers').orderBy('createdAt', 'desc').get();
        const customers = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
        res.render('index', { customers });
    } catch (error) {
        console.error("خطأ أثناء جلب البيانات:", error);
        res.status(500).send("حدث خطأ في الاتصال بقاعدة البيانات: " + error.message);
    }
});

// صفحة إضافة زبون جديد
app.get('/create', (req, res) => {
    res.render('create');
});

// استقبال بيانات الزبون والمنتج الأول
app.post('/add-customer', upload.single('image'), async (req, res) => {
    try {
        const { customerName, productName, price, status } = req.body;
        let imageUrl = "https://via.placeholder.com/150?text=No+Image";

        if (req.file) {
            imageUrl = await uploadToCloudinary(req.file.buffer);
        }

        const newCustomer = {
            name: customerName,
            createdAt: admin.firestore.Timestamp.now(),
            products: [{
                name: productName,
                price: Number(price),
                status: status,
                image: imageUrl,
                date: new Date().toISOString()
            }]
        };

        await db.collection('customers').add(newCustomer);
        res.redirect('/');
    } catch (error) {
        console.error(error);
        res.status(500).send("فشل إضافة الزبون: " + error.message);
    }
});

// إضافة منتج إضافي لزبون موجود مسبقاً
app.post('/add-product/:id', upload.single('image'), async (req, res) => {
    try {
        const customerId = req.params.id;
        const { productName, price, status } = req.body;
        let imageUrl = "https://via.placeholder.com/150?text=No+Image";

        if (req.file) {
            imageUrl = await uploadToCloudinary(req.file.buffer);
        }

        const newProduct = {
            name: productName,
            price: Number(price),
            status: status,
            image: imageUrl,
            date: new Date().toISOString()
        };

        await db.collection('customers').doc(customerId).update({
            products: admin.firestore.FieldValue.arrayUnion(newProduct)
        });

        res.redirect('/');
    } catch (error) {
        res.status(500).send("حدث خطأ أثناء إضافة المنتج: " + error.message);
    }
});

// --- 5. تشغيل السيرفر ---
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`🚀 السيرفر يعمل على الرابط: http://localhost:${PORT}`);
});

// تصدير التطبيق ليعمل على Vercel
module.exports = app;

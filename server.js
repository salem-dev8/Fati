require('dotenv').config();
const express = require('express');
const admin = require('firebase-admin');
const cloudinary = require('cloudinary').v2;
const multer = require('multer');
const { Readable } = require('stream');

const app = express();
const upload = multer({ storage: multer.memoryStorage() });

// --- 1. إعداد Firebase (نسخة محسنة للعمل على Vercel) ---
try {
    const serviceAccount = JSON.parse(process.env.SERVICE_ACCOUNT_KEY);
    
    // هذا السطر هو السر في حل مشكلة الخطأ 16 (UNAUTHENTICATED)
    // يقوم باستبدال رموز \n النصية بأسطر حقيقية يفهمها التشفير
    if (serviceAccount.private_key) {
        serviceAccount.private_key = serviceAccount.private_key.replace(/\\n/g, '\n');
    }

    if (!admin.apps.length) {
        admin.initializeApp({
            credential: admin.credential.cert(serviceAccount)
        });
    }
} catch (error) {
    console.error("خطأ فادح في إعداد فايربيس:", error.message);
}

const db = admin.firestore();

// --- 2. إعداد Cloudinary ---
cloudinary.config({
    cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
    api_key: process.env.CLOUDINARY_API_KEY,
    api_secret: process.env.CLOUDINARY_API_SECRET
});

// --- 3. إعدادات Express و EJS ---
app.set('view engine', 'ejs');
app.use(express.urlencoded({ extended: true }));
app.use(express.static('public'));

// --- وظيفة مساعدة لرفع الصور ---
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

// الصفحة الرئيسية: عرض الزبائن
app.get('/', async (req, res) => {
    try {
        const snapshot = await db.collection('customers').orderBy('createdAt', 'desc').get();
        const customers = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
        res.render('index', { customers });
    } catch (error) {
        console.error("Error fetching customers:", error);
        res.status(500).send("خطأ في الاتصال بقاعدة البيانات: " + error.message);
    }
});

// صفحة إضافة زبون جديد
app.get('/create', (req, res) => {
    res.render('create');
});

// حفظ زبون ومنتج جديد
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
        res.send("فشل في الإضافة: " + error.message);
    }
});

// إضافة منتج لزبون موجود
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
        res.send("حدث خطأ: " + error.message);
    }
});

// تشغيل الخادم
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`Server is running on port ${PORT}`);
});

module.exports = app; // مهم جداً لـ Vercel

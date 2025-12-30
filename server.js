require('dotenv').config();
const express = require('express');
const admin = require('firebase-admin');
const cloudinary = require('cloudinary').v2;
const multer = require('multer');
const { Readable } = require('stream');

const app = express();
const upload = multer({ storage: multer.memoryStorage() }); // للحفظ في الذاكرة مؤقتاً

// 1. إعداد Firebase
// نقوم بقراءة مفتاح الخدمة من ملف .env وتحويله إلى كائن
const serviceAccount = JSON.parse(process.env.SERVICE_ACCOUNT_KEY);

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount)
});
const db = admin.firestore();

// 2. إعداد Cloudinary
cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET
});

// 3. إعدادات Express
app.set('view engine', 'ejs');
app.use(express.urlencoded({ extended: true }));
app.use(express.static('public')); // للملفات الثابتة إن وجدت

// --- الوظائف المساعدة ---
// دالة لرفع الصورة إلى Cloudinary
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

// --- الروابط (Routes) ---

// الصفحة الرئيسية: عرض الزبائن
app.get('/', async (req, res) => {
  try {
    const snapshot = await db.collection('customers').orderBy('createdAt', 'desc').get();
    const customers = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
    res.render('index', { customers });
  } catch (error) {
    console.error(error);
    res.send("حدث خطأ أثناء تحميل البيانات");
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
    let imageUrl = "https://via.placeholder.com/150?text=No+Image"; // صورة افتراضية

    if (req.file) {
      imageUrl = await uploadToCloudinary(req.file.buffer);
    }

    const newCustomer = {
      name: customerName,
      createdAt: admin.firestore.Timestamp.now(),
      products: [{
        name: productName,
        price: Number(price),
        status: status, // 'paid' or 'unpaid'
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

// إضافة منتج لزبون موجود مسبقاً
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

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));

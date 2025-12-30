require('dotenv').config();
const express = require('express');
const path = require('path');
const admin = require('firebase-admin');
const cloudinary = require('cloudinary').v2;
const multer = require('multer');
const { Readable } = require('stream');

const app = express();
const upload = multer({ storage: multer.memoryStorage() });

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'views')));

// Serve single-page app
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'views', 'index.html'));
});

// Initialize Firebase Admin
if (!process.env.SERVICE_ACCOUNT_KEY) {
  console.error('SERVICE_ACCOUNT_KEY is missing in .env');
  process.exit(1);
}
const serviceAccount = JSON.parse(process.env.SERVICE_ACCOUNT_KEY);

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount)
});
const db = admin.firestore();

// Configure Cloudinary
cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME || '',
  api_key: process.env.CLOUDINARY_API_KEY || '',
  api_secret: process.env.CLOUDINARY_API_SECRET || ''
});

// Helper: upload buffer to Cloudinary
const uploadToCloudinary = (buffer) => {
  return new Promise((resolve, reject) => {
    if (!buffer) return resolve(null);
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

// API: Get customers
app.get('/api/customers', async (req, res) => {
  try {
    const snapshot = await db.collection('customers').orderBy('createdAt', 'desc').get();
    const customers = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
    res.json({ success: true, customers });
  } catch (error) {
    console.error(error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// API: Create new customer (with first product)
app.post('/api/customers', upload.single('image'), async (req, res) => {
  try {
    const { customerName, productName, price, status } = req.body;
    if (!customerName || !productName) {
      return res.status(400).json({ success: false, error: 'الحقول المطلوبة ناقصة' });
    }

    let imageUrl = 'https://via.placeholder.com/300x300?text=No+Image';
    if (req.file && req.file.buffer) {
      try {
        const uploaded = await uploadToCloudinary(req.file.buffer);
        if (uploaded) imageUrl = uploaded;
      } catch (err) {
        console.warn('Cloudinary upload failed, using placeholder', err.message);
      }
    }

    const productId = Date.now().toString() + Math.random().toString(36).slice(2, 8);

    const newCustomer = {
      name: customerName,
      createdAt: admin.firestore.Timestamp.now(),
      products: [{
        id: productId,
        name: productName,
        price: Number(price) || 0,
        status: status === 'paid' ? 'paid' : 'unpaid',
        image: imageUrl,
        date: new Date().toISOString()
      }]
    };

    const docRef = await db.collection('customers').add(newCustomer);
    const doc = await docRef.get();
    res.json({ success: true, customer: { id: doc.id, ...doc.data() } });
  } catch (error) {
    console.error(error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// API: Add product to existing customer
app.post('/api/customers/:id/products', upload.single('image'), async (req, res) => {
  try {
    const customerId = req.params.id;
    const { productName, price, status } = req.body;
    if (!productName) return res.status(400).json({ success: false, error: 'اسم المنتج مطلوب' });

    let imageUrl = 'https://via.placeholder.com/300x300?text=No+Image';
    if (req.file && req.file.buffer) {
      try {
        const uploaded = await uploadToCloudinary(req.file.buffer);
        if (uploaded) imageUrl = uploaded;
      } catch (err) {
        console.warn('Cloudinary upload failed, using placeholder', err.message);
      }
    }

    const productId = Date.now().toString() + Math.random().toString(36).slice(2, 8);
    const newProduct = {
      id: productId,
      name: productName,
      price: Number(price) || 0,
      status: status === 'paid' ? 'paid' : 'unpaid',
      image: imageUrl,
      date: new Date().toISOString()
    };

    await db.collection('customers').doc(customerId).update({
      products: admin.firestore.FieldValue.arrayUnion(newProduct)
    });

    const updatedDoc = await db.collection('customers').doc(customerId).get();
    res.json({ success: true, customer: { id: updatedDoc.id, ...updatedDoc.data() } });
  } catch (error) {
    console.error(error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// API: Change payment status for a product
app.post('/api/customers/:id/change-payment', async (req, res) => {
  try {
    const customerId = req.params.id;
    const { productId, newStatus } = req.body;

    if (!productId || !newStatus) {
      return res.status(400).json({ success: false, error: 'معلومات ناقصة' });
    }

    const docRef = db.collection('customers').doc(customerId);
    const doc = await docRef.get();
    if (!doc.exists) return res.status(404).json({ success: false, error: 'الزبون غير موجود' });

    const data = doc.data();
    const products = Array.isArray(data.products) ? data.products : [];

    const updatedProducts = products.map(p => {
      if (p.id === productId) {
        return { ...p, status: newStatus === 'paid' ? 'paid' : 'unpaid' };
      }
      return p;
    });

    await docRef.update({ products: updatedProducts });

    res.json({ success: true, products: updatedProducts });
  } catch (error) {
    console.error(error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// API: Delete Customer (New Added Route)
app.delete('/api/customers/:id', async (req, res) => {
  try {
    const customerId = req.params.id;
    await db.collection('customers').doc(customerId).delete();
    res.json({ success: true, message: 'Customer deleted successfully' });
  } catch (error) {
    console.error(error);
    res.status(500).json({ success: false, error: error.message });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));

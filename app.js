'use strict';

// Đọc biến môi trường trước khi sử dụng.
require('dotenv').config();

const express = require('express');
const path = require('path');
const multer = require('multer');
const session = require('express-session');
const rateLimit = require('express-rate-limit');
const helmet = require('helmet');
const crypto = require('crypto');

const app = express();
const isProduction = process.env.NODE_ENV === 'production';

/*
 * =====================================================
 * KIỂM TRA BIẾN MÔI TRƯỜNG
 * =====================================================
 */
if (!process.env.SESSION_SECRET) {
    throw new Error('Thiếu biến môi trường SESSION_SECRET. Hãy thêm SESSION_SECRET vào file .env và Render.');
}

/*
 * Render chạy phía sau reverse proxy.
 */
app.set('trust proxy', 1);

/*
 * Không để Express tiết lộ công nghệ.
 */
app.disable('x-powered-by');

/*
 * =====================================================
 * TẠO CSP NONCE CHO JAVASCRIPT NỘI TUYẾN
 * =====================================================
 */
app.use((req, res, next) => {
    res.locals.cspNonce = crypto.randomBytes(32).toString('base64');
    next();
});

/*
 * Hàm tạo nonce tương ứng với từng response.
 */
const getCspNonce = (req, res) => `'nonce-${res.locals.cspNonce}'`;

/*
 * =====================================================
 * CẤU HÌNH HELMET VÀ CSP
 * =====================================================
 *
 * Toàn bộ CSS của dự án được tải từ thư mục Public.
 * Bootstrap Modal và Toast dùng CSS tĩnh trong thư mục Public.
 * JavaScript nội tuyến trong EJS vẫn phải có nonce.
 */
app.use(
    helmet({
        contentSecurityPolicy: {
            useDefaults: false,
            directives: {
                'default-src': ["'self'"],
                'script-src': ["'self'", getCspNonce],
                'script-src-attr': ["'none'"],
                'style-src': ["'self'"],
                'style-src-elem': ["'self'"],

                /*
                 * Bootstrap, MapLibre và một số thành phần giao diện
                 * cần thay đổi thuộc tính style trong lúc chạy.
                 */
                'style-src-attr': ["'unsafe-inline'"],
                'font-src': ["'self'", 'data:'],
                'img-src': ["'self'", 'data:', 'blob:', 'https://tiles.goong.io'],
                'connect-src': ["'self'", 'https://tiles.goong.io', 'https://rsapi.goong.io'],
                'worker-src': ["'self'", 'blob:'],
                'object-src': ["'none'"],
                'base-uri': ["'self'"],
                'form-action': ["'self'"],
                'frame-ancestors': ["'none'"],
                'upgrade-insecure-requests': isProduction ? [] : null
            }
        },
        strictTransportSecurity: {
            maxAge: 31536000, // ghi nhớ chính sách HTTPS 1 năm
            includeSubDomains: true, // áp dụng cho các tên miền con
        }
    })
);

/*
 * Chống trình duyệt đoán sai MIME type.
 */
app.use(helmet.xContentTypeOptions());

/*
 * Header dùng để kiểm tra server đã chạy bản mới.
 */
app.use((req, res, next) => {
    res.setHeader('X-CSP-Build', 'bootstrap-ui-v2');
    next();
});

/*
 * =====================================================
 * ĐỌC REQUEST BODY
 * =====================================================
 */
app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: true, limit: '1mb' }));

/*
 * =====================================================
 * SESSION
 * =====================================================
 */
app.use(
    session({
        name: 'app_session_id',
        secret: process.env.SESSION_SECRET,
        proxy: true,
        resave: false,
        saveUninitialized: false,
        cookie: {
            httpOnly: true,
            secure: isProduction,
            sameSite: 'lax',
            path: '/',
            maxAge: 1000 * 60 * 60 * 24 * 7
        }
    })
);

/*
 * =====================================================
 * KHÔNG CACHE TRANG NHẠY CẢM
 * =====================================================
 */
const noCachePaths = new Set([
    '/login',
    '/logout',
    '/admin/login',
    '/bacSi/login',
    '/bacsi/login',
    '/khachHangTaoTaiKhoan',
    '/thayDoiThongTin',
    '/capNhatThongTin',
    '/lichSuDatLichKham',
    '/thongTinLichKham',
    '/sitemap.xml'
]);

app.use((req, res, next) => {
    if (noCachePaths.has(req.path)) {
        res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, private');
        res.setHeader('Pragma', 'no-cache');
        res.setHeader('Expires', '0');
        res.setHeader('Surrogate-Control', 'no-store');
    }

    next();
});

/*
 * =====================================================
 * CHỐNG CLICKJACKING
 * =====================================================
 */
app.use((req, res, next) => {
    res.setHeader('X-Frame-Options', 'DENY');
    next();
});

/*
 * =====================================================
 * RATE LIMIT
 * =====================================================
 */
const limiter = rateLimit({
    windowMs: 1 * 60 * 1000,
    max: 1000,
    handler: (req, res) => res.status(429).type('text/plain').send('Bạn gửi quá nhiều yêu cầu, vui lòng thử lại sau.'),
    standardHeaders: true,
    legacyHeaders: false
});

app.use(limiter);

/*
 * =====================================================
 * MULTER
 * =====================================================
 */
const storage = multer.memoryStorage();
const upload = multer({ storage, limits: { fileSize: 5 * 1024 * 1024 } });
app.locals.upload = upload;

/*
 * =====================================================
 * BIẾN DÙNG CHUNG CHO EJS
 * =====================================================
 */
app.use((req, res, next) => {
    res.locals.user = req.session.user || null;
    res.locals.page = '';
    res.locals.uiMessage = null;
    next();
});

/*
 * =====================================================
 * VIEW ENGINE
 * =====================================================
 */
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

/*
 * =====================================================
 * HEADER CHO FILE TĨNH
 * =====================================================
 */
const secureStaticHeaders = (res) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
};

/*
 * =====================================================
 * PUBLIC
 * =====================================================
 */
app.use(express.static(path.join(__dirname, 'Public'), { setHeaders: secureStaticHeaders }));



/*
 * =====================================================
 * NODE_MODULES VENDOR
 * =====================================================
 */
const vendorStaticOptions = {
    maxAge: isProduction ? '7d' : 0,
    setHeaders: secureStaticHeaders
};

/*
 * Bootstrap
 */
app.use('/vendor/bootstrap', express.static(path.join(__dirname, 'node_modules', 'bootstrap', 'dist'), vendorStaticOptions));

/*
 * Font Awesome
 */
app.use('/vendor/fontawesome', express.static(path.join(__dirname, 'node_modules', '@fortawesome', 'fontawesome-free'), vendorStaticOptions));

/*
 * MapLibre GL
 */
app.use('/vendor/maplibre', express.static(path.join(__dirname, 'node_modules', 'maplibre-gl', 'dist'), vendorStaticOptions));

/*
 * Mapbox Polyline
 */
app.use('/vendor/polyline', express.static(path.join(__dirname, 'node_modules', '@mapbox', 'polyline', 'src'), vendorStaticOptions));

/*
 * Flatpickr
 */
app.use('/vendor/flatpickr', express.static(path.join(__dirname, 'node_modules', 'flatpickr', 'dist'), vendorStaticOptions));

/*
 * Chart.js
 */
app.use('/vendor/chartjs', express.static(path.join(__dirname, 'node_modules', 'chart.js', 'dist'), vendorStaticOptions));

/*
 * html2canvas
 */
app.use('/vendor/html2canvas', express.static(path.join(__dirname, 'node_modules', 'html2canvas', 'dist'), vendorStaticOptions));

/*
 * Axios
 */
app.use('/vendor/axios', express.static(path.join(__dirname, 'node_modules', 'axios', 'dist'), vendorStaticOptions));

/*
 * =====================================================
 * FLASH MESSAGE CHỈ BỊ LẤY KHI EJS THỰC SỰ RENDER
 * =====================================================
 *
 * Không xóa req.session.uiMessage khi trình duyệt tải ảnh, CSS, JS,
 * favicon, gọi API hoặc đi qua một redirect. Điều này tránh thông báo
 * thanh toán bị request phụ lấy mất trước trang kết quả.
 */
app.use((req, res, next) => {
    const originalRender = res.render.bind(res);

    res.render = (view, options, callback) => {
        res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, private');
        res.locals.uiMessage = req.session.uiMessage || null;

        if (req.session.uiMessage) delete req.session.uiMessage;

        return originalRender(view, options, callback);
    };

    next();
});

/*
 * =====================================================
 * ROUTER
 * =====================================================
 */
const adminRoute = require('./routes/admin');
const chatbotRoute = require('./routes/chatbot');
const homeRoute = require('./routes/khachHang');
const bacSiRoute = require('./routes/bacSi');

app.use('/admin', adminRoute);
app.use('/chatbot', chatbotRoute);
app.use('/', homeRoute);
app.use('/bacSi', bacSiRoute);

/*
 * =====================================================
 * 404 khong tim thay trang
 * =====================================================
 */
app.use((req, res) => res.status(404).type('text/plain').send('Không tìm thấy trang.'));

/*
 * =====================================================
 * ERROR HANDLER
 * =====================================================
 */
app.use((error, req, res, next) => {
    console.error('Lỗi ứng dụng:', error);
    if (res.headersSent) return next(error);
    return res.status(500).type('text/plain').send('Lỗi Server. Vui lòng thử lại sau.');
});

/*
 * =====================================================
 * KHỞI ĐỘNG SERVER
 * =====================================================
 */
const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
    console.log(`Server đang chạy tại cổng ${PORT}`);
    console.log(`NODE_ENV: ${process.env.NODE_ENV}`);
});
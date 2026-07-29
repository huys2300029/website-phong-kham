// Đọc biến môi trường trước khi sử dụng
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
 * Kiểm tra biến môi trường quan trọng.
 */
if (!process.env.SESSION_SECRET) {
    throw new Error(
        'Thiếu biến môi trường SESSION_SECRET. ' +
        'Hãy thêm SESSION_SECRET vào file .env và Render.'
    );
}

/*
 * Render chạy phía sau reverse proxy.
 * Cần đặt trước express-session để Express nhận biết HTTPS.
 */
app.set('trust proxy', 1);

/*
 * Không để Express tiết lộ công nghệ đang sử dụng
 * qua header X-Powered-By.
 */
app.disable('x-powered-by');

/*
 * =====================================================
 * TẠO CSP NONCE CHO MỖI PHẢN HỒI
 * =====================================================
 *
 * Sử dụng trong EJS:
 *
 * <script nonce="<%= cspNonce %>">
 *     // JavaScript nội tuyến
 * </script>
 *
 * <style nonce="<%= cspNonce %>">
 *     // CSS nội tuyến
 * </style>
 */
app.use((req, res, next) => {
    res.locals.cspNonce = crypto
        .randomBytes(32)
        .toString('base64');

    next();
});

/*
 * =====================================================
 * CẤU HÌNH HTTP SECURITY HEADERS
 * =====================================================
 *
 * useDefaults: false để Helmet không tự bổ sung
 * style-src 'unsafe-inline' từ chính sách mặc định.
 */
app.use(
    helmet({
        contentSecurityPolicy: {
            useDefaults: false,

            directives: {
                'default-src': [
                    "'self'"
                ],

                'script-src': [
                    "'self'",

                    (req, res) =>
                        `'nonce-${res.locals.cspNonce}'`
                ],

                'script-src-attr': [
                    "'none'"
                ],

                'style-src': [
                    "'self'",

                    (req, res) =>
                        `'nonce-${res.locals.cspNonce}'`
                ],

                'style-src-elem': [
                    "'self'",

                    (req, res) =>
                        `'nonce-${res.locals.cspNonce}'`
                ],

                'style-src-attr': [
                    "'none'"
                ],

                'font-src': [
                    "'self'",
                    'data:'
                ],

                'img-src': [
                    "'self'",
                    'data:',
                    'blob:',
                    'https://tiles.goong.io'
                ],

                'connect-src': [
                    "'self'",
                    'https://tiles.goong.io',
                    'https://rsapi.goong.io'
                ],

                'worker-src': [
                    "'self'",
                    'blob:'
                ],

                'object-src': [
                    "'none'"
                ],

                'base-uri': [
                    "'self'"
                ],

                'form-action': [
                    "'self'"
                ],

                'frame-ancestors': [
                    "'none'"
                ],

                'upgrade-insecure-requests':
                    isProduction
                        ? []
                        : null
            }
        },

        strictTransportSecurity:
            isProduction
                ? {
                      maxAge: 31536000,
                      includeSubDomains: true,
                      preload: false
                  }
                : false
    })
);

/*
 * =====================================================
 * CHỐNG MIME SNIFFING
 * =====================================================
 *
 * Buộc mọi phản hồi có header:
 *
 * X-Content-Type-Options: nosniff
 *
 * Helmet mặc định đã thiết lập header này.
 * Khai báo riêng để bảo đảm nó vẫn được áp dụng
 * nếu cấu hình Helmet thay đổi về sau.
 */
app.use(
    helmet.xContentTypeOptions()
);

/*
 * Header tạm dùng để xác nhận Render đang chạy
 * đúng bản app.js này.
 *
 * Sau khi kiểm tra xong có thể xóa middleware này.
 */
app.use((req, res, next) => {
    res.setHeader(
        'X-CSP-Build',
        'strict-style-v3'
    );

    next();
});

/*
 * =====================================================
 * ĐỌC DỮ LIỆU REQUEST
 * =====================================================
 */
app.use(
    express.json({
        limit: '1mb'
    })
);

app.use(
    express.urlencoded({
        extended: true,
        limit: '1mb'
    })
);

/*
 * =====================================================
 * CẤU HÌNH SESSION
 * =====================================================
 */
app.use(
    session({
        name: 'connect.sid',

        secret: process.env.SESSION_SECRET,

        proxy: true,

        resave: false,

        saveUninitialized: false,

        cookie: {
            httpOnly: true,

            secure: isProduction,

            sameSite: 'lax',

            path: '/',

            maxAge:
                1000 *
                60 *
                60 *
                24 *
                7
        }
    })
);

/*
 * =====================================================
 * KHÔNG CACHE CÁC TRANG NHẠY CẢM
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
    '/sitemap.xml'
]);

app.use((req, res, next) => {
    if (noCachePaths.has(req.path)) {
        res.setHeader(
            'Cache-Control',
            'no-store, no-cache, must-revalidate, private'
        );

        res.setHeader(
            'Pragma',
            'no-cache'
        );

        res.setHeader(
            'Expires',
            '0'
        );

        res.setHeader(
            'Surrogate-Control',
            'no-store'
        );
    }

    next();
});

/*
 * =====================================================
 * CHỐNG CLICKJACKING
 * =====================================================
 */
app.use((req, res, next) => {
    res.setHeader(
        'X-Frame-Options',
        'DENY'
    );

    next();
});

/*
 * =====================================================
 * GIỚI HẠN SỐ LƯỢNG REQUEST
 * =====================================================
 */
const limiter = rateLimit({
    windowMs:
        15 *
        60 *
        1000,

    max: 10000,

    /*
     * Đặt rõ Content-Type cho phản hồi 429.
     */
    handler: (req, res) => {
        return res
            .status(429)
            .type('text/plain')
            .send(
                'Bạn gửi quá nhiều yêu cầu, ' +
                'vui lòng thử lại sau.'
            );
    },

    standardHeaders: true,

    legacyHeaders: false
});

app.use(limiter);

/*
 * =====================================================
 * CẤU HÌNH MULTER
 * =====================================================
 */
const storage =
    multer.memoryStorage();

const upload = multer({
    storage,

    limits: {
        fileSize:
            5 *
            1024 *
            1024
    }
});

app.locals.upload = upload;

/*
 * =====================================================
 * BIẾN DÙNG CHUNG CHO EJS
 * =====================================================
 */
app.use((req, res, next) => {
    res.locals.user =
        req.session.user ||
        null;

    res.locals.page = '';

    next();
});

/*
 * =====================================================
 * CẤU HÌNH VIEW ENGINE
 * =====================================================
 */
app.set(
    'view engine',
    'ejs'
);

app.set(
    'views',
    path.join(
        __dirname,
        'views'
    )
);

/*
 * =====================================================
 * HEADER CHO FILE TĨNH
 * =====================================================
 *
 * express.static tự xác định Content-Type dựa trên
 * phần mở rộng của file.
 *
 * Middleware này bổ sung nosniff cho mọi file tĩnh.
 */
const secureStaticHeaders = (res) => {
    res.setHeader(
        'X-Content-Type-Options',
        'nosniff'
    );
};

/*
 * =====================================================
 * PHỤC VỤ FILE TRONG PUBLIC
 * =====================================================
 */
app.use(
    express.static(
        path.join(
            __dirname,
            'Public'
        ),
        {
            setHeaders:
                secureStaticHeaders
        }
    )
);

/*
 * =====================================================
 * PHỤC VỤ THƯ VIỆN NỘI BỘ
 * =====================================================
 */
const vendorStaticOptions = {
    maxAge:
        isProduction
            ? '7d'
            : 0,

    setHeaders:
        secureStaticHeaders
};

/*
 * Bootstrap
 */
app.use(
    '/vendor/bootstrap',

    express.static(
        path.join(
            __dirname,
            'node_modules',
            'bootstrap',
            'dist'
        ),

        vendorStaticOptions
    )
);

/*
 * SweetAlert2
 */
app.use(
    '/vendor/sweetalert2',

    express.static(
        path.join(
            __dirname,
            'node_modules',
            'sweetalert2',
            'dist'
        ),

        vendorStaticOptions
    )
);

/*
 * Font Awesome
 */
app.use(
    '/vendor/fontawesome',

    express.static(
        path.join(
            __dirname,
            'node_modules',
            '@fortawesome',
            'fontawesome-free'
        ),

        vendorStaticOptions
    )
);

/*
 * MapLibre GL
 */
app.use(
    '/vendor/maplibre',

    express.static(
        path.join(
            __dirname,
            'node_modules',
            'maplibre-gl',
            'dist'
        ),

        vendorStaticOptions
    )
);

/*
 * Mapbox Polyline
 */
app.use(
    '/vendor/polyline',

    express.static(
        path.join(
            __dirname,
            'node_modules',
            '@mapbox',
            'polyline',
            'src'
        ),

        vendorStaticOptions
    )
);

/*
 * Flatpickr
 */
app.use(
    '/vendor/flatpickr',

    express.static(
        path.join(
            __dirname,
            'node_modules',
            'flatpickr',
            'dist'
        ),

        vendorStaticOptions
    )
);

/*
 * Chart.js
 */
app.use(
    '/vendor/chartjs',

    express.static(
        path.join(
            __dirname,
            'node_modules',
            'chart.js',
            'dist'
        ),

        vendorStaticOptions
    )
);

/*
 * html2canvas
 */
app.use(
    '/vendor/html2canvas',

    express.static(
        path.join(
            __dirname,
            'node_modules',
            'html2canvas',
            'dist'
        ),

        vendorStaticOptions
    )
);

/*
 * Axios dành cho JavaScript trình duyệt
 */
app.use(
    '/vendor/axios',

    express.static(
        path.join(
            __dirname,
            'node_modules',
            'axios',
            'dist'
        ),

        vendorStaticOptions
    )
);

/*
 * =====================================================
 * KHAI BÁO ROUTER
 * =====================================================
 */
const adminRoute =
    require('./routes/admin');

const chatbotRoute =
    require('./routes/chatbot');

const homeRoute =
    require('./routes/khachHang');

const bacSiRoute =
    require('./routes/bacSi');

app.use(
    '/admin',
    adminRoute
);

app.use(
    '/chatbot',
    chatbotRoute
);

app.use(
    '/',
    homeRoute
);

app.use(
    '/bacSi',
    bacSiRoute
);

/*
 * =====================================================
 * XỬ LÝ ROUTE KHÔNG TỒN TẠI
 * =====================================================
 *
 * Đặt rõ Content-Type là text/plain.
 */
app.use((req, res) => {
    return res
        .status(404)
        .type('text/plain')
        .send(
            'Không tìm thấy trang.'
        );
});

/*
 * =====================================================
 * XỬ LÝ LỖI CHUNG
 * =====================================================
 *
 * Đặt rõ Content-Type là text/plain.
 */
app.use((error, req, res, next) => {
    console.error(
        'Lỗi ứng dụng:',
        error
    );

    if (res.headersSent) {
        return next(error);
    }

    return res
        .status(500)
        .type('text/plain')
        .send(
            'Lỗi Server. ' +
            'Vui lòng thử lại sau.'
        );
});

/*
 * =====================================================
 * KHỞI ĐỘNG SERVER
 * =====================================================
 */
const PORT =
    process.env.PORT ||
    3000;

app.listen(PORT, () => {
    console.log(
        `Server đang chạy tại cổng ${PORT}`
    );

    console.log(
        `NODE_ENV: ${
            process.env.NODE_ENV ||
            'development'
        }`
    );

    console.log(
        `Secure cookie: ${isProduction}`
    );

    console.log(
        'CSP strict-style-v3 và MIME nosniff đã được bật.'
    );
});
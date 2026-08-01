const express = require('express');
const multer = require('multer');
const path = require('path');

// Tạo ra đối tượng "Router"
const router = express.Router();

// Import file controller vao
const kiemTraDangNhap = require("../controllers/quanLy/kiemTraDangNhap");
const quanLyBacSi = require("../controllers/quanLy/quanLyBacSi");
const quanLyPhongKham = require('../controllers/quanLy/quanLyPhongKham');
const quanLyCaKham = require('../controllers/quanLy/quanLyCaKham');
const quanLyNguoiDung = require('../controllers/quanLy/quanLyNguoiDung');
const demThongBaoAdmin = require('../controllers/quanLy/demThongBaoAdmin');
const thongBaoAdmin = require('../controllers/quanLy/thongBaoAdmin');
const thongKe = require('../controllers/quanLy/thongKe');

// --- CẤU HÌNH MULTER (Dùng chung cho cả Excel và Hình ảnh) ---
const storage = multer.diskStorage({
    destination: function (req, file, cb) {
        cb(null, 'Public/uploads/') // Thư mục lưu file mặc định
    },
    filename: function (req, file, cb) {
        // Tạo tên file ngẫu nhiên để không bị trùng lặp khi upload nhiều file
        cb(null, Date.now() + '-' + Math.round(Math.random() * 1E9) + path.extname(file.originalname));
    }
});
const upload = multer({ storage: storage });

//Khi user truy cap vao /admin/login
router.get('/login', kiemTraDangNhap.getLoginAdmin);
router.post('/login', kiemTraDangNhap.postLoginAdmin);
router.get('/', (req, res) => {
    if (req.session.user) {
        // Đã đăng nhập → vào dashboard
        return res.redirect('/admin/trangChu');
    } else {
        // Chưa đăng nhập → vào login
        return res.redirect('/admin/login');
    }
});

//Dang xuat
router.get('/logout', kiemTraDangNhap.getLogoutAdmin);

//Kiem tra session (Áp dụng cho TOÀN BỘ các route bên dưới)
router.use(kiemTraDangNhap.kiemTraDangNhap);

// --- QUAN TRỌNG: Hàm đếm thông báo phải nằm ngay đây để áp dụng cho mọi trang ---
router.use(demThongBaoAdmin); 

//Trang chu
router.get('/trangChu', kiemTraDangNhap.getDashboard);

// ------------- Quan ly bac si --------------------
router.get('/quanLyBacSi', quanLyBacSi.getDanhSachBacSi);
router.get('/themBacSi', quanLyBacSi.getThemBacSi);

// Đã loại bỏ middleware upload cũ vì controller tự đảm nhận lưu vào thư mục anhBacSi
router.post('/themBacSi', quanLyBacSi.postThemBacSi);

router.get('/suaBacSi/:id', quanLyBacSi.getSuaBacSi);

// Đã loại bỏ middleware upload cũ vì controller tự đảm nhận lưu vào thư mục anhBacSi
router.post('/suaBacSi/:id', quanLyBacSi.postSuaBacSi);

router.get('/xoaBacSi/:id', quanLyBacSi.postXoaBacSi);

// ------------- Quan Ly Phong Kham --------------------
router.get('/xoaViTri/:soPhong', quanLyPhongKham.xoaViTri);
router.get('/quanLyPhongKham', quanLyPhongKham.getQuanLyPhongKham);
router.get('/themPhongMoi', quanLyPhongKham.getThemPhongMoi);
router.post('/themPhongMoi', quanLyPhongKham.postThemPhongMoi);

// ------------- Quản lý ca khám --------------------
router.get('/quanLyCaKham', quanLyCaKham.getQuanLyCaKham);
router.post('/importExcel', quanLyCaKham.postImportExcel);
router.post('/updateCaTruc', quanLyCaKham.postUpdateCaTruc);
router.get('/api/get-bacsi-by-khoa/:idKhoa', quanLyCaKham.getBacSi);
router.post('/quanLyCaKham/update', quanLyCaKham.updateBacSiCaKham);

// ------------- Quan Ly Nguoi Dung --------------------
router.get('/quanLyNguoiDung', quanLyNguoiDung.getDanhSachNguoiDung);
router.get('/themNguoiDung', quanLyNguoiDung.getThemNguoiDung);
router.post('/themNguoiDung', quanLyNguoiDung.postThemNguoiDung);
router.get('/suaNguoiDung/:id', quanLyNguoiDung.getSuaNguoiDung);
router.post('/suaNguoiDung/:id', quanLyNguoiDung.postSuaNguoiDung);
router.get('/xoaNguoiDung/:id', quanLyNguoiDung.xoaNguoiDung);

// ------------- Quan Ly thong bao va duyet lich --------------------
// 1. Route hiển thị trang danh sách thông báo
router.get('/thongBao', thongBaoAdmin.getDanhSachThongBao);

// 2. API Đánh dấu thông báo đã đọc
router.post('/thongBao/danhDauDaDoc/:id', thongBaoAdmin.danhDauDaDoc);

// 3. API Lấy chi tiết yêu cầu để hiện lên SweetAlert2
router.get('/thongBao/chiTietYeuCau/:id', thongBaoAdmin.getChiTietYeuCau);

// 4. API Xử lý duyệt/từ chối yêu cầu đổi lịch
router.post('/thongBao/xuLyYeuCau', thongBaoAdmin.xuLyYeuCau);

// 5. Thêm dòng này vào phần quản lý thông báo
router.get('/thongBao/api-dem-moi', thongBaoAdmin.apiDemThongBaoChuaDoc);

// ------------- Thống kê --------------------
router.get('/thongKe', thongKe.getThongKe);

//"Đóng gói" để xuất bản
module.exports = router;
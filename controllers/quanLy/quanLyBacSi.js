const con = require('../../config/connectDatabase');

// Tạo hàm query dùng Promise từ biến con
const query = async (sql, params = []) => {
    const [rows] = await con.promise().query(sql, params);
    return rows;
};

const multer = require('multer');
const path = require('path');
const fs = require('fs');

// Cấu hình lưu trữ multer dành riêng cho ảnh Bác sĩ
const storageBacSi = multer.diskStorage({
    destination: function (req, file, cb) {
        // Định vị chính xác thư mục anhBacSi dựa trên vị trí của file controller này
        const dir = path.join(__dirname, '../../Public/uploads/anhBacSi');
        
        // Tự động tạo thư mục nếu chưa tồn tại
        if (!fs.existsSync(dir)) {
            fs.mkdirSync(dir, { recursive: true });
        }
        cb(null, dir);
    },
    filename: function (req, file, cb) {
        // Đổi tên file để tránh trùng lặp: Thời gian + Số ngẫu nhiên + Đuôi file gốc
        const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
        cb(null, uniqueSuffix + path.extname(file.originalname));
    }
});

// Khởi tạo middleware upload (Tên trường file mặc định trong form EJS là 'hinhAnh')
const uploadBacSi = multer({ storage: storageBacSi }).single('hinhAnh');

// 1. Hàm phụ trợ: Kiểm tra tài khoản tồn tại (Trả về Promise)
const kiemTraDangNhap = (tenDangNhap) => {
    return new Promise((resolve, reject) => {
        const sql = "SELECT * FROM NguoiDung WHERE tenDangNhap = ?";
        con.query(sql, [tenDangNhap], (err, result) => {
            if (err) return reject(err);
            // Trả về true nếu tìm thấy, false nếu không
            resolve(result.length > 0); 
        });
    });
};

// 2. Hàm phụ trợ: Lấy danh sách Khoa (Để tái sử dụng, tránh viết lặp lại)
const getDanhSachKhoa = () => {
    return new Promise((resolve, reject) => {
        con.query("SELECT * FROM ChuyenKhoa", (err, data) => {
            if (err) return reject(err);
            resolve(data);
        });
    });
};

// --- CÁC CONTROLLER ---
const getDanhSachBacSi = (req, res) => {
    // 1. Lấy số trang hiện tại từ URL (nếu không có thì mặc định là trang 1)
    const page = parseInt(req.query.page) || 1;
    const limit = 10; // Số bác sĩ mỗi trang
    const offset = (page - 1) * limit; // Vị trí bắt đầu lấy dữ liệu

    // 2. Truy vấn đếm tổng số lượng bác sĩ để tính số trang
    const countSql = "SELECT COUNT(*) AS total FROM NguoiDung WHERE vaiTro = 'BacSi'";
    
    con.query(countSql, (err, countResult) => {
        if (err) {
            console.error("Lỗi đếm số lượng:", err);
            return res.status(500).send("Lỗi server");
        }

        const totalRecords = countResult[0].total;
        const totalPages = Math.ceil(totalRecords / limit); // Làm tròn lên để ra tổng số trang

        // 3. Truy vấn lấy đúng 10 bác sĩ cho trang hiện tại
        const sql = `
            SELECT NguoiDung.id, NguoiDung.hoTen, BacSi.trinhDo, BacSi.namTotNghiep, BacSi.chiTiet, BacSi.hinhAnh, ChuyenKhoa.tenChuyenKhoa 
            FROM NguoiDung 
            JOIN BacSi ON NguoiDung.id = BacSi.id
            LEFT JOIN ChuyenKhoa ON BacSi.id_chuyenKhoa = ChuyenKhoa.id_chuyenKhoa 
            WHERE NguoiDung.vaiTro = 'BacSi'
            LIMIT ? OFFSET ?
        `;

        // Truyền limit và offset vào câu lệnh SQL
        con.query(sql, [limit, offset], (err, results) => {
            if (err) {
                console.error("Lỗi truy vấn:", err);
                return res.status(500).send("Lỗi server");
            }
            
            // Render giao diện và truyền thêm thông tin phân trang
            res.render('admin/quanLyBacSi/quanLyBacSi', { 
                danhSach: results,
                currentPage: page,      // Trang hiện tại
                totalPages: totalPages, // Tổng số trang
                path: 'quanLyBacSi'
            });
        });
    });
};

const getThemBacSi = (req, res) => {
    const sql = "SELECT * FROM ChuyenKhoa"; 
    con.query(sql, (err, data) => {
        if (err) return res.status(500).send("Lỗi lấy dữ liệu khoa");
        
        res.render('admin/quanLyBacSi/themBacSi', { 
            pageTitle: 'Thêm Bác Sĩ Mới',
            dsKhoa: data,
            oldData: {}, // Khởi tạo rỗng để không lỗi view
            msg: ''
        });
    });
}

// Xử lý Thêm Bác Sĩ
const postThemBacSi = async (req, res) => {
    // Chạy middleware upload ảnh bác sĩ trước khi xử lý logic dữ liệu
    uploadBacSi(req, res, async (err) => {
        if (err) {
            console.error("Lỗi tải ảnh bác sĩ:", err);
            return res.status(500).send("Lỗi tải tệp tin lên hệ thống.");
        }

        // Lấy dữ liệu text sau khi đã qua multer giải mã bộ lọc dữ liệu
        const { 
            tenDangNhap, matKhau, hoTen, email, soDienThoai, 
            trinhDo, namTotNghiep, chiTiet, id_chuyenKhoa 
        } = req.body;

        // Lấy tên file hình ảnh (nếu có upload)
        const hinhAnh = req.file ? req.file.filename : null;

        try {
            // --- VALIDATION 1: Kiểm tra tên đăng nhập ---
            const isExists = await kiemTraDangNhap(tenDangNhap);
            if (isExists) {
                const dataKhoa = await getDanhSachKhoa(); 
                return res.render('admin/quanLyBacSi/themBacSi', { 
                    msg: "Tên đăng nhập đã tồn tại",
                    dsKhoa: dataKhoa
                });
            }

            // --- VALIDATION 2: Kiểm tra số điện thoại ---
            const soDT = soDienThoai.trim();
            if (isNaN(soDT) || soDT.length !== 10) {
                const dataKhoa = await getDanhSachKhoa();
                return res.render('admin/quanLyBacSi/themBacSi', { 
                    msg: "Số điện thoại phải là 10 số",
                    dsKhoa: dataKhoa
                });
            }

            // --- NẾU HỢP LỆ THÌ INSERT (Dùng Transaction) ---
            const sqlNguoiDung = "INSERT INTO NguoiDung (tenDangNhap, matKhau, hoTen, email, soDienThoai, vaiTro) VALUES (?, ?, ?, ?, ?, 'BacSi')";
            
            con.beginTransaction(err => {
                if (err) throw err;

                con.query(sqlNguoiDung, [tenDangNhap, matKhau, hoTen, email, soDT], (err, resultUser) => {
                    if (err) return con.rollback(() => { throw err; });

                    const newUserId = resultUser.insertId; 

                    // Đã thêm hinhAnh vào câu lệnh INSERT
                    const sqlBacSi = "INSERT INTO BacSi (id, trinhDo, namTotNghiep, chiTiet, id_chuyenKhoa, hinhAnh) VALUES (?, ?, ?, ?, ?, ?)";
                    con.query(sqlBacSi, [newUserId, trinhDo, namTotNghiep, chiTiet, id_chuyenKhoa, hinhAnh], (err, resultDoctor) => {
                        if (err) return con.rollback(() => { throw err; });

                        con.commit(err => {
                            if (err) return con.rollback(() => { throw err; });
                            return res.redirect('/admin/quanLyBacSi');
                        });
                    });
                });
            });

        } catch (error) {
            console.error(error);
            if (!res.headersSent) res.status(500).send("Lỗi hệ thống: " + error.message);
        }
    });
};

//Sua Bac Si
const getSuaBacSi = async (req, res) => {
    const idBacSi = req.params.id;
    // Lấy page từ query string (do link từ danh sách truyền qua: ?page=...)
    const page = req.query.page || 1; 

    try {
        const sqlBacSi = `
            SELECT NguoiDung.*, BacSi.* FROM NguoiDung 
            JOIN BacSi ON NguoiDung.id = BacSi.id 
            WHERE NguoiDung.id = ?`;
        
        const sqlKhoa = "SELECT * FROM ChuyenKhoa";

        con.query(sqlBacSi, [idBacSi], (err, result) => {
            if (err || result.length === 0) return res.status(404).send("Không tìm thấy bác sĩ");

            con.query(sqlKhoa, (errKhoa, dsKhoa) => {
                res.render('admin/quanLyBacSi/suaBacSi', {
                    bacSi: result[0], 
                    dsKhoa: dsKhoa,
                    currentPage: page, // Gửi page sang view để bỏ vào input hidden
                    pageTitle: 'Chỉnh sửa bác sĩ'
                });
            });
        });

    } catch (error) {
        res.status(500).send("Lỗi server");
    }
};

//Sửa thông tin bác sĩ
// Sửa thông tin bác sĩ
const postSuaBacSi = async (req, res) => {
    const id = req.params.id;

    // Chạy middleware upload ảnh bác sĩ trước khi xử lý sửa đổi dữ liệu
    uploadBacSi(req, res, async (err) => {
        if (err) {
            console.error("Lỗi tải ảnh cập nhật bác sĩ:", err);
            return res.status(500).send("Lỗi hệ thống khi tải tệp tin.");
        }

        const { 
            page, tenDangNhap, matKhau, hoTen, email, soDienThoai, 
            trinhDo, namTotNghiep, chiTiet, id_chuyenKhoa 
        } = req.body;

        try {
            // Lấy một kết nối từ Pool
            con.getConnection((err, connection) => {
                if (err) {
                    console.error("Lỗi lấy kết nối từ pool:", err);
                    return res.status(500).send("Lỗi hệ thống");
                }

                // Dùng `connection` thay vì `con` để bắt đầu transaction
                connection.beginTransaction(async (err) => {
                    if (err) {
                        connection.release(); // Trả kết nối
                        throw err;
                    }

                    // Cập nhật bảng NguoiDung
                    let sqlNguoiDung = "UPDATE NguoiDung SET tenDangNhap = ?, hoTen = ?, email = ?, soDienThoai = ? WHERE id = ?";
                    let paramsNguoiDung = [tenDangNhap, hoTen, email, soDienThoai, id];

                    if (matKhau && matKhau.trim() !== "") {
                        sqlNguoiDung = "UPDATE NguoiDung SET tenDangNhap = ?, matKhau = ?, hoTen = ?, email = ?, soDienThoai = ? WHERE id = ?";
                        paramsNguoiDung = [tenDangNhap, matKhau, hoTen, email, soDienThoai, id];
                    }

                    // Lưu ý: Dùng `connection.query` ở đây
                    connection.query(sqlNguoiDung, paramsNguoiDung, (err, result) => {
                        if (err) {
                            return connection.rollback(() => {
                                connection.release(); // Trả kết nối khi lỗi
                                throw err;
                            });
                        }

                        // Cập nhật bảng BacSi
                        let sqlBacSi = "UPDATE BacSi SET trinhDo = ?, namTotNghiep = ?, chiTiet = ?, id_chuyenKhoa = ? WHERE id = ?";
                        let paramsBacSi = [trinhDo, namTotNghiep, chiTiet, id_chuyenKhoa, id];

                        if (req.file) {
                            sqlBacSi = "UPDATE BacSi SET trinhDo = ?, namTotNghiep = ?, chiTiet = ?, id_chuyenKhoa = ?, hinhAnh = ? WHERE id = ?";
                            paramsBacSi = [trinhDo, namTotNghiep, chiTiet, id_chuyenKhoa, req.file.filename, id];
                        }

                        connection.query(sqlBacSi, paramsBacSi, (err, resultDoc) => {
                            if (err) {
                                return connection.rollback(() => {
                                    connection.release(); // Trả kết nối khi lỗi
                                    throw err;
                                });
                            }

                            // Hoàn tất transaction
                            connection.commit((err) => {
                                if (err) {
                                    return connection.rollback(() => {
                                        connection.release();
                                        throw err;
                                    });
                                }
                                
                                // Giải phóng kết nối thành công
                                connection.release(); 
                                // Quay lại đúng trang cũ
                                res.redirect(`/admin/quanLyBacSi?page=${page || 1}`);
                            });
                        });
                    });
                });
            });
        } catch (error) {
            console.error("Lỗi cập nhật:", error);
            res.status(500).send("Lỗi hệ thống khi cập nhật");
        }
    });
};

//Xoa Bác Sĩ
const postXoaBacSi = (req, res) => {
    const id = req.params.id;
    // Lấy page từ query string (?page=...) của link xóa
    const page = req.query.page || 1;

    con.beginTransaction((err) => {
        if (err) throw err;

        const sqlXoaBacSi = "DELETE FROM BacSi WHERE id = ?";
        con.query(sqlXoaBacSi, [id], (err, result) => {
            if (err) return con.rollback(() => { throw err; });

            const sqlXoaNguoiDung = "DELETE FROM NguoiDung WHERE id = ?";
            con.query(sqlXoaNguoiDung, [id], (err, result) => {
                if (err) return con.rollback(() => { throw err; });

                con.commit((err) => {
                    if (err) return con.rollback(() => { throw err; });
                    // Quay lại đúng trang cũ
                    res.redirect(`/admin/quanLyBacSi?page=${page}`);
                });
            });
        });
    });
};

module.exports = {
    getDanhSachBacSi,
    getThemBacSi,
    postThemBacSi,
    getSuaBacSi,
    postSuaBacSi,
    postXoaBacSi
};
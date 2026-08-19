const con = require('../../config/connectDatabase');

// Tạo hàm query dùng Promise từ biến con
const query = async (sql, params = []) => {
    const [rows] = await con.promise().query(sql, params);
    return rows;
};

const kiemTraTonTai = (field, value, idBoQua = null) => {
    return new Promise((resolve, reject) => {
        let sql = `SELECT id FROM NguoiDung WHERE ${field} = ?`;
        let params = [value];

        if (idBoQua) {
            sql += " AND id != ?";
            params.push(idBoQua);
        }

        con.query(sql, params, (err, result) => {
            if (err) return reject(err);
            resolve(result.length > 0); 
        });
    });
};

// --- CÁC CONTROLLER ---

// 1. Lấy danh sách + Tìm kiếm + Phân trang (Chỉ lấy Khách hàng và Quản lý)
const getDanhSachNguoiDung = (req, res) => {
    const searchQuery = req.query.q || '';
    
    const limit = 10; 
    const page = parseInt(req.query.page) || 1; 
    const offset = (page - 1) * limit; 

    // Chỉ lấy những người dùng không phải Bác Sĩ
    let countSql = `SELECT COUNT(*) AS total FROM NguoiDung WHERE vaiTro != 'BacSi'`;
    let countParams = [];

    let sql = `SELECT * FROM NguoiDung WHERE vaiTro != 'BacSi'`;
    let params = [];

    if (searchQuery) {
        const searchCondition = ` AND (LOWER(hoTen) LIKE LOWER(?) OR LOWER(email) LIKE LOWER(?) OR soDienThoai LIKE ? OR LOWER(tenDangNhap) LIKE LOWER(?))`;
        countSql += searchCondition;
        sql += searchCondition;
        
        const keyword = `%${searchQuery}%`;
        countParams = [keyword, keyword, keyword, keyword];
        params = [keyword, keyword, keyword, keyword];
    }
    
    sql += ` ORDER BY id DESC LIMIT ? OFFSET ?`;
    params.push(limit, offset);

    con.query(countSql, countParams, (err, countResults) => {
        if (err) {
            console.error("Lỗi SQL (Count):", err);
            return res.status(500).send("Lỗi server: " + err.message);
        }

        const totalItems = countResults[0].total;
        const totalPages = Math.ceil(totalItems / limit);

        con.query(sql, params, (err, results) => {
            if (err) {
                console.error("Lỗi SQL (Select):", err); 
                return res.status(500).send("Lỗi server: " + err.message);
            }
            
            res.render('admin/quanLyNguoiDung/quanLyNguoiDung', { 
                danhSach: results,
                searchQuery: searchQuery,
                currentPage: page,
                totalPages: totalPages,
                pageTitle: 'Quản Lý Người Dùng'
            });
        });
    });
};

// 2. Hiển thị form Thêm Người Dùng
const getThemNguoiDung = (req, res) => {
    res.render('admin/quanLyNguoiDung/themNguoiDung', { 
        pageTitle: 'Thêm Người Dùng Mới',
        msg: '',
        oldData: {} 
    });
};

// 3. Xử lý Thêm Người Dùng
const postThemNguoiDung = async (req, res) => {
    const { 
        tenDangNhap, matKhau, hoTen, email, soDienThoai, vaiTro,
        ngaySinh, gioiTinh, diaChi, nhomMau, tienSuBenhLy, boPhan 
    } = req.body;

    try {
        // Kiểm tra tên đăng nhập trùng lặp
        if (await kiemTraTonTai('tenDangNhap', tenDangNhap)) {
            return res.render('admin/quanLyNguoiDung/themNguoiDung', { 
                msg: "Tên đăng nhập đã tồn tại!",
                pageTitle: 'Thêm Người Dùng Mới', oldData: req.body
            });
        }

        // Kiểm tra email trùng lặp
        if (email && email.trim() !== "") {
            if (await kiemTraTonTai('email', email)) {
                return res.render('admin/quanLyNguoiDung/themNguoiDung', { 
                    msg: "Email này đã được sử dụng!",
                    pageTitle: 'Thêm Người Dùng Mới', oldData: req.body
                });
            }
        }

        // Kiểm tra định dạng và trùng lặp khi số điện thoại thực sự được nhập
        if (soDienThoai && soDienThoai.trim() !== "") {
            if (soDienThoai.trim().length !== 10) {
                return res.render('admin/quanLyNguoiDung/themNguoiDung', { 
                    msg: "Số điện thoại không hợp lệ (phải gồm đúng 10 chữ số)!",
                    pageTitle: 'Thêm Người Dùng Mới', oldData: req.body
                });
            }
            if (await kiemTraTonTai('soDienThoai', soDienThoai)) {
                return res.render('admin/quanLyNguoiDung/themNguoiDung', { 
                    msg: "Số điện thoại này đã được sử dụng!",
                    pageTitle: 'Thêm Người Dùng Mới', oldData: req.body
                });
            }
        }

        const sqlNguoiDung = "INSERT INTO NguoiDung (tenDangNhap, matKhau, hoTen, email, soDienThoai, vaiTro) VALUES (?, ?, ?, ?, ?, ?)";
        con.query(sqlNguoiDung, [
            tenDangNhap, matKhau, hoTen, email || null, soDienThoai || null, vaiTro
        ], (err, result) => {
            if (err) {
                console.error("Lỗi thêm NguoiDung:", err);
                return res.render('admin/quanLyNguoiDung/themNguoiDung', {
                    msg: "Lỗi hệ thống: " + err.message,
                    pageTitle: 'Thêm Người Dùng Mới', oldData: req.body
                });
            }

            const newUserId = result.insertId;
            let sqlChiTiet = "";
            let paramsChiTiet = [];

            if (vaiTro === 'KhachHang') {
                sqlChiTiet = "INSERT INTO KhachHang (id, ngaySinh, gioiTinh, diaChi, nhomMau, tienSuBenhLy) VALUES (?, ?, ?, ?, ?, ?)";
                paramsChiTiet = [
                    newUserId, 
                    ngaySinh || null, 
                    gioiTinh || null, 
                    diaChi || null, 
                    nhomMau || null, 
                    tienSuBenhLy || null
                ];
            } else if (vaiTro === 'NguoiQuanLy') {
                sqlChiTiet = "INSERT INTO NguoiQuanLy (id, boPhan) VALUES (?, ?)";
                paramsChiTiet = [newUserId, boPhan || null];
            }

            if (sqlChiTiet !== "") {
                con.query(sqlChiTiet, paramsChiTiet, (errChiTiet) => {
                    if (errChiTiet) {
                        console.error("Lỗi thêm bảng chi tiết:", errChiTiet);
                        return res.render('admin/quanLyNguoiDung/themNguoiDung', {
                            msg: "Lỗi hệ thống khi tạo thông tin chi tiết: " + errChiTiet.message,
                            pageTitle: 'Thêm Người Dùng Mới', oldData: req.body
                        });
                    }
                    res.redirect('/admin/quanLyNguoiDung');
                });
            } else {
                res.redirect('/admin/quanLyNguoiDung');
            }
        });

    } catch (error) {
        console.error(error);
        res.status(500).send("Lỗi server");
    }
};

// 4. Hiển thị form Sửa Người Dùng
const getSuaNguoiDung = (req, res) => {
    const userId = req.params.id;

    const sql = `
        SELECT nd.*, kh.ngaySinh, kh.gioiTinh, kh.diaChi, kh.tienSuBenhLy, kh.nhomMau, nql.boPhan
        FROM NguoiDung nd
        LEFT JOIN KhachHang kh ON nd.id = kh.id
        LEFT JOIN NguoiQuanLy nql ON nd.id = nql.id
        WHERE nd.id = ?
    `;
    
    con.query(sql, [userId], (err, rows) => {
        if (err || rows.length === 0) {
            console.error("Lỗi khi load trang sửa người dùng:", err);
            return res.redirect('/admin/quanLyNguoiDung');
        }

        let user = rows[0];

        if (user.ngaySinh) {
            const d = new Date(user.ngaySinh);
            user.ngaySinh = `${d.getFullYear()}-${('0' + (d.getMonth() + 1)).slice(-2)}-${('0' + d.getDate()).slice(-2)}`;
        }

        if (user.gioiTinh === 'Nu') user.gioiTinh = 'Nữ';
        else if (user.gioiTinh === 'Khac') user.gioiTinh = 'Khác';

        res.render('admin/quanLyNguoiDung/suaNguoiDung', {
            pageTitle: 'Sửa Người Dùng',
            user: user,
            msg: null 
        });
    });
};

// 5. Xử lý Sửa Người Dùng
const postSuaNguoiDung = (req, res) => {
    const userId = req.params.id;
    const { 
        tenDangNhap, matKhau, hoTen, vaiTro, email, soDienThoai, 
        ngaySinh, gioiTinh, nhomMau, diaChi, tienSuBenhLy, boPhan 
    } = req.body;

    let updateNguoiDungQuery = `UPDATE NguoiDung SET tenDangNhap = ?, hoTen = ?, vaiTro = ?, email = ?, soDienThoai = ?`;
    let paramsNguoiDung = [tenDangNhap, hoTen, vaiTro, email || null, soDienThoai || null];

    if (matKhau && matKhau.trim() !== '') {
        updateNguoiDungQuery += `, matKhau = ?`;
        paramsNguoiDung.push(matKhau); 
    }

    updateNguoiDungQuery += ` WHERE id = ?`;
    paramsNguoiDung.push(userId);

    con.query(updateNguoiDungQuery, paramsNguoiDung, (err) => {
        if (err) {
            console.error("Lỗi cập nhật NguoiDung:", err);
            let msgError = 'Có lỗi xảy ra khi cập nhật vào CSDL.';
            if (err.code === 'ER_DUP_ENTRY') msgError = 'Tên đăng nhập, Email hoặc Số điện thoại đã được người khác sử dụng!';
            
            return res.render('admin/quanLyNguoiDung/suaNguoiDung', {
                pageTitle: 'Sửa Người Dùng',
                user: { ...req.body, id: userId }, 
                msg: msgError
            });
        }

        if (vaiTro === 'KhachHang') {
            let mappedGioiTinh = gioiTinh;
            if (gioiTinh === 'Nữ') mappedGioiTinh = 'Nữ';
            else if (gioiTinh === 'Khác') mappedGioiTinh = 'Khac';

            const upsertKhachHangQuery = `
                INSERT INTO KhachHang (id, ngaySinh, gioiTinh, diaChi, tienSuBenhLy, nhomMau)
                VALUES (?, ?, ?, ?, ?, ?)
                ON DUPLICATE KEY UPDATE
                    ngaySinh = VALUES(ngaySinh), gioiTinh = VALUES(gioiTinh), diaChi = VALUES(diaChi), 
                    tienSuBenhLy = VALUES(tienSuBenhLy), nhomMau = VALUES(nhomMau)
            `;
            
            con.query(upsertKhachHangQuery, [
                userId, ngaySinh || null, mappedGioiTinh || null, diaChi || null, tienSuBenhLy || null, nhomMau || null
            ], () => {
                con.query(`DELETE FROM NguoiQuanLy WHERE id = ?`, [userId], () => {
                    res.redirect('/admin/quanLyNguoiDung');
                });
            });

        } else if (vaiTro === 'NguoiQuanLy') {
            const upsertQuanLyQuery = `
                INSERT INTO NguoiQuanLy (id, boPhan) 
                VALUES (?, ?) 
                ON DUPLICATE KEY UPDATE boPhan = VALUES(boPhan)
            `;
            
            con.query(upsertQuanLyQuery, [userId, boPhan || null], () => {
                con.query(`DELETE FROM KhachHang WHERE id = ?`, [userId], () => {
                    res.redirect('/admin/quanLyNguoiDung');
                });
            });
        }
    });
};

module.exports = { 
    getDanhSachNguoiDung, 
    getThemNguoiDung, 
    postThemNguoiDung, 
    getSuaNguoiDung, 
    postSuaNguoiDung 
};
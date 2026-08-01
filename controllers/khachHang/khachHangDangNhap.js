const con = require('../../config/connectDatabase');
const escapeHtml = require('escape-html');
const crypto = require('crypto');

// Hàm query sử dụng Promise
const query = async (sql, params = []) => {
    const [rows] = await con.promise().query(sql, params);
    return rows;
};

/**
 * Tạo CSRF token mới cho từng chức năng.
 *
 * Session sẽ có cấu trúc:
 * req.session.csrfTokens.login
 * req.session.csrfTokens.register
 */
const createCsrfToken = (req, tokenName) => {
    if (!req.session.csrfTokens) req.session.csrfTokens = {};

    const token = crypto.randomBytes(32).toString('hex');
    req.session.csrfTokens[tokenName] = token;
    return token;
};

/**
 * Kiểm tra CSRF token bằng timingSafeEqual.
 */
const verifyCsrfToken = (req, tokenName) => {
    const submittedToken = req.body?._csrf;
    const sessionToken = req.session?.csrfTokens?.[tokenName];

    if (typeof submittedToken !== 'string' || typeof sessionToken !== 'string')
        return false;

    const submittedBuffer = Buffer.from(submittedToken, 'utf8');
    const sessionBuffer = Buffer.from(sessionToken, 'utf8');

    if (submittedBuffer.length !== sessionBuffer.length)
        return false;
    return crypto.timingSafeEqual(submittedBuffer, sessionBuffer);
};

/**
 * Render trang đăng nhập.
 *
 * Không gọi req.session.save() trước res.render().
 * Express-session sẽ tự lưu session khi response kết thúc.
 */
const renderLogin = (req, res, { msg = '', type = '' } = {}) => {
    const csrfToken = createCsrfToken(req, 'login');
    return res.render('khachHang/taiKhoan/login', { page: 'login', msg, type, csrfToken });
};

/**
 * Render trang tạo tài khoản.
 *
 * Không gọi req.session.save() trước res.render().
 */
const renderTaoTaiKhoan = (req, res, { msg = '', type = '' } = {}) => {
    const csrfToken = createCsrfToken(req, 'register');
    return res.render('khachHang/taiKhoan/taoTaiKhoan', { page: 'taoTaiKhoan', msg, type, csrfToken });
};

// [GET] Trang đăng nhập
const getLogin = (req, res) => {
    return renderLogin(req, res, { msg: req.query.msg || '', type: req.query.msg ? 'success' : '' });
};

// [POST] Xử lý đăng nhập
const postLogin = async (req, res) => {
    try {
        if (!verifyCsrfToken(req, 'login')) return res.status(403).send('CSRF detected');

        const username = typeof req.body.username === 'string' ? req.body.username.trim() : '';
        const password = typeof req.body.password === 'string' ? req.body.password : '';

        if (!username || !password) return renderLogin(req, res, { msg: 'Vui lòng nhập đầy đủ thông tin', type: 'error' });

        const rows = await query(
            `SELECT id, tenDangNhap, matKhau, hoTen, vaiTro
             FROM NguoiDung
             WHERE tenDangNhap = ? AND vaiTro = 'KhachHang'
             LIMIT 1`,
            [username]
        );

        if (rows.length === 0) return renderLogin(req, res, { msg: 'Sai tên đăng nhập hoặc mật khẩu', type: 'error' });

        const user = rows[0];

        if (user.matKhau !== password) return renderLogin(req, res, { msg: 'Sai tên đăng nhập hoặc mật khẩu', type: 'error' });

        const redirectUrl = req.session.returnTo || '/trangchu';
        const userSession = {
            id: user.id,
            name: user.hoTen,
            hoTen: user.hoTen,
            username: user.tenDangNhap,
            vaiTro: user.vaiTro
        };

        // Tạo session ID mới sau khi đăng nhập để tránh Session Fixation
        return req.session.regenerate((regenerateError) => {
            if (regenerateError) {
                console.error('Lỗi tạo lại session:', regenerateError);
                return res.status(500).send('Không thể tạo phiên đăng nhập.');
            }

            req.session.user = userSession;

            // Được phép dùng save() vì ngay sau đó là redirect
            return req.session.save((saveError) => {
                if (saveError) {
                    console.error('Lỗi lưu session đăng nhập:', saveError);
                    return res.status(500).send('Đăng nhập thành công nhưng không thể lưu phiên.');
                }

                return res.redirect(redirectUrl);
            });
        });
    } catch (error) {
        console.error('Lỗi khi đăng nhập:', error);
        return renderLogin(req, res, { msg: 'Lỗi server', type: 'error' });
    }
};

// [GET] Đăng xuất
const logout = (req, res) => {
    req.session.destroy((error) => {
        if (error) {
            console.error('Lỗi khi đăng xuất:', error);
            return res.send('Lỗi logout');
        }

        res.clearCookie('connect.sid', { path: '/' });
        return res.redirect('/trangchu');
    });
};

// [GET] Trang tạo tài khoản
const getTaoTaiKhoan = (req, res) => {
    return renderTaoTaiKhoan(req, res);
};

// [POST] Xử lý tạo tài khoản
const postTaoTaiKhoan = async (req, res) => {
    try {
        if (!verifyCsrfToken(req, 'register')) return res.status(403).send('CSRF detected');

        const { hoTen, username, password, soDienThoai, email, ngaySinh, gioiTinh, diaChi } = req.body;

        if (!hoTen || !username || !password || !soDienThoai || !email) {
            return renderTaoTaiKhoan(req, res, { msg: 'Vui lòng nhập đầy đủ thông tin bắt buộc.', type: 'error' });
        }

        const safeUsername = escapeHtml(username.trim());
        const safeHoTen = escapeHtml(hoTen.trim());
        const safeEmail = email.trim();
        const safeSoDienThoai = soDienThoai.trim();
        const safeDiaChi = diaChi && diaChi.trim() !== '' ? escapeHtml(diaChi.trim()) : null;

        // Kiểm tra tên đăng nhập
        const checkUsername = await query(
            `SELECT id FROM NguoiDung WHERE tenDangNhap = ? LIMIT 1`,
            [safeUsername]
        );

        if (checkUsername.length > 0) {
            return renderTaoTaiKhoan(req, res, { msg: 'Tên đăng nhập đã tồn tại!', type: 'error' });
        }

        // Kiểm tra ngày sinh
        let safeNgaySinh = null;

        if (ngaySinh && ngaySinh.trim() !== '') {
            const inputDate = new Date(`${ngaySinh.trim()}T00:00:00`);
            const today = new Date();
            today.setHours(0, 0, 0, 0);

            if (Number.isNaN(inputDate.getTime()) || inputDate >= today) {
                return renderTaoTaiKhoan(req, res, {
                    msg: 'Ngày sinh không hợp lệ! Ngày sinh phải là một ngày trong quá khứ.',
                    type: 'error'
                });
            }

            safeNgaySinh = ngaySinh.trim();
        }

        // Kiểm tra email
        const emailRegex = /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/;

        if (!emailRegex.test(safeEmail)) {
            return renderTaoTaiKhoan(req, res, { msg: 'Email không đúng định dạng! Vui lòng kiểm tra lại.', type: 'error' });
        }

        // Kiểm tra số điện thoại
        const phoneRegex = /^0[35789]\d{8}$/;

        if (!phoneRegex.test(safeSoDienThoai)) {
            return renderTaoTaiKhoan(req, res, {
                msg: 'Số điện thoại không đúng định dạng! Vui lòng nhập số điện thoại Việt Nam 10 số.',
                type: 'error'
            });
        }

        // Kiểm tra email đã tồn tại
        const checkEmail = await query(
            `SELECT id FROM NguoiDung WHERE email = ? LIMIT 1`,
            [safeEmail]
        );

        if (checkEmail.length > 0) {
            return renderTaoTaiKhoan(req, res, { msg: 'Email này đã được sử dụng. Vui lòng chọn email khác!', type: 'error' });
        }

        const result = await query(
            `INSERT INTO NguoiDung (tenDangNhap, matKhau, vaiTro, hoTen, soDienThoai, email)
             VALUES (?, ?, 'KhachHang', ?, ?, ?)`,
            [safeUsername, password, safeHoTen, safeSoDienThoai, safeEmail]
        );

        const newId = result.insertId;

        // Giá trị ENUM trong database: Nam, Nữ, Khác
        const genderMap = { Nam: 'Nam', Nu: 'Nữ', 'Nữ': 'Nữ', Khac: 'Khác', 'Khác': 'Khác' };
        const safeGioiTinh = gioiTinh && genderMap[gioiTinh] ? genderMap[gioiTinh] : null;

        await query(
            `INSERT INTO KhachHang (id, ngaySinh, gioiTinh, diaChi)
             VALUES (?, ?, ?, ?)`,
            [newId, safeNgaySinh, safeGioiTinh, safeDiaChi]
        );

        if (req.session.csrfTokens) delete req.session.csrfTokens.register;

        const thongBao = encodeURIComponent('Tạo tài khoản thành công');
        return res.redirect(`/login?msg=${thongBao}`);
    } catch (error) {
        console.error('Lỗi khi tạo tài khoản:', error);
        return renderTaoTaiKhoan(req, res, { msg: 'Có lỗi xảy ra khi tạo tài khoản.', type: 'error' });
    }
};

module.exports = { getLogin, postLogin, logout, getTaoTaiKhoan, postTaoTaiKhoan };
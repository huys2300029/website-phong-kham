// Kết nối database
const con = require("../../config/connectDatabase");
const crypto = require("crypto");

// Tên token riêng cho form đăng nhập admin
const CSRF_TOKEN_NAME = "adminLogin";

// Tạo hàm query dùng Promise từ biến con
const query = async (sql, params = []) => {
    const [rows] = await con.promise().query(sql, params);
    return rows;
};

// ======================================================
// HÀM XỬ LÝ CSRF CHO ADMIN
// ======================================================

/**
 * Lấy hoặc tạo token riêng cho form đăng nhập admin.
 *
 * Token được lưu tại:
 * req.session.csrfTokens.adminLogin
 */
const getAdminCsrfToken = (req) => {
    if (!req.session.csrfTokens) {
        req.session.csrfTokens = {};
    }

    if (!req.session.csrfTokens[CSRF_TOKEN_NAME]) {
        req.session.csrfTokens[CSRF_TOKEN_NAME] = crypto
            .randomBytes(32)
            .toString("hex");
    }

    return req.session.csrfTokens[CSRF_TOKEN_NAME];
};

/**
 * Kiểm tra CSRF token bằng timingSafeEqual.
 */
const validateAdminCsrfToken = (req) => {
    const tokenFromForm = String(req.body._csrf || "");

    const tokenFromSession =
        req.session.csrfTokens?.[CSRF_TOKEN_NAME];

    if (!tokenFromForm || !tokenFromSession) {
        return false;
    }

    const formBuffer = Buffer.from(tokenFromForm);
    const sessionBuffer = Buffer.from(tokenFromSession);

    if (formBuffer.length !== sessionBuffer.length) {
        return false;
    }

    return crypto.timingSafeEqual(
        formBuffer,
        sessionBuffer
    );
};

/**
 * Render trang đăng nhập admin.
 *
 * Luôn truyền csrfToken để tránh token bị mất khi
 * đăng nhập sai hoặc hệ thống xảy ra lỗi.
 */
const renderAdminLogin = (
    req,
    res,
    {
        statusCode = 200,
        message = "",
        username = ""
    } = {}
) => {
    const csrfToken = getAdminCsrfToken(req);

    return res.status(statusCode).render("admin/login", {
        message,
        csrfToken,
        username
    });
};

// ======================================================
// 1. HIỂN THỊ FORM ĐĂNG NHẬP ADMIN
// [GET] /admin/login
// ======================================================

const getLoginAdmin = (req, res) => {
    // Nếu đã đăng nhập đúng vai trò admin thì chuyển vào dashboard
    if (
        req.session.user && req.session.user.vaiTro === "NguoiQuanLy"
    ) {
        return res.redirect("/admin/trangchu");
    }

    return renderAdminLogin(req, res);
};

// ======================================================
// 2. XỬ LÝ ĐĂNG NHẬP ADMIN
// [POST] /admin/login
// ======================================================

const postLoginAdmin = async (req, res) => {
    const tenDangNhap = String(req.body.username || "").trim();

    const matKhau = String(req.body.password || "");

    try {
        // ----------------------------------------------
        // Bước 1: Kiểm tra CSRF token
        // ----------------------------------------------
        if (!validateAdminCsrfToken(req)) {
            console.log("CSRF ADMIN DEBUG:", {
                sessionID: req.sessionID,

                coTokenTrongForm: Boolean(
                    req.body._csrf
                ),

                coTokenTrongSession: Boolean(
                    req.session.csrfTokens?.[
                    CSRF_TOKEN_NAME
                    ]
                ),

                tokenTrungKhop:
                    req.body._csrf ===
                    req.session.csrfTokens?.[
                    CSRF_TOKEN_NAME
                    ]
            });

            /*
             * Token không hợp lệ thì xóa token cũ.
             * renderAdminLogin sẽ tạo token mới.
             */
            if (!req.session.csrfTokens) {
                req.session.csrfTokens = {};
            }

            delete req.session.csrfTokens[
                CSRF_TOKEN_NAME
            ];

            return renderAdminLogin(req, res, {
                statusCode: 403,

                message:
                    "Phiên xác thực không hợp lệ hoặc đã hết hạn. " +
                    "Vui lòng đăng nhập lại.",

                username: tenDangNhap
            });
        }

        // ----------------------------------------------
        // Bước 2: Kiểm tra dữ liệu đầu vào
        // ----------------------------------------------
        if (!tenDangNhap || !matKhau) {
            return renderAdminLogin(req, res, {
                statusCode: 400,

                message:
                    "Vui lòng nhập đầy đủ tên đăng nhập " +
                    "và mật khẩu.",

                username: tenDangNhap
            });
        }

        // ----------------------------------------------
        // Bước 3: Kiểm tra tài khoản admin
        // ----------------------------------------------
        const sql = `
            SELECT
                id,
                hoTen,
                tenDangNhap,
                vaiTro
            FROM NguoiDung
            WHERE
                tenDangNhap = ?
                AND matKhau = ?
                AND vaiTro = 'NguoiQuanLy'
            LIMIT 1
        `;

        const result = await query(sql, [
            tenDangNhap,
            matKhau
        ]);

        // ----------------------------------------------
        // Bước 4: Đăng nhập thất bại
        // ----------------------------------------------
        if (result.length === 0) {
            return renderAdminLogin(req, res, {
                statusCode: 401,

                message:
                    "Sai tên đăng nhập, mật khẩu hoặc " +
                    "bạn không có quyền truy cập.",

                username: tenDangNhap
            });
        }

        const admin = result[0];

        const adminSession = {
            id: admin.id,
            hoTen: admin.hoTen,
            tenDangNhap: admin.tenDangNhap,
            vaiTro: admin.vaiTro
        };

        // ----------------------------------------------
        // Bước 5: Tạo session ID mới
        // Chống Session Fixation
        // ----------------------------------------------
        return req.session.regenerate((regenerateError) => {
            if (regenerateError) {
                console.error(
                    "Lỗi tạo session admin:",
                    regenerateError
                );

                return renderAdminLogin(req, res, {
                    statusCode: 500,

                    message:
                        "Không thể tạo phiên đăng nhập. " +
                        "Vui lòng thử lại.",

                    username: tenDangNhap
                });
            }

            req.session.user = adminSession;

            return req.session.save(
                (saveError) => {
                    if (saveError) {
                        console.error(
                            "Lỗi lưu session admin:",
                            saveError
                        );

                        return res
                            .status(500)
                            .send(
                                "Không thể lưu phiên đăng nhập."
                            );
                    }

                    return res.redirect(
                        "/admin/trangchu"
                    );
                }
            );
        }
        );
    } catch (error) {
        console.error(
            "Lỗi đăng nhập admin:",
            error
        );

        return renderAdminLogin(req, res, {
            statusCode: 500,

            message:
                "Hệ thống đang gặp sự cố, " +
                "vui lòng thử lại sau.",

            username: tenDangNhap
        });
    }
};

// ======================================================
// 3. HIỂN THỊ DASHBOARD
// ======================================================

const getDashboard = (req, res) => {
    if (
        !req.session.user ||
        req.session.user.vaiTro !== "NguoiQuanLy"
    ) {
        return res.redirect("/admin/login");
    }

    const tenNguoiDung =
        req.session.user.hoTen;

    return res.render("admin/dashboard", {
        tenAdmin: tenNguoiDung
    });
};

// ======================================================
// 4. ĐĂNG XUẤT ADMIN
// ======================================================

const getLogoutAdmin = (req, res) => {
    req.session.destroy((error) => {
        if (error) {
            console.error(
                "Lỗi khi hủy session admin:",
                error
            );

            return res.redirect(
                "/admin/trangchu"
            );
        }

        /*
         * Nếu trong app.js bạn đặt tên cookie khác connect.sid,
         * cần thay tên cookie tại đây.
         */
        res.clearCookie("connect.sid");

        return res.redirect("/admin/login");
    });
};

// ======================================================
// 5. MIDDLEWARE KIỂM TRA QUYỀN ADMIN
// ======================================================

const kiemTraDangNhap = (req, res, next) => {
    if (req.session.user && req.session.user.vaiTro === "NguoiQuanLy") {
        return next();
    }

    return res.redirect("/admin/login");
};

// ======================================================
// EXPORT
// ======================================================

module.exports = {
    getLoginAdmin,
    postLoginAdmin,
    getDashboard,
    getLogoutAdmin,
    kiemTraDangNhap
};
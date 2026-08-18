const con = require('../../config/connectDatabase');

// Hàm dùng chung để chạy câu SQL và lấy kết quả từ TiDB.
const query = async (sql, params = []) => {
    const [rows] = await con.promise().query(sql, params);
    return rows;
};
// Thư viện gửi email xác nhận cho khách hàng.
const nodemailer = require('nodemailer');

// Thư viện dùng để gọi API của ZaloPay.
const axios = require('axios');

// Dùng để tạo mã MAC theo đúng yêu cầu của ZaloPay.
const CryptoJS = require('crypto-js');

// Dùng để tạo token ngẫu nhiên cho CSRF.
const crypto = require('crypto');

// Dùng để xử lý ngày, giờ theo định dạng dễ dùng.
const moment = require('moment');

/* ================= CSRF TOKEN ================= */
// Có thể hiểu CSRF token như một "tấm vé" riêng cho mỗi form.
// Form gửi lên phải có đúng vé thì server mới cho xử lý.
const createCsrfToken = (req, tokenName) => {
    if (!req.session.csrfTokens) req.session.csrfTokens = {};

    const token = crypto.randomBytes(32).toString('hex');
    req.session.csrfTokens[tokenName] = token;
    return token;
};

// So sánh token từ form với token đã cất trong session.
const verifyCsrfToken = (req, tokenName) => {
    const submittedToken = req.body?._csrf;
    const sessionToken = req.session?.csrfTokens?.[tokenName];

    if (typeof submittedToken !== 'string' || typeof sessionToken !== 'string') return false;

    const submittedBuffer = Buffer.from(submittedToken, 'utf8');
    const sessionBuffer = Buffer.from(sessionToken, 'utf8');

    if (submittedBuffer.length !== sessionBuffer.length) return false;
    return crypto.timingSafeEqual(submittedBuffer, sessionBuffer);
};

/* ================= CẤU HÌNH URL HỆ THỐNG ================= */
// URL này được gắn vào đường dẫn quay lại website và địa chỉ callback của ZaloPay.
// Render tự cung cấp RENDER_EXTERNAL_URL, ví dụ:
// https://phongkhambenh.onrender.com
// Khi chạy local, hệ thống tự dùng http://localhost:3000.
const APP_URL = (
    process.env.APP_URL ||
    process.env.RENDER_EXTERNAL_URL ||
    'http://localhost:3000'
).replace(/\/+$/, '');

/* ================= CẤU HÌNH ZALOPAY ================= */
// app_id, key1 và key2 lấy từ biến môi trường.
// Ba endpoint bên dưới lần lượt dùng để tạo đơn, hoàn tiền và hỏi trạng thái giao dịch.
const configZaloPay = {
    app_id: process.env.ZALOPAY_APP_ID || '2553',
    key1: process.env.ZALOPAY_KEY1,
    key2: process.env.ZALOPAY_KEY2,

    endpoint: 'https://sb-openapi.zalopay.vn/v2/create',
    refundEndpoint: 'https://sb-openapi.zalopay.vn/v2/refund',
    queryEndpoint: 'https://sb-openapi.zalopay.vn/v2/query'
};

/* ================= CẤU HÌNH GỬI MAIL ================= */
// Có đủ tài khoản Gmail và App Password thì mới tạo bộ gửi mail.
// Thiếu một trong hai thì hệ thống vẫn chạy, chỉ bỏ qua bước gửi email.
const gmailUser = process.env.GMAIL_USER;
const gmailAppPassword = process.env.GMAIL_APP_PASSWORD;

const transporter = gmailUser && gmailAppPassword
    ? nodemailer.createTransport({
        service: 'gmail',
        auth: {
            user: gmailUser,
            pass: gmailAppPassword
        }
    })
    : null;

/* ================= HELPER LOG NGẮN GỌN ================= */
// Gom cách in thông báo ra terminal để lúc kiểm tra lỗi dễ nhìn hơn.
const logThanhToan = (message) => {
    console.log(`[THANH TOAN] ${message}`);
};

const logHoanTien = (message) => {
    console.log(`[HOAN TIEN] ${message}`);
};

const logLoi = (message, error = null) => {
    console.error(`[LOI] ${message}`);

    if (error && error.response && error.response.data) {
        console.error(error.response.data);
    } else if (error && error.message) {
        console.error(error.message);
    }
};

// Những chức năng tạo đơn, hỏi trạng thái và hoàn tiền đều cần key1.
const damBaoCoKey1ZaloPay = () => {
    if (!configZaloPay.key1) {
        throw new Error('Thiếu biến môi trường ZALOPAY_KEY1 trên Render.');
    }
};

// Callback dùng key2 để kiểm tra dữ liệu có thật sự do ZaloPay gửi hay không.
const damBaoCoKey2ZaloPay = () => {
    if (!configZaloPay.key2) {
        throw new Error('Thiếu biến môi trường ZALOPAY_KEY2 trên Render.');
    }
};

// ZaloPay yêu cầu phần ngày trong app_trans_id theo múi giờ Việt Nam GMT+7.
const taoTienToNgayVietNam = () => moment().utcOffset(7).format('YYMMDD');

// Đánh dấu lịch hẹn đã thanh toán và lưu mã giao dịch thật do ZaloPay cấp.
const capNhatThanhToanThanhCong = async (app_trans_id, zp_trans_id) => {
    const updateResult = await query(
        `
        UPDATE LichHen 
        SET trangThaiThanhToan = 'DaThanhToan',
            maZalopay = ?
        WHERE maZalo = ?
          AND trangThaiThanhToan = 'ChuaThanhToan'
        `,
        [zp_trans_id, app_trans_id]
    );

    return updateResult.affectedRows;
};

// Chủ động hỏi ZaloPay xem một mã đơn hiện đã thanh toán hay chưa.
const queryTrangThaiDonHangZaloPay = async (app_trans_id) => {
    damBaoCoKey1ZaloPay();

    const app_id = String(configZaloPay.app_id);

    // Theo API /v2/query:
    // mac = HMAC_SHA256(key1, app_id + "|" + app_trans_id + "|" + key1)
    const hmacInput = `${app_id}|${app_trans_id}|${configZaloPay.key1}`;
    const mac = CryptoJS.HmacSHA256(hmacInput, configZaloPay.key1).toString();

    // Gom dữ liệu thành dạng form để gửi sang API ZaloPay.
    const params = new URLSearchParams();
    params.append('app_id', app_id);
    params.append('app_trans_id', app_trans_id);
    params.append('mac', mac);

    // Gửi yêu cầu hỏi trạng thái giao dịch sang ZaloPay Sandbox.
    const response = await axios.post(
        configZaloPay.queryEndpoint,
        params.toString(),
        {
            headers: {
                'Content-Type': 'application/x-www-form-urlencoded'
            }
        }
    );

    return response.data;
};

// Dùng khi callback bị trễ hoặc không tới được server.
// Hàm chủ động hỏi ZaloPay rồi đồng bộ trạng thái vào TiDB.
const dongBoTrangThaiThanhToan = async (lichHen) => {
    if (
        !lichHen ||
        lichHen.trangThaiThanhToan !== 'ChuaThanhToan' ||
        !lichHen.maZalo
    ) {
        return false;
    }

    const queryResult = await queryTrangThaiDonHangZaloPay(lichHen.maZalo);

    if (queryResult.return_code === 1 && queryResult.zp_trans_id) {
        await capNhatThanhToanThanhCong(
            lichHen.maZalo,
            queryResult.zp_trans_id
        );

        lichHen.trangThaiThanhToan = 'DaThanhToan';
        lichHen.maZalopay = String(queryResult.zp_trans_id);

        logThanhToan(
            `Đồng bộ trạng thái thành công LH-${lichHen.id_lichHen}, ZP-${queryResult.zp_trans_id}`
        );

        return true;
    }

    return false;
};

/* ================= HELPER: TẠO LỊCH HẸN & THANH TOÁN ================= */
// Đây là hàm chính khi khách vừa đặt lịch và muốn chuyển sang thanh toán.
const handleBookingAndPayment = async (res, req, id_ca, id_chuyenKhoa, ngay, gioHen, id_khachHang, loaiKham = 'Thuong') => {
    try {
        damBaoCoKey1ZaloPay();

        let donGia = 0;

        // Lấy đúng giá đang áp dụng cho chuyên khoa và loại khám đã chọn.
        const giaKhamData = await query(
            `
            SELECT donGia 
            FROM GiaKham 
            WHERE id_chuyenKhoa = ? 
              AND loaiKham = ? 
              AND ngayApDung <= ? 
            ORDER BY ngayApDung DESC 
            LIMIT 1
            `,
            [id_chuyenKhoa, loaiKham, ngay]
        );

        if (giaKhamData.length > 0) {
            donGia = giaKhamData[0].donGia;
        } else {
            const tenLoai = loaiKham === 'ChuyenGia' ? 'khám chuyên gia' : 'khám thường';

            logLoi(`Chưa cấu hình giá ${tenLoai} cho chuyên khoa ID ${id_chuyenKhoa}`);

            return res.json({
                success: false,
                msg: `Hệ thống chưa thiết lập giá ${tenLoai} cho chuyên khoa này. Vui lòng liên hệ hỗ trợ!`
            });
        }

        // Tìm các lịch đã đặt trong khoảng thời gian đặt lịch.
        const gioHenPrefix = gioHen.substring(0, 2) + '%';

        const bookedData = await query(
            `
            SELECT gioHen 
            FROM LichHen 
            WHERE id_caKham = ? 
              AND gioHen LIKE ? 
              AND trangThai != 'Huy'
            `,
            [id_ca, gioHenPrefix]
        );

        // Chỉ lấy phần phút của các lịch đã đặt, ví dụ 08:20 thì lấy số 20.
        const bookedMinutes = bookedData.map(row => {
            const timeStr = typeof row.gioHen === 'string' ? row.gioHen : String(row.gioHen);
            return parseInt(timeStr.split(':')[1], 10);
        });

        // Mỗi bệnh nhân cách nhau 10 phút, hệ thống tìm phút trống đầu tiên.
        const possibleMinutes = [0, 10, 20, 30, 40, 50];
        let availableMinute = -1;

        for (let m of possibleMinutes) {
            if (!bookedMinutes.includes(m)) {
                availableMinute = m;
                break;
            }
        }

        if (availableMinute === -1) {
            return res.json({
                success: false,
                msg: 'Rất tiếc, khung giờ này đã kín người đặt. Vui lòng chọn giờ khác!'
            });
        }

        const hh = parseInt(gioHen.substring(0, 2), 10);

        const exactTimeObj = moment().set({
            hour: hh,
            minute: availableMinute,
            second: 0
        });

        const gioHenThucTe = exactTimeObj.format('HH:mm');

        // Giữ chỗ lịch hẹn trước, lúc này trạng thái thanh toán vẫn là chưa thanh toán.
        const insertResult = await query(
            `
            INSERT INTO LichHen(
                id_caKham, 
                id_khachHang, 
                id_chuyenKhoa, 
                gioHen, 
                donGia, 
                loaiKham, 
                trangThai, 
                trangThaiThanhToan
            )
            VALUES (?, ?, ?, ?, ?, ?, 'ChoDuyet', 'ChuaThanhToan')
            `,
            [id_ca, id_khachHang, id_chuyenKhoa, gioHenThucTe, donGia, loaiKham]
        );

        const id_lichHen_new = insertResult.insertId;

        // Tạo mã đơn riêng để website và ZaloPay cùng nhận biết đúng lịch hẹn.
        const transID = Math.floor(Math.random() * 1000000);
        const app_trans_id = `${taoTienToNgayVietNam()}_${transID}_${id_lichHen_new}`;

        // Lưu mã đơn ZaloPay vào lịch hẹn để dùng lại khi callback hoặc kiểm tra trạng thái.
        await query(
            `
            UPDATE LichHen 
            SET maZalo = ? 
            WHERE id_lichHen = ?
            `,
            [app_trans_id, id_lichHen_new]
        );

        // Gói toàn bộ thông tin cần thiết để ZaloPay tạo trang thanh toán.
        const order = {
            app_id: Number(configZaloPay.app_id),
            app_trans_id: app_trans_id,
            app_user: "Khach_Hang_" + id_khachHang,
            app_time: Date.now(),
            item: JSON.stringify([
                {
                    id_lichHen: id_lichHen_new,
                    id_chuyenKhoa: id_chuyenKhoa
                }
            ]),
            embed_data: JSON.stringify({
                redirecturl: `${APP_URL}/thongTinLichKham?id=${encodeURIComponent(id_lichHen_new)}`
            }),
            amount: Number(donGia),
            description: `Thanh toan phi dat lich kham - Ma Don: #${id_lichHen_new}`,
            bank_code: "",
            expire_duration_seconds: 900,
            callback_url: `${APP_URL}/callback`
        };

        // Ghép dữ liệu theo đúng thứ tự ZaloPay quy định rồi tạo MAC bằng key1.
        const dataMac =
            configZaloPay.app_id + "|" +
            order.app_trans_id + "|" +
            order.app_user + "|" +
            order.amount + "|" +
            order.app_time + "|" +
            order.embed_data + "|" +
            order.item;

        order.mac = CryptoJS.HmacSHA256(dataMac, configZaloPay.key1).toString();

        logThanhToan(`Tạo đơn LH-${id_lichHen_new}, mã ZaloPay ${app_trans_id}`);

        // Gửi đơn sang ZaloPay Sandbox để lấy đường dẫn thanh toán.
        const response = await axios.post(configZaloPay.endpoint, order);

        if (response.data.return_code === 1) {
            logThanhToan(`Khởi tạo thanh toán thành công LH-${id_lichHen_new}`);

            // Frontend nhận payUrl rồi chuyển khách sang trang thanh toán ZaloPay.
            return res.json({
                success: true,
                payUrl: response.data.order_url
            });
        }

        logLoi(`Khởi tạo thanh toán thất bại LH-${id_lichHen_new}`, {
            response: {
                data: response.data
            }
        });

        // ZaloPay không tạo được đơn thì xóa lịch vừa giữ chỗ để không chiếm suất.
        await query(
            `
            DELETE FROM LichHen 
            WHERE id_lichHen = ?
            `,
            [id_lichHen_new]
        );

        return res.json({
            success: false,
            msg: 'Không thể khởi tạo cổng thanh toán ZaloPay'
        });

    } catch (error) {
        logLoi("Không thể kết nối hoặc xử lý API ZaloPay", error);

        return res.json({
            success: false,
            msg: 'Lỗi kết nối hệ thống ZaloPay'
        });
    }
};

/* ================= LỊCH SỬ KHÁM ================= */
// Lấy danh sách các lịch đã đặt của đúng khách hàng đang đăng nhập.
const getLichSu = async (req, res) => {
    try {
        if (!req.session || !req.session.user) {
            return res.redirect('/login');
        }

        const id_khachHang = req.session.user.id;
        const csrfToken = createCsrfToken(req, 'lichSuDatLich');

        // Mỗi trang hiển thị tối đa 10 lịch hẹn.
        const limit = 10;
        const page = parseInt(req.query.page) || 1;
        const offset = (page - 1) * limit;

        const countSql = `
            SELECT COUNT(*) AS total 
            FROM LichHen 
            WHERE id_khachHang = ?
        `;

        const countResult = await query(countSql, [id_khachHang]);

        const totalRows = countResult[0].total;
        const totalPages = Math.ceil(totalRows / limit);

        const sql = `
            SELECT 
                lh.id_lichHen,
                lh.donGia,
                ck.id_chuyenKhoa,
                ck.tenChuyenKhoa,
                c.ngay,
                lh.gioHen,
                lh.trangThai,
                lh.trangThaiThanhToan,
                lh.maZalo,
                lh.maZalopay,
                nd.hoTen AS tenBacSi,
                lh.ghiChu
            FROM LichHen lh
            JOIN CaKham c ON lh.id_caKham = c.id_caKham
            JOIN ChuyenKhoa ck ON lh.id_chuyenKhoa = ck.id_chuyenKhoa
            LEFT JOIN BacSi bs ON c.id_bacSi = bs.id
            LEFT JOIN NguoiDung nd ON bs.id = nd.id
            WHERE lh.id_khachHang = ?
            ORDER BY c.ngay DESC, lh.gioHen DESC
            LIMIT ? OFFSET ?
        `;

        // Lấy dữ liệu lịch hẹn kèm chuyên khoa, bác sĩ và trạng thái thanh toán.
        const rows = await query(sql, [id_khachHang, limit, offset]);

        // Tính còn bao nhiêu ngày nữa đến lịch khám.
        const now = new Date();
        const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());

        const lichSuFormat = [];

        for (let item of rows) {
            // Nếu callback ZaloPay bị mất, trang lịch sử sẽ tự kiểm tra lại
            // và cập nhật TiDB trước khi hiển thị trạng thái.
            if (item.trangThaiThanhToan === 'ChuaThanhToan' && item.maZalo) {
                try {
                    await dongBoTrangThaiThanhToan(item);
                } catch (syncError) {
                    logLoi(
                        `Không đồng bộ được trạng thái LH-${item.id_lichHen}`,
                        syncError
                    );
                }
            }

            const dateObj = new Date(item.ngay);

            let gioStr = '';

            if (typeof item.gioHen === 'string') {
                gioStr = item.gioHen.substring(0, 5);
            } else {
                gioStr = String(item.gioHen).substring(0, 5);
            }

            dateObj.setHours(0, 0, 0, 0);

            const diffDays = Math.ceil((dateObj - today) / (1000 * 60 * 60 * 24));

            // Quyết định giao diện có hiện nút Hủy lịch hay không.
            let isCoTheHuy = false;

            if (item.trangThai === 'Huy' || item.trangThai === 'HoanThanh' || item.trangThai === 'DenTre') {
                isCoTheHuy = false;
            } else if (item.trangThaiThanhToan === 'ChuaThanhToan') {
                isCoTheHuy = true;
            } else if (item.trangThaiThanhToan === 'DaThanhToan') {
                isCoTheHuy = diffDays >= 2;
            }

            const [hh, mm] = gioStr.split(':').map(Number);

            const exactDateTime = new Date(item.ngay);
            exactDateTime.setHours(hh, mm, 0, 0);

            // Chỉ hiện nút Xem vé khi đã trả tiền, lịch chưa bị hủy và chưa quá giờ khám.
            let isCoTheXemVe = false;

            if (
                item.trangThaiThanhToan === 'DaThanhToan' &&
                item.trangThai !== 'Huy' &&
                item.trangThai !== 'DenTre' &&
                exactDateTime >= now
            ) {
                isCoTheXemVe = true;
            }

            lichSuFormat.push({
                ...item,
                ngay: moment(item.ngay).format('DD/MM/YYYY'),
                gioHen: gioStr,
                coTheHuy: isCoTheHuy,
                coTheXemVe: isCoTheXemVe
            });
        }

        // Gửi dữ liệu đã xử lý sang trang lịch sử đặt lịch.
        res.render('khachHang/datLich/lichSuDatLich', {
            page: 'lichSuDatLich',
            lichSu: lichSuFormat,
            user: req.session.user,
            csrfToken,
            pagination: {
                currentPage: page,
                totalPages: totalPages
            }
        });

    } catch (error) {
        logLoi("Lỗi khi lấy lịch sử đặt lịch", error);
        res.status(500).send("Lỗi server");
    }
};

/* ================= HỦY LỊCH & HOÀN TIỀN ================= */
// Một hàm xử lý cả hai trường hợp:
// - Chưa thanh toán: xóa lịch luôn.
// - Đã thanh toán: gửi yêu cầu hoàn tiền sang ZaloPay rồi mới cập nhật trạng thái.
const huyLichHen = async (req, res) => {
    try {
        if (!req.session || !req.session.user || !req.session.user.id) {
            return res.json({
                success: false,
                msg: 'Hết phiên làm việc, vui lòng đăng nhập lại!'
            });
        }

        if (!verifyCsrfToken(req, 'lichSuDatLich')) {
            return res.status(403).json({ success: false, msg: 'CSRF detected' });
        }

        // Luôn lấy mã khách hàng từ session, không lấy từ dữ liệu người dùng tự gửi lên.
        const id_khachHang = Number(req.session.user.id);
        const id_lichHen = req.body && req.body.id_lichHen;

        // Chỉ lấy lịch nếu lịch đó thật sự thuộc về khách hàng đang đăng nhập.
        const lichHenList = await query(
            `
            SELECT
                lh.*,
                c.ngay
            FROM LichHen lh
            JOIN CaKham c
                ON lh.id_caKham = c.id_caKham
            WHERE lh.id_lichHen = ? AND lh.id_khachHang = ?
            LIMIT 1
            `,
            [
                id_lichHen,
                id_khachHang
            ]
        );

        if (lichHenList.length === 0) {
            return res.json({
                success: false,
                msg: 'Không tìm thấy lịch hẹn của bạn!'
            });
        }

        // Lấy lịch hẹn duy nhất vừa tìm được để kiểm tra tiếp.
        const lichHen =
            lichHenList[0];

        if (
            lichHen.trangThai === 'Huy'
        ) {
            return res.json({
                success: false,
                msg: 'Lịch hẹn này đã được hủy trước đó!'
            });
        }

        if (
            lichHen.trangThai === 'HoanThanh'
        ) {
            return res.json({
                success: false,
                msg: 'Không thể hủy lịch đã khám hoàn thành!'
            });
        }

        if (
            lichHen.trangThai === 'DenTre'
        ) {
            return res.json({
                success: false,
                msg: 'Không thể hủy lịch đã bị đánh dấu đến trễ!'
            });
        }
        /*
         * LỊCH CHƯA THANH TOÁN:
         * Chưa có tiền đi qua ZaloPay nên chỉ cần xóa lịch hẹn khỏi database.
         */
        if (lichHen.trangThaiThanhToan === 'ChuaThanhToan') {
            const deleteResult =
                await query(
                    `
                    DELETE FROM LichHen
                    WHERE id_lichHen = ?
                      AND id_khachHang = ?
                      AND trangThaiThanhToan = 'ChuaThanhToan'
                      AND trangThai NOT IN (
                          'Huy',
                          'HoanThanh',
                          'DenTre'
                      )
                    `,
                    [
                        id_lichHen,
                        id_khachHang
                    ]
                );

            if (deleteResult.affectedRows !== 1) {
                return res.json({
                    success: false,
                    msg: 'Lịch hẹn đã thay đổi trạng thái. Vui lòng tải lại trang!'
                });
            }

            console.log(
                `[HUY LICH] KH-${id_khachHang} ` +
                `đã xóa lịch chưa thanh toán ` +
                `LH-${id_lichHen}`
            );

            return res.json({
                success: true,
                msg: 'Đã hủy bỏ lịch hẹn'
            });
        }

        if (lichHen.trangThaiThanhToan === 'DaHoanTien') {
            return res.json({
                success: false,
                msg: 'Lịch hẹn này đã được hoàn tiền trước đó!'
            });
        }

        if (lichHen.trangThaiThanhToan !== 'DaThanhToan') {
            return res.json({
                success: false,
                msg: 'Trạng thái thanh toán không hợp lệ để hủy lịch!'
            });
        }

        /*
         * Lịch đã thanh toán chỉ được hủy
         * trước ngày khám tối thiểu 2 ngày.
         */
        const now = new Date();

        const today = new Date(
            now.getFullYear(),
            now.getMonth(),
            now.getDate()
        );

        const dateObj = new Date(lichHen.ngay);
        dateObj.setHours(
            0,
            0,
            0,
            0
        );

        const diffDays =
            Math.ceil(
                (dateObj - today) /
                (
                    1000 *
                    60 *
                    60 *
                    24
                )
            );

        if (
            diffDays < 2
        ) {
            return res.json({
                success: false,
                msg: 'Không thể hủy lịch đã thanh toán khi thời gian khám còn dưới 2 ngày!'
            });
        }

        if (
            !lichHen.maZalopay
        ) {
            return res.json({
                success: false,
                msg: 'Không thể hoàn tiền do thiếu mã giao dịch ZaloPay.'
            });
        }

        /*
         * Chỉ cần key1 khi thực sự thực hiện hoàn tiền.
         */
        damBaoCoKey1ZaloPay();

        const app_id = String(configZaloPay.app_id);

        const zp_trans_id = String(lichHen.maZalopay);

        const amount = String(
            Math.round(
                Number(
                    lichHen.donGia
                )
            )
        );

        const timestamp =
            String(
                Date.now()
            );

        // Tạo mã riêng cho yêu cầu hoàn tiền này.
        const m_refund_id =
            `${moment().format('YYMMDD')}_` +
            `${app_id}_` +
            `${Date.now()}`;

        const description =
            `Hoan tien lich hen ` +
            `LH-${id_lichHen}`;

        /*
         * Chuỗi ký MAC hoàn tiền:
         *
         * app_id|zp_trans_id|amount|description|timestamp
         */
        const hmacInput =
            `${app_id}|` +
            `${zp_trans_id}|` +
            `${amount}|` +
            `${description}|` +
            `${timestamp}`;

        const mac =
            CryptoJS
                .HmacSHA256(
                    hmacInput,
                    configZaloPay.key1
                )
                .toString();

        // Gom các thông tin hoàn tiền thành dạng form để gửi cho ZaloPay.
        const params = new URLSearchParams();

        params.append(
            'app_id',
            app_id
        );

        params.append(
            'm_refund_id',
            m_refund_id
        );

        params.append(
            'zp_trans_id',
            zp_trans_id
        );

        params.append(
            'amount',
            amount
        );

        params.append(
            'timestamp',
            timestamp
        );

        params.append(
            'description',
            description
        );

        params.append(
            'mac',
            mac
        );

        console.log(
            `[HOAN TIEN] KH-${id_khachHang} ` +
            `gửi refund LH-${id_lichHen}, ` +
            `zp_trans_id=${zp_trans_id}, ` +
            `amount=${amount}`
        );

        // Gửi yêu cầu hoàn tiền sang ZaloPay Sandbox.
        const refundResponse =
            await axios.post(
                configZaloPay.refundEndpoint,
                params.toString(),
                {
                    headers: {
                        'Content-Type':
                            'application/x-www-form-urlencoded'
                    }
                }
            );

        const refundData =
            refundResponse.data;

        console.log(
            `[HOAN TIEN] Kết quả refund ` +
            `LH-${id_lichHen}:`,
            refundData
        );

        if (
            refundData.return_code === 1 ||
            refundData.return_code === 3
        ) {
            /*
             * Tiếp tục kiểm tra chủ sở hữu ở câu UPDATE.
             *
             * Không UPDATE theo id_lichHen,
             * vì request có thể đã bị sửa ID.
             */
            // ZaloPay đã nhận yêu cầu thì mới đổi lịch thành Đã hủy và Đã hoàn tiền.
            const updateResult =
                await query(
                    `
                    UPDATE LichHen
                    SET
                        trangThai = 'Huy',
                        trangThaiThanhToan = 'DaHoanTien'
                    WHERE id_lichHen = ?
                      AND id_khachHang = ?
                      AND trangThaiThanhToan = 'DaThanhToan'
                      AND trangThai NOT IN (
                          'Huy',
                          'HoanThanh',
                          'DenTre'
                      )
                    `,
                    [
                        id_lichHen,
                        id_khachHang
                    ]
                );

            if (updateResult.affectedRows !== 1) {
                logLoi(
                    `ZaloPay đã nhận refund ` +
                    `nhưng không thể cập nhật TiDB ` +
                    `cho LH-${id_lichHen}, ` +
                    `KH-${id_khachHang}.`
                );

                return res.json({
                    success: false,
                    msg: 'Yêu cầu hoàn tiền đã được gửi nhưng hệ thống chưa cập nhật được trạng thái. Vui lòng liên hệ hỗ trợ!'
                });
            }

            return res.json({
                success: true,

                msg:
                    refundData.return_code === 1
                        ? 'Hủy lịch và hoàn tiền thành công!'
                        : 'Đã gửi yêu cầu hoàn tiền. ZaloPay đang xử lý giao dịch hoàn tiền!'
            });
        }

        return res.json({
            success: false,

            msg:
                'Lỗi hoàn tiền: ' +
                (
                    refundData.sub_return_message ||
                    refundData.return_message ||
                    'Không rõ nguyên nhân'
                )
        });
    } catch (error) {
        console.error(
            '[LOI] Lỗi khi hủy lịch và hoàn tiền'
        );

        if (
            error.response &&
            error.response.data
        ) {
            console.error(
                error.response.data
            );
        } else {
            console.error(
                error.message
            );
        }

        return res.json({
            success: false,
            msg: 'Lỗi server khi hủy lịch'
        });
    }
};

/* ================= THANH TOÁN LẠI ZALOPAY ================= */
// Dùng khi lịch hẹn đã tồn tại nhưng lần thanh toán trước chưa hoàn tất.
const thanhToanLai = async (req, res) => {
    try {
        if (!req.session || !req.session.user) {
            return res.json({
                success: false,
                msg: 'Hết phiên làm việc, vui lòng đăng nhập lại!'
            });
        }

        if (!verifyCsrfToken(req, 'lichSuDatLich')) {
            return res.status(403).json({ success: false, msg: 'CSRF detected' });
        }

        damBaoCoKey1ZaloPay();

        // Trình duyệt chỉ gửi mã lịch hẹn; giá tiền sẽ được lấy lại từ database.
        const { id_lichHen } = req.body;
        const id_khachHang = req.session.user.id;

        if (!id_lichHen) {
            return res.json({
                success: false,
                msg: 'Thiếu mã lịch hẹn!'
            });
        }

        // Không tin donGia hoặc id_chuyenKhoa gửi từ trình duyệt.
        // Luôn lấy lại dữ liệu thật từ TiDB để tránh sửa giá thanh toán.
        const lichHenRows = await query(
            `
            SELECT id_lichHen, id_chuyenKhoa, donGia, trangThaiThanhToan
            FROM LichHen
            WHERE id_lichHen = ?
              AND id_khachHang = ?
            LIMIT 1
            `,
            [id_lichHen, id_khachHang]
        );

        if (lichHenRows.length === 0) {
            return res.json({
                success: false,
                msg: 'Không tìm thấy lịch hẹn của bạn!'
            });
        }

        const lichHen = lichHenRows[0];

        if (lichHen.trangThaiThanhToan === 'DaThanhToan') {
            return res.json({
                success: false,
                msg: 'Lịch hẹn này đã được thanh toán!'
            });
        }

        // Mỗi lần thanh toán lại sẽ tạo một mã đơn ZaloPay mới.
        const transID = Math.floor(Math.random() * 1000000);
        const app_trans_id = `${taoTienToNgayVietNam()}_${transID}_${id_lichHen}`;

        await query(
            `
            UPDATE LichHen
            SET maZalo = ?
            WHERE id_lichHen = ?
              AND id_khachHang = ?
            `,
            [app_trans_id, id_lichHen, id_khachHang]
        );

        // Tạo lại đơn thanh toán từ dữ liệu thật vừa lấy trong database.
        const order = {
            app_id: Number(configZaloPay.app_id),
            app_trans_id: app_trans_id,
            app_user: 'Khach_Hang_' + id_khachHang,
            app_time: Date.now(),
            item: JSON.stringify([
                {
                    id_lichHen: id_lichHen,
                    id_chuyenKhoa: lichHen.id_chuyenKhoa
                }
            ]),
            embed_data: JSON.stringify({
                redirecturl: `${APP_URL}/thongTinLichKham?id=${encodeURIComponent(id_lichHen)}`
            }),
            amount: Number(lichHen.donGia),
            description: `Thanh toan phi dat lich kham - Ma Don: #${id_lichHen}`,
            bank_code: '',
            expire_duration_seconds: 900,
            callback_url: `${APP_URL}/callback`
        };

        const dataMac =
            configZaloPay.app_id + '|' +
            order.app_trans_id + '|' +
            order.app_user + '|' +
            order.amount + '|' +
            order.app_time + '|' +
            order.embed_data + '|' +
            order.item;

        order.mac = CryptoJS.HmacSHA256(
            dataMac,
            configZaloPay.key1
        ).toString();

        logThanhToan(`Tạo thanh toán lại LH-${id_lichHen}, mã ${app_trans_id}`);

        const response = await axios.post(configZaloPay.endpoint, order);

        if (response.data.return_code === 1) {
            logThanhToan(`Khởi tạo thanh toán lại thành công LH-${id_lichHen}`);

            return res.json({
                success: true,
                payUrl: response.data.order_url
            });
        }

        logLoi(`Tạo thanh toán lại thất bại LH-${id_lichHen}`, {
            response: {
                data: response.data
            }
        });

        return res.json({
            success: false,
            msg: 'Không thể tạo cổng thanh toán ZaloPay'
        });

    } catch (error) {
        logLoi('Lỗi khi thanh toán lại', error);

        return res.json({
            success: false,
            msg: error.message || 'Lỗi server'
        });
    }
};
// 1. Hàm hỗ trợ gửi mail độc lập
const guiMailChoDonHang = async (app_trans_id) => {
    try {
        const infoRows = await query(
            `SELECT lh.*, nd.email, nd.hoTen, ck.tenChuyenKhoa, ca.ngay
             FROM LichHen lh
             JOIN NguoiDung nd ON lh.id_khachHang = nd.id
             JOIN ChuyenKhoa ck ON lh.id_chuyenKhoa = ck.id_chuyenKhoa
             JOIN CaKham ca ON lh.id_caKham = ca.id_caKham
             WHERE lh.maZalo = ?`,
            [app_trans_id]
        );

        if (infoRows.length > 0 && infoRows[0].email) {
            const data = infoRows[0];
            data.gioHenChinhXac = typeof data.gioHen === 'string'
                ? data.gioHen.substring(0, 5)
                : String(data.gioHen).substring(0, 5);

            await sendSuccessEmail(data.email, data);
        }
    } catch (err) {
        logLoi("Lỗi gửi mail sau thanh toán", err);
    }
};
/* ================= CALLBACK ZALOPAY ================= */
// Sau khi khách thanh toán, ZaloPay tự gọi vào hàm này để báo kết quả cho server.
const callbackZaloPay = async (req, res) => {
    let result = {};

    try {
        damBaoCoKey2ZaloPay();

        // data là nội dung giao dịch, mac là mã để kiểm tra dữ liệu có bị giả hay sửa hay không.
        const dataStr = req.body && req.body.data;
        const reqMac = req.body && req.body.mac;

        if (!dataStr || !reqMac) {
            result.return_code = 2;
            result.return_message = 'missing data or mac';
            return res.json(result);
        }

        // Server tự tính lại MAC bằng key2 rồi so với MAC ZaloPay gửi đến.
        const mac = CryptoJS.HmacSHA256(dataStr, configZaloPay.key2).toString();

        if (reqMac !== mac) {
            logLoi("Callback ZaloPay sai MAC. Kiểm tra lại key2.");

            result.return_code = -1;
            result.return_message = "mac not equal";

            return res.json(result);
        }

        // MAC hợp lệ thì mới mở dữ liệu giao dịch ra để xử lý.
        const dataJson = JSON.parse(dataStr);

        const app_trans_id = dataJson.app_trans_id;
        const zp_trans_id = dataJson.zp_trans_id;

        const idLichHen = app_trans_id.split('_').pop();

        // Cập nhật lịch hẹn sang Đã thanh toán; câu UPDATE chỉ đổi đơn còn Chưa thanh toán.
        const affectedRows = await capNhatThanhToanThanhCong(app_trans_id, zp_trans_id);
        // Luôn thử gửi Email bất kể affectedRows có > 0 hay không
        await guiMailChoDonHang(app_trans_id);
        if (affectedRows > 0) {
            logThanhToan(`Thanh toán thành công LH-${idLichHen}, ZP-${zp_trans_id}`);

            // Lấy thông tin lịch và email để gửi thư xác nhận cho khách.
            const infoRows = await query(
                `
                SELECT lh.*, nd.email, nd.hoTen, ck.tenChuyenKhoa, ca.ngay
                FROM LichHen lh
                JOIN NguoiDung nd ON lh.id_khachHang = nd.id
                JOIN ChuyenKhoa ck ON lh.id_chuyenKhoa = ck.id_chuyenKhoa
                JOIN CaKham ca ON lh.id_caKham = ca.id_caKham
                WHERE lh.maZalo = ?
                `,
                [app_trans_id]
            );

            if (infoRows.length > 0) {
                const data = infoRows[0];

                data.gioHenChinhXac = typeof data.gioHen === 'string'
                    ? data.gioHen.substring(0, 5)
                    : String(data.gioHen).substring(0, 5);

                if (data.email) {
                    await sendSuccessEmail(data.email, data);
                }
            }
        } else {
            logThanhToan(`Callback hợp lệ nhưng đơn đã được cập nhật trước đó hoặc không còn ChuaThanhToan: ${app_trans_id}`);
        }

        // Báo ngược lại cho ZaloPay rằng server đã nhận và xử lý callback.
        result.return_code = 1;
        result.return_message = "success";

    } catch (error) {
        logLoi("Lỗi xử lý callback ZaloPay", error);

        result.return_code = 0;
        result.return_message = error.message;
    }

    res.json(result);
};

/* ================= GỬI EMAIL THÔNG BÁO ================= */
// Soạn email chứa mã lịch, chuyên khoa, ngày giờ và số tiền đã thanh toán.
const sendSuccessEmail = async (email, details) => {
    const mailOptions = {
        from: `"Phòng Khám Đa Khoa" <${gmailUser}>`,
        to: email,
        subject: 'Xác nhận thanh toán thành công - Lịch hẹn khám bệnh',
        html: `
            <div style="font-family: sans-serif; line-height: 1.5;">
                <h2 style="color: #2e7d32;">Thanh toán thành công!</h2>

                <p>Chào bạn,</p>

                <p>Phòng khám đã nhận được thanh toán cho lịch hẹn của bạn. Dưới đây là thông tin chi tiết:</p>

                <table style="width: 100%; border-collapse: collapse;">
                    <tr>
                        <td style="padding: 8px; border: 1px solid #ddd;"><b>Mã lịch hẹn:</b></td>
                        <td style="padding: 8px; border: 1px solid #ddd; font-weight: bold; color: #1565c0;">LH-${details.id_lichHen}</td>
                    </tr>

                    <tr>
                        <td style="padding: 8px; border: 1px solid #ddd;"><b>Chuyên khoa:</b></td>
                        <td style="padding: 8px; border: 1px solid #ddd;">${details.tenChuyenKhoa}</td>
                    </tr>

                    <tr>
                        <td style="padding: 8px; border: 1px solid #ddd;"><b>Thời gian dự kiến:</b></td>
                        <td style="padding: 8px; border: 1px solid #ddd; font-weight: bold; color: #d32f2f;">
                            ${details.gioHenChinhXac} - ${moment(details.ngay).format('DD/MM/YYYY')}
                        </td>
                    </tr>

                    <tr>
                        <td style="padding: 8px; border: 1px solid #ddd;"><b>Số tiền đã thanh toán:</b></td>
                        <td style="padding: 8px; border: 1px solid #ddd;">
                            ${Number(details.donGia).toLocaleString('vi-VN')} VNĐ
                        </td>
                    </tr>
                </table>

                <p>Vui lòng đến trước giờ hẹn từ 5-10 phút để làm thủ tục. Cảm ơn bạn đã tin tưởng chúng tôi!</p>

                <hr>

                <p style="font-size: 12px; color: #888;">
                    Đây là email tự động, vui lòng không phản hồi email này.
                </p>
            </div>
        `
    };

    if (!transporter) {
        console.log('[MAIL] Chưa cấu hình GMAIL_USER hoặc GMAIL_APP_PASSWORD, bỏ qua gửi email.');
        return;
    }

    try {
        // Gửi email xác nhận đến địa chỉ của khách hàng.
        await transporter.sendMail(mailOptions);
        console.log(`[MAIL] Đã gửi xác nhận đến ${email}`);
    } catch (error) {
        logLoi("Lỗi gửi email xác nhận", error);
    }
};

/* ================= THÔNG TIN LỊCH KHÁM ================= */
// Trang này chính là "vé khám" mà khách được xem sau khi thanh toán thành công.
const getThongTinLichKham = async (req, res) => {
    try {
        if (!req.session || !req.session.user) {
            return res.redirect('/login');
        }

        // id khách lấy từ session, còn id lịch hẹn lấy trên đường dẫn quay về từ ZaloPay.
        const id_khachHang = req.session.user.id;
        const id_lichHen = req.query.id;
        const statusZalo = req.query.status;
        const apptransid = req.query.apptransid || req.query.app_trans_id;

        if (!id_lichHen) {
            return res.redirect('/lichSuDatLichKham');
        }

        if (statusZalo && statusZalo !== '1') {
            logThanhToan(`Thanh toán chưa hoàn tất LH-${id_lichHen}`);
            return res.redirect('/lichSuDatLichKham');
        }

        // Chỉ lấy vé nếu lịch đó thuộc đúng khách hàng đang đăng nhập.
        const infoRows = await query(
            `
            SELECT
                lh.*,
                nd.hoTen,
                ck.tenChuyenKhoa,
                ca.ngay,
                bs_nd.hoTen AS tenBacSi
            FROM LichHen lh
            JOIN NguoiDung nd ON lh.id_khachHang = nd.id
            JOIN ChuyenKhoa ck ON lh.id_chuyenKhoa = ck.id_chuyenKhoa
            JOIN CaKham ca ON lh.id_caKham = ca.id_caKham
            LEFT JOIN BacSi bs ON ca.id_bacSi = bs.id
            LEFT JOIN NguoiDung bs_nd ON bs.id = bs_nd.id
            WHERE lh.id_lichHen = ?
              AND lh.id_khachHang = ?
            LIMIT 1
            `,
            [id_lichHen, id_khachHang]
        );

        if (infoRows.length === 0) {
            return res.redirect('/lichSuDatLichKham');
        }

        const data = infoRows[0];

        if (
            apptransid &&
            data.maZalo &&
            apptransid !== data.maZalo
        ) {
            logLoi(
                `apptransid trên URL không khớp mã đơn LH-${id_lichHen}. ` +
                'Hệ thống sẽ dùng mã đã lưu trong TiDB.'
            );
        }

        // Không chỉ tin status=1 trên URL. Luôn hỏi lại ZaloPay bằng maZalo
        // đã lưu trong TiDB trước khi công nhận thanh toán thành công.
        if (
            data.trangThaiThanhToan === 'ChuaThanhToan' &&
            data.maZalo
        ) {
            try {
                await dongBoTrangThaiThanhToan(data);
            } catch (queryError) {
                logLoi(
                    `Không query được trạng thái ZaloPay LH-${id_lichHen}`,
                    queryError
                );
            }
        }

        // Sau khi kiểm tra lại mà vẫn chưa thanh toán thì không cho xem vé.
        if (data.trangThaiThanhToan !== 'DaThanhToan') {
            logThanhToan(`Chặn xem vé chưa thanh toán LH-${id_lichHen}`);
            return res.redirect('/lichSuDatLichKham');
        }

        data.gioHenChinhXac = typeof data.gioHen === 'string'
            ? data.gioHen.substring(0, 5)
            : String(data.gioHen).substring(0, 5);

        data.ngayFormat = moment(data.ngay).format('DD/MM/YYYY');

        logThanhToan(`Hiển thị vé khám LH-${id_lichHen}`);

        // Thanh toán đã được xác nhận, lúc này mới hiển thị vé khám.
        return res.render('khachHang/datLich/thongTinLichKham', {
            page: 'thongTinLichKham',
            user: req.session.user,
            data: data
        });

    } catch (error) {
        logLoi('Lỗi lấy thông tin lịch khám', error);
        return res.redirect('/');
    }
};

/* ================= CRONJOB DỌN DẸP ================= */
// Cứ mỗi 60 giây, hệ thống dọn các lịch giữ chỗ quá lâu nhưng chưa thanh toán.
setInterval(async () => {
    try {
        /*
         * Lấy các lịch hẹn chưa thanh toán đã được tạo quá 5 phút.
         *
         * Trước khi xóa, hệ thống vẫn hỏi lại ZaloPay để tránh trường hợp
         * khách hàng đã thanh toán nhưng callback chưa cập nhật database.
         */
        const pendingRows = await query(
            `
            SELECT
                id_lichHen,
                maZalo,
                maZalopay,
                trangThaiThanhToan,
                created_at
            FROM LichHen
            WHERE trangThaiThanhToan = 'ChuaThanhToan'
              AND created_at <= (NOW() - INTERVAL 5 MINUTE)
            ORDER BY created_at ASC
            LIMIT 100
            `
        );

        // Xử lý lần lượt từng lịch đang chờ thanh toán.
        for (const lichHen of pendingRows) {
            let duocPhepXoa = !lichHen.maZalo;

            /*
             * Nếu lịch có mã giao dịch ZaloPay,
             * phải kiểm tra lại trạng thái trước khi xóa.
             */
            if (lichHen.maZalo) {
                try {
                    const daThanhToan =
                        await dongBoTrangThaiThanhToan(
                            lichHen
                        );

                    /*
                     * Nếu ZaloPay xác nhận đã thanh toán,
                     * trạng thái đã được đồng bộ và lịch không bị xóa.
                     */
                    if (daThanhToan) {
                        continue;
                    }

                    /*
                     * Query ZaloPay thành công nhưng giao dịch
                     * chưa được ghi nhận thanh toán.
                     */
                    duocPhepXoa = true;
                } catch (queryError) {
                    /*
                     * Nếu không kết nối được ZaloPay thì không xóa,
                     * tránh xóa nhầm lịch thực tế đã thanh toán.
                     */
                    duocPhepXoa = false;

                    logLoi(
                        `Cronjob không query được ZaloPay ` +
                        `LH-${lichHen.id_lichHen}`,
                        queryError
                    );
                }
            }

            // Chưa chắc chắn thì giữ nguyên, thà không xóa còn hơn xóa nhầm lịch đã trả tiền.
            if (!duocPhepXoa) {
                continue;
            }

            /*
             * Kiểm tra lại điều kiện ngay trong câu DELETE
             * để tránh xóa lịch vừa được thanh toán trong lúc cronjob chạy.
             */
            const deleteResult = await query(
                `
                DELETE FROM LichHen
                WHERE id_lichHen = ?
                  AND trangThaiThanhToan = 'ChuaThanhToan'
                  AND created_at <= (NOW() - INTERVAL 5 MINUTE)
                `,
                [
                    lichHen.id_lichHen
                ]
            );

            if (deleteResult.affectedRows > 0) {
                console.log(
                    `[DON DEP] Đã xóa lịch chưa thanh toán ` +
                    `quá 5 phút LH-${lichHen.id_lichHen}`
                );
            }
        }
    } catch (error) {
        logLoi(
            'Lỗi cronjob dọn dẹp lịch chưa thanh toán',
            error
        );
    }
}, 60000);

/* ================= EXPORT MODULES ================= */
// Đưa các hàm này ra ngoài để file route/controller khác gọi được.
module.exports = {
    handleBookingAndPayment,
    getLichSu,
    huyLichHen,
    thanhToanLai,
    callbackZaloPay,
    getThongTinLichKham
};

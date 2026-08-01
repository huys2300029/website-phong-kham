const con = require('../../config/connectDatabase');

// Tạo hàm query dùng Promise từ biến con
const query = async (sql, params = []) => {
    const [rows] = await con.promise().query(sql, params);
    return rows;
};
const nodemailer = require('nodemailer');
const axios = require('axios');
const CryptoJS = require('crypto-js');
const moment = require('moment');

/* ================= CẤU HÌNH URL HỆ THỐNG ================= */
// Render tự cung cấp RENDER_EXTERNAL_URL, ví dụ:
// https://benhviendakhoa.onrender.com
// Khi chạy local, hệ thống tự dùng http://localhost:3000.
const APP_URL = (
    process.env.APP_URL ||
    process.env.RENDER_EXTERNAL_URL ||
    'http://localhost:3000'
).replace(/\/+$/, '');

/* ================= CẤU HÌNH ZALOPAY ================= */
const configZaloPay = {
    app_id: process.env.ZALOPAY_APP_ID || '2553',
    key1: process.env.ZALOPAY_KEY1,
    key2: process.env.ZALOPAY_KEY2,

    endpoint: 'https://sb-openapi.zalopay.vn/v2/create',
    refundEndpoint: 'https://sb-openapi.zalopay.vn/v2/refund',
    queryEndpoint: 'https://sb-openapi.zalopay.vn/v2/query'
};

/* ================= CẤU HÌNH GỬI MAIL ================= */
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

const damBaoCoKey1ZaloPay = () => {
    if (!configZaloPay.key1) {
        throw new Error('Thiếu biến môi trường ZALOPAY_KEY1 trên Render.');
    }
};

const damBaoCoKey2ZaloPay = () => {
    if (!configZaloPay.key2) {
        throw new Error('Thiếu biến môi trường ZALOPAY_KEY2 trên Render.');
    }
};

// ZaloPay yêu cầu phần ngày trong app_trans_id theo múi giờ Việt Nam GMT+7.
const taoTienToNgayVietNam = () => moment().utcOffset(7).format('YYMMDD');
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

const queryTrangThaiDonHangZaloPay = async (app_trans_id) => {
    damBaoCoKey1ZaloPay();

    const app_id = String(configZaloPay.app_id);

    // Theo API /v2/query:
    // mac = HMAC_SHA256(key1, app_id + "|" + app_trans_id + "|" + key1)
    const hmacInput = `${app_id}|${app_trans_id}|${configZaloPay.key1}`;
    const mac = CryptoJS.HmacSHA256(hmacInput, configZaloPay.key1).toString();

    const params = new URLSearchParams();
    params.append('app_id', app_id);
    params.append('app_trans_id', app_trans_id);
    params.append('mac', mac);

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
const handleBookingAndPayment = async (res, req, id_ca, id_chuyenKhoa, ngay, gioHen, id_khachHang, loaiKham = 'Thuong') => {
    try {
        damBaoCoKey1ZaloPay();

        let donGia = 0;

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

        const bookedMinutes = bookedData.map(row => {
            const timeStr = typeof row.gioHen === 'string' ? row.gioHen : String(row.gioHen);
            return parseInt(timeStr.split(':')[1], 10);
        });

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

        const transID = Math.floor(Math.random() * 1000000);
        const app_trans_id = `${taoTienToNgayVietNam()}_${transID}_${id_lichHen_new}`;

        await query(
            `
            UPDATE LichHen 
            SET maZalo = ? 
            WHERE id_lichHen = ?
            `,
            [app_trans_id, id_lichHen_new]
        );

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

        const response = await axios.post(configZaloPay.endpoint, order);

        if (response.data.return_code === 1) {
            logThanhToan(`Khởi tạo thanh toán thành công LH-${id_lichHen_new}`);

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
const getLichSu = async (req, res) => {
    try {
        if (!req.session || !req.session.user) {
            return res.redirect('/login');
        }

        const id_khachHang = req.session.user.id;

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

        const rows = await query(sql, [id_khachHang, limit, offset]);

        const now = new Date();
        const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());

        const lichSuFormat = [];

        for (let item of rows) {
            // Nếu callback ZaloPay bị mất, trang lịch sử sẽ tự kiểm tra lại
            // và cập nhật TiDB trước khi hiển thị trạng thái.
            if (
                item.trangThaiThanhToan === 'ChuaThanhToan' &&
                item.maZalo
            ) {
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

        res.render('khachHang/datLich/lichSuDatLich', {
            page: 'lichSuDatLich',
            lichSu: lichSuFormat,
            user: req.session.user,
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
const huyLichHen = async (req, res) => {
    try {
        if (!req.session || !req.session.user || !req.session.user.id) {
            return res.json({
                success: false,
                msg: 'Hết phiên làm việc, vui lòng đăng nhập lại!'
            });
        }

        const id_khachHang = Number(req.session.user.id);
        const id_lichHen = req.body && req.body.id_lichHen;

        const lichHenList = await query(
            `
            SELECT
                lh.*,
                c.ngay
            FROM LichHen lh
            JOIN CaKham c
                ON lh.id_caKham = c.id_caKham
            WHERE lh.id_lichHen = ?
            LIMIT 1
            `,
            [
                id_lichHen,
                // id_khachHang
            ]
        );

        if (lichHenList.length === 0) {
            return res.json({
                success: false,
                msg: 'Không tìm thấy lịch hẹn của bạn!'
            });
        }

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
         */
        if (
            lichHen.trangThaiThanhToan === 'ChuaThanhToan'
        ) {
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
                msg: 'Đã hủy bỏ lịch hẹn chưa thanh toán!'
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
const thanhToanLai = async (req, res) => {
    try {
        if (!req.session || !req.session.user) {
            return res.json({
                success: false,
                msg: 'Hết phiên làm việc, vui lòng đăng nhập lại!'
            });
        }

        damBaoCoKey1ZaloPay();

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

/* ================= CALLBACK ZALOPAY ================= */
const callbackZaloPay = async (req, res) => {
    let result = {};

    try {
        damBaoCoKey2ZaloPay();

        const dataStr = req.body && req.body.data;
        const reqMac = req.body && req.body.mac;

        if (!dataStr || !reqMac) {
            result.return_code = 2;
            result.return_message = 'missing data or mac';
            return res.json(result);
        }

        const mac = CryptoJS.HmacSHA256(dataStr, configZaloPay.key2).toString();

        if (reqMac !== mac) {
            logLoi("Callback ZaloPay sai MAC. Kiểm tra lại key2.");

            result.return_code = -1;
            result.return_message = "mac not equal";

            return res.json(result);
        }

        const dataJson = JSON.parse(dataStr);

        const app_trans_id = dataJson.app_trans_id;
        const zp_trans_id = dataJson.zp_trans_id;

        const idLichHen = app_trans_id.split('_').pop();

        const affectedRows = await capNhatThanhToanThanhCong(app_trans_id, zp_trans_id);

        if (affectedRows > 0) {
            logThanhToan(`Thanh toán thành công LH-${idLichHen}, ZP-${zp_trans_id}`);

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
        await transporter.sendMail(mailOptions);
        console.log(`[MAIL] Đã gửi xác nhận đến ${email}`);
    } catch (error) {
        logLoi("Lỗi gửi email xác nhận", error);
    }
};

/* ================= THÔNG TIN LỊCH KHÁM ================= */
const getThongTinLichKham = async (req, res) => {
    try {
        if (!req.session || !req.session.user) {
            return res.redirect('/login');
        }

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

        if (data.trangThaiThanhToan !== 'DaThanhToan') {
            logThanhToan(`Chặn xem vé chưa thanh toán LH-${id_lichHen}`);
            return res.redirect('/lichSuDatLichKham');
        }

        data.gioHenChinhXac = typeof data.gioHen === 'string'
            ? data.gioHen.substring(0, 5)
            : String(data.gioHen).substring(0, 5);

        data.ngayFormat = moment(data.ngay).format('DD/MM/YYYY');

        logThanhToan(`Hiển thị vé khám LH-${id_lichHen}`);

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
module.exports = {
    handleBookingAndPayment,
    getLichSu,
    huyLichHen,
    thanhToanLai,
    callbackZaloPay,
    getThongTinLichKham
};
const con = require('../../config/connectDatabase');

// Tạo hàm query dùng Promise từ biến con
const query = async (sql, params = []) => {
    const [rows] = await con.promise().query(sql, params);
    return rows;
};
const { handleBookingAndPayment } = require('./thanhToan');

const TIMES = [
    "07:00",
    "08:00",
    "09:00",
    "10:00",
    "13:00",
    "14:00",
    "15:00",
    "16:00"
];

/* ================= HELPER ================= */
function makeLocalDate(yyyyMMdd, timeHHMM) {
    const [y, m, d] = yyyyMMdd.split('-').map(Number);
    const [hh, mm] = timeHHMM.split(':').map(Number);
    return new Date(y, m - 1, d, hh, mm, 0);
}

/* ================= LUỒNG KHÁM CHUYÊN GIA ================= */
const getDatLichChuyenGia = async (req, res) => {
    try {
        const chuyenKhoa = await query("SELECT * FROM ChuyenKhoa");

        res.render("khachHang/datLich/datLichChuyenGia", {
            page: "lichhen",
            chuyenKhoa,
            user: req.session.user
        });

    } catch (error) {
        console.error("Lỗi khi load trang đặt lịch chuyên gia:", error);
        res.status(500).send("Lỗi server");
    }
};

const getBacSiByChuyenKhoa = async (req, res) => {
    try {
        const { id_chuyenKhoa } = req.query;

        if (!id_chuyenKhoa) {
            return res.json({
                success: false,
                msg: 'Thiếu chuyên khoa'
            });
        }

        const sql = `
            SELECT 
                bs.id AS id_bacSi, 
                nd.hoTen, 
                bs.chiTiet, 
                bs.namTotNghiep, 
                bs.trinhDo,
                bs.hinhAnh 
            FROM BacSi bs
            JOIN NguoiDung nd ON bs.id = nd.id
            WHERE bs.id_chuyenKhoa = ?
        `;

        const danhSachBacSi = await query(sql, [id_chuyenKhoa]);

        const currentYear = new Date().getFullYear();

        const dataWithExperience = danhSachBacSi.map(bs => ({
            ...bs,
            namKinhNghiem: bs.namTotNghiep ? (currentYear - bs.namTotNghiep) : 0
        }));

        return res.json({
            success: true,
            data: dataWithExperience
        });

    } catch (error) {
        console.error("Lỗi lấy danh sách bác sĩ:", error);

        res.json({
            success: false,
            msg: 'Lỗi server'
        });
    }
};

/* ================= TRANG CHỌN THỜI GIAN ================= */
const getChonThoiGian = async (req, res) => {
    try {
        const { bacSiId } = req.query;

        if (!bacSiId) {
            return res.redirect('/datLichChuyenGia');
        }

        const sqlBacSi = `
            SELECT 
                bs.id AS id_bacSi, 
                nd.hoTen, 
                ck.id_chuyenKhoa, 
                ck.tenChuyenKhoa,
                bs.hinhAnh 
            FROM BacSi bs
            JOIN NguoiDung nd ON bs.id = nd.id
            JOIN ChuyenKhoa ck ON bs.id_chuyenKhoa = ck.id_chuyenKhoa
            WHERE bs.id = ?
        `;

        const bacSiInfo = await query(sqlBacSi, [bacSiId]);

        if (bacSiInfo.length === 0) {
            return res.status(404).send("Không tìm thấy thông tin bác sĩ");
        }

        const sqlCaKham = `
            SELECT ngay 
            FROM CaKham 
            WHERE id_bacSi = ? 
              AND ngay >= CURDATE()
            ORDER BY ngay ASC
        `;

        const caKhamList = await query(sqlCaKham, [bacSiId]);

        res.render("khachHang/datLich/chonThoiGianChuyenGia", {
            page: "lichhen",
            bacSi: bacSiInfo[0],
            caKhamList,
            user: req.session.user
        });

    } catch (error) {
        console.error("Lỗi khi load trang chọn thời gian chuyên gia:", error);
        res.status(500).send("Lỗi server");
    }
};

const getSlotsChuyenGia = async (req, res) => {
    const now = new Date();

    try {
        const { ngay, id_bacSi } = req.query;

        if (!ngay || !id_bacSi) {
            return res.json({
                success: false,
                msg: 'Thiếu thông tin ngày hoặc bác sĩ'
            });
        }

        const caKham = await query(
            `
            SELECT id_caKham 
            FROM CaKham 
            WHERE ngay = ? 
              AND id_bacSi = ? 
            LIMIT 1
            `,
            [ngay, id_bacSi]
        );

        if (!caKham.length) {
            const slots = TIMES.map(time => ({
                time,
                disabled: true
            }));

            return res.json({
                success: true,
                slots,
                msg: 'Bác sĩ không có lịch ngày này'
            });
        }

        const id_ca = caKham[0].id_caKham;

        const rows = await query(
            `
            SELECT 
                SUBSTRING(gioHen, 1, 2) AS hourPart, 
                COUNT(*) AS total 
            FROM LichHen 
            WHERE id_caKham = ? 
              AND trangThai != 'Huy' 
            GROUP BY SUBSTRING(gioHen, 1, 2)
            `,
            [id_ca]
        );

        const map = {};

        rows.forEach(r => {
            map[`${r.hourPart}:00`] = r.total;
        });

        const slots = TIMES.map(time => {
            const dt = makeLocalDate(ngay, time);
            const tooLate = dt < now;
            const count = map[time] || 0;
            const disabled = tooLate || count >= 6;

            return {
                time,
                disabled
            };
        });

        return res.json({
            success: true,
            slots
        });

    } catch (err) {
        console.error('[getSlotsChuyenGia] Lỗi:', err);

        res.json({
            success: false,
            msg: 'Lỗi server'
        });
    }
};

const postDatLichChuyenGia = async (req, res) => {
    const { id_chuyenKhoa, id_bacSi, ngay, gioHen } = req.body;

    if (!req.session || !req.session.user) {
        return res.json({
            success: false,
            msg: 'Vui lòng đăng nhập để đặt lịch!'
        });
    }

    if (!id_chuyenKhoa || !id_bacSi || !ngay || !gioHen) {
        return res.json({
            success: false,
            msg: 'Thiếu thông tin đặt lịch!'
        });
    }

    if (!TIMES.includes(gioHen)) {
        return res.json({
            success: false,
            msg: 'Khung giờ này không hợp lệ. Khám chuyên gia không nhận lịch từ 11:00 đến 12:00.'
        });
    }

    const id_khachHang = req.session.user.id;

    try {
        const caKham = await query(
            `
            SELECT id_caKham 
            FROM CaKham 
            WHERE ngay = ? 
              AND id_bacSi = ? 
            LIMIT 1
            `,
            [ngay, id_bacSi]
        );

        if (!caKham.length) {
            return res.json({
                success: false,
                msg: 'Hiện chưa có lịch làm việc của bác sĩ này.'
            });
        }

        const id_ca = caKham[0].id_caKham;

        await handleBookingAndPayment(
            res,
            req,
            id_ca,
            id_chuyenKhoa,
            ngay,
            gioHen,
            id_khachHang,
            'ChuyenGia'
        );

    } catch (error) {
        console.error("Lỗi đặt lịch chuyên gia:", error);

        return res.json({
            success: false,
            msg: 'Lỗi server'
        });
    }
};

module.exports = {
    getDatLichChuyenGia,
    getBacSiByChuyenKhoa,
    getChonThoiGian,
    getSlotsChuyenGia,
    postDatLichChuyenGia
};
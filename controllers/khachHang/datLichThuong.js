const con = require('../../config/connectDatabase');

// Tạo hàm query dùng Promise từ biến con
const query = async (sql, params = []) => {
    const [rows] = await con.promise().query(sql, params);
    return rows;
};

const { handleBookingAndPayment } = require('./thanhToan');

const TIMES = [
    "07:00","08:00","09:00","10:00","11:00",
    "13:00","14:00","15:00","16:00"
];

/* ================= HELPER ================= */
function makeLocalDate(yyyyMMdd, timeHHMM) {
    return new Date(`${yyyyMMdd}T${timeHHMM}:00+07:00`);
}

/* ================= LUỒNG TRANG CHỦ ĐẶT LỊCH ================= */
const getChonHinhThuc = (req, res) => {
    res.render("khachHang/datLich/chonHinhThuc", {
        page: "lichhen",
        user: req.session.user
    });
};

/* ================= LUỒNG KHÁM THƯỜNG ================= */
const getDatLich = async (req, res) => {
    try {
        const chuyenKhoa = await query("SELECT * FROM ChuyenKhoa");
        res.render("khachHang/datLich/datLichHen", {
            page: "lichhen",
            chuyenKhoa,
            user: req.session.user
        });
    } catch (error) {
        console.error("Lỗi khi load trang đặt lịch:", error);
        res.status(500).send("Lỗi server");
    }
};

const getSlots = async (req, res) => {
    const now = new Date();
    try {
        const { ngay, id_chuyenKhoa } = req.query;

        if (!ngay || !id_chuyenKhoa) {
            return res.json({ success: false, msg: 'Thiếu thông tin ngày hoặc chuyên khoa' });
        }

        const caKham = await query(
            `SELECT ck.id_caKham 
             FROM CaKham ck
             JOIN BacSi bs ON ck.id_bacSi = bs.id
             WHERE ck.ngay = ? AND bs.id_chuyenKhoa = ?
             LIMIT 1`,
            [ngay, id_chuyenKhoa]
        );

        if (!caKham.length) {
            const slots = TIMES.map(time => {
                return { time, disabled: true };
            });
            return res.json({ success: true, slots, msg: 'Không có lịch làm việc ngày này' });
        }

        const id_ca = caKham[0].id_caKham;
        
        const rows = await query(
            `SELECT SUBSTRING(gioHen, 1, 2) as hourPart, COUNT(*) as total 
             FROM LichHen 
             WHERE id_caKham = ? AND trangThai != 'Huy' 
             GROUP BY SUBSTRING(gioHen, 1, 2)`,
            [id_ca]
        );

        const map = {};
        rows.forEach(r => {
            const timeString = `${r.hourPart}:00`; 
            map[timeString] = r.total;
        });

        const slots = TIMES.map(time => {
            const dt = makeLocalDate(ngay, time);
            const tooLate = dt < now;
            const count = map[time] || 0;
            const disabled = tooLate || count >= 6; 
            return { time, disabled };
        });

        return res.json({ success: true, slots });

    } catch (err) {
        console.error('[getSlots] Lỗi:', err);
        res.json({ success: false, msg: 'Lỗi server' });
    }
};

const postDatLich = async (req, res) => {
    const { id_chuyenKhoa, ngay, gioHen } = req.body;

    if (!req.session || !req.session.user) {
        return res.json({ success: false, msg: 'Vui lòng đăng nhập để đặt lịch!' });
    }

    const id_khachHang = req.session.user.id; 

    try {
        const caKham = await query(
            `SELECT ck.id_caKham FROM CaKham ck
             JOIN BacSi bs ON ck.id_bacSi = bs.id
             WHERE ck.ngay = ? AND bs.id_chuyenKhoa = ? LIMIT 1`,
            [ngay, id_chuyenKhoa]
        );

        if (!caKham.length) return res.json({ success: false, msg: 'Hiện chưa có lịch làm việc của chuyên khoa này.' });
        
        const id_ca = caKham[0].id_caKham;
        // Gọi hàm dùng chung từ thanhToan.js
        await handleBookingAndPayment(res, req, id_ca, id_chuyenKhoa, ngay, gioHen, id_khachHang);

    } catch (error) {
        console.error("Lỗi đặt lịch thường:", error);
        return res.json({ success: false, msg: 'Lỗi server' });
    }
};

module.exports = {
    getChonHinhThuc,
    getDatLich,
    getSlots,
    postDatLich
};
const con = require('../../config/connectDatabase');

// Tạo hàm query dùng Promise từ biến con
const query = async (sql, params = []) => {
    const [rows] = await con.promise().query(sql, params);
    return rows;
};

/* ================= HELPER XỬ LÝ MÚI GIỜ VIỆT NAM ================= */

// Tính tuổi chính xác theo múi giờ Việt Nam
function tinhTuoiVN(ngaySinh) {
    if (!ngaySinh) return 'Chưa rõ';

    // Lấy YYYY-MM-DD theo múi giờ Việt Nam
    const nowStr = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Ho_Chi_Minh' });
    const birthStr = new Date(ngaySinh).toLocaleDateString('en-CA', { timeZone: 'Asia/Ho_Chi_Minh' });

    const [tYear, tMonth, tDay] = nowStr.split('-').map(Number);
    const [bYear, bMonth, bDay] = birthStr.split('-').map(Number);

    let age = tYear - bYear;
    if (tMonth < bMonth || (tMonth === bMonth && tDay < bDay)) {
        age--;
    }
    return age >= 0 ? age : 'Chưa rõ';
}

// Định dạng ngày hiển thị (DD/MM/YYYY) chuẩn múi giờ Việt Nam
function formatNgayVN(dateObj) {
    if (!dateObj) return 'Chưa cập nhật';
    return new Date(dateObj).toLocaleDateString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh' });
}

/* ================= CONTROLLER ================= */

const chanDoan = {
    getChanDoan: async (req, res) => {
        try {
            const idLichHen = req.params.id;

            const sqlLichHen = `
                SELECT 
                    lh.*, 
                    nd.hoTen, 
                    nd.soDienThoai,
                    kh.diaChi, 
                    kh.gioiTinh, 
                    kh.ngaySinh, 
                    kh.id AS id_khachHang,
                    ck.tenChuyenKhoa, 
                    ca.ngay AS ngayKham
                FROM LichHen lh
                JOIN KhachHang kh ON lh.id_khachHang = kh.id
                JOIN NguoiDung nd ON kh.id = nd.id
                LEFT JOIN ChuyenKhoa ck ON lh.id_chuyenKhoa = ck.id_chuyenKhoa
                LEFT JOIN CaKham ca ON lh.id_caKham = ca.id_caKham
                WHERE lh.id_lichHen = ?
            `;

            const [lichHenRows] = await con.promise().query(sqlLichHen, [idLichHen]);

            if (lichHenRows.length === 0) {
                return res.status(404).send("Không tìm thấy lịch hẹn hoặc đã bị xóa.");
            }

            const patientInfo = lichHenRows[0];

            // 1. Tính tuổi theo múi giờ VN
            patientInfo.tuoi = tinhTuoiVN(patientInfo.ngaySinh);

            // 2. Format hiển thị ngày khám & ngày sinh tránh bị lùi ngày ở View
            patientInfo.ngayKhamHienThi = formatNgayVN(patientInfo.ngayKham);
            patientInfo.ngaySinhHienThi = formatNgayVN(patientInfo.ngaySinh);

            const sqlLichSu = `
                SELECT 
                    lh.id_lichHen,
                    lh.ghiChu,
                    lh.trangThai,
                    lh.gioHen,
                    ck.tenChuyenKhoa,
                    ca.ngay AS ngayKham
                FROM LichHen lh
                JOIN CaKham ca ON lh.id_caKham = ca.id_caKham
                LEFT JOIN ChuyenKhoa ck ON lh.id_chuyenKhoa = ck.id_chuyenKhoa
                WHERE lh.id_khachHang = ?
                  AND lh.trangThai = 'HoanThanh'
                  AND lh.id_lichHen != ?
                ORDER BY ca.ngay DESC, lh.gioHen DESC
            `;

            const [lichSuKham] = await con.promise().query(sqlLichSu, [
                patientInfo.id_khachHang,
                idLichHen
            ]);

            // 3. Format ngày khám cho lịch sử khám bệnh
            const lichSuFormatted = lichSuKham.map(item => ({
                ...item,
                ngayKhamHienThi: formatNgayVN(item.ngayKham)
            }));

            res.render('bacSi/chanDoan', {
                user: req.session.user,
                page: 'khamBenh',
                patient: patientInfo,
                lichSu: lichSuFormatted
            });

        } catch (error) {
            console.error("Lỗi trang chẩn đoán:", error);
            res.status(500).send("Lỗi server khi lấy thông tin khám bệnh.");
        }
    },

    postHoanThanhKham: async (req, res) => {
        try {
            const idLichHen = req.params.id;
            const { ghiChuBacSi } = req.body;

            const sqlUpdate = `
                UPDATE LichHen 
                SET ghiChu = ?, trangThai = 'HoanThanh' 
                WHERE id_lichHen = ?
            `;

            await con.promise().query(sqlUpdate, [ghiChuBacSi, idLichHen]);

            res.redirect('/bacsi/khamBenh');

        } catch (error) {
            console.error("Lỗi khi hoàn thành khám bệnh:", error);
            res.status(500).send("Lỗi server khi lưu kết quả khám.");
        }
    }
};

module.exports = chanDoan;
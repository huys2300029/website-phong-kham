const xlsx = require('xlsx');
const multer = require('multer');
const path = require('path');
const fs = require('fs');

// 1. IMPORT QUAN TRỌNG: Lấy cả con và query từ file connectDatabase
const con = require('../../config/connectDatabase');

// Tạo hàm query dùng Promise từ biến con
const query = async (sql, params = []) => {
    const [rows] = await con.promise().query(sql, params);
    return rows;
};

// --- CẤU HÌNH MULTER RIÊNG CHO LỊCH TRỰC ---
const storage = multer.diskStorage({
    destination: function (req, file, cb) {
        const dir = 'Public/uploads/lichTruc/';
        // Tự động tạo thư mục lichTruc nếu chưa có
        if (!fs.existsSync(dir)) {
            fs.mkdirSync(dir, { recursive: true });
        }
        cb(null, dir);
    },
    filename: function (req, file, cb) {
        cb(null, Date.now() + '-' + Math.round(Math.random() * 1E9) + path.extname(file.originalname));
    }
});
const uploadLichTruc = multer({ storage: storage }).single('excelFile');

// Hàm chuyển đổi ngày Excel hoặc chuỗi "dd/mm" thành YYYY-MM-DD
function parseDateExcel(dateValue, year) {
    if (!dateValue) return null;
    
    // Trường hợp 1: Excel trả về số (Serial Date)
    if (typeof dateValue === 'number') {
        const date = new Date((dateValue - (25567 + 2)) * 86400 * 1000);
        return date.toISOString().split('T')[0];
    }
    
    // Trường hợp 2: Excel trả về chuỗi "02/01"
    if (typeof dateValue === 'string') {
        const parts = dateValue.trim().split('/');
        if (parts.length >= 2) {
            const d = parts[0].padStart(2, '0');
            const m = parts[1].padStart(2, '0');
            const y = parts.length === 3 ? parts[2] : year;
            return `${y}-${m}-${d}`;
        }
    }
    return null;
}

function getWeekRange(dateInput) {
    const curr = dateInput ? new Date(dateInput) : new Date();
    let currentDay = curr.getDay();
    if (currentDay === 0) currentDay = 7;

    const startOfWeek = new Date(curr);
    startOfWeek.setDate(curr.getDate() - (currentDay - 1));

    const endOfWeek = new Date(startOfWeek);
    endOfWeek.setDate(startOfWeek.getDate() + 6);
    
    startOfWeek.setHours(0,0,0,0);
    endOfWeek.setHours(23,59,59,999);
    
    return { start: startOfWeek, end: endOfWeek };
}

function formatForSQL(dateObj) {
    const year = dateObj.getFullYear();
    const month = (dateObj.getMonth() + 1).toString().padStart(2, '0');
    const day = dateObj.getDate().toString().padStart(2, '0');
    return `${year}-${month}-${day}`;
}

function formatDateVN(dateObj) {
    const d = new Date(dateObj);
    return `${d.getDate().toString().padStart(2, '0')}/${(d.getMonth() + 1).toString().padStart(2, '0')}/${d.getFullYear()}`;
}

async function fetchDataForView(dateInput) {
    const { start, end } = getWeekRange(dateInput);
    const startStr = formatForSQL(start);
    const endStr = formatForSQL(end);
    
    const weekLabel = `Từ ngày ${formatDateVN(start)} đến ${formatDateVN(end)}`;
    
    const sql = `
        SELECT ck.id_caKham AS id, ck.ngay, nd.hoTen AS tenBacSi,
            bs.id AS idBacSi, ckhoa.id_chuyenKhoa AS idKhoa, ckhoa.tenChuyenKhoa AS khoa
        FROM CaKham ck
        JOIN BacSi bs ON ck.id_bacSi = bs.id
        JOIN NguoiDung nd ON bs.id = nd.id
        LEFT JOIN ChuyenKhoa ckhoa ON bs.id_chuyenKhoa = ckhoa.id_chuyenKhoa
        WHERE ck.ngay >= ? AND ck.ngay <= ?
        ORDER BY ck.ngay ASC, ckhoa.tenChuyenKhoa ASC
    `;
    const rawData = await query(sql, [startStr, endStr]);

    const groupedData = {};
    rawData.forEach(item => {
        const d = new Date(item.ngay);
        const dateKey = formatForSQL(d);
        const dateVN = formatDateVN(d);
        if (!groupedData[dateKey]) groupedData[dateKey] = [];
        groupedData[dateKey].push({ ...item, dateDisplay: dateVN, khoa: item.khoa || 'Chưa phân khoa' });
    });

    const finalData = Object.keys(groupedData).map(key => ({
        date: key,
        dateDisplay: groupedData[key][0].dateDisplay,
        shifts: groupedData[key]
    }));

    return { weekData: finalData, currentInputVal: startStr, weekLabel };
}

// ---------------------------------------------------------
// CONTROLLER FUNCTIONS
// ---------------------------------------------------------

const getQuanLyCaKham = async (req, res) => {
    try {
        let selectedDate = new Date();
        if (req.query.week) {
            const parts = req.query.week.split('-');
            if (parts.length === 3) {
                selectedDate = new Date(parseInt(parts[0]), parseInt(parts[1]) - 1, parseInt(parts[2]));
            }
        }
        const data = await fetchDataForView(selectedDate);
        const msg = req.query.msg || null;

        res.render('admin/quanLyCaKham/quanLyCaKham', { ...data, msg: msg });
    } catch (err) {
        console.error("Lỗi:", err);
        res.status(500).send("Lỗi server");
    }
};

const getBacSi = async (req, res) => {
    try {
        const { idKhoa } = req.params;
        const sql = `SELECT bs.id, nd.hoTen FROM BacSi bs JOIN NguoiDung nd ON bs.id = nd.id WHERE bs.id_chuyenKhoa = ?`;
        const listBacSi = await query(sql, [idKhoa]);
        res.json({ success: true, data: listBacSi });
    } catch (err) {
        console.error(err);
        res.status(500).json({ success: false, message: "Lỗi Server" });
    }
};

const updateBacSiCaKham = async (req, res) => {
    try {
        const { idCaKham, idBacSiMoi } = req.body;
        await query("UPDATE CaKham SET id_bacSi = ? WHERE id_caKham = ?", [idBacSiMoi, idCaKham]);
        res.redirect('getQuanLyCaKham');
    } catch (err) {
        console.error(err);

        req.session.uiMessage = {
            type: 'error',
            title: 'Lỗi cập nhật',
            message: 'Không thể cập nhật bác sĩ cho ca khám.'
        };

        return res.redirect('/admin/quanLyCaKham');
    }
};

const postUpdateCaTruc = async (req, res) => {
    const { id_caKham, id_bacSiMoi } = req.body;
    try {
        const shiftInfo = await query("SELECT ngay FROM CaKham WHERE id_caKham = ?", [id_caKham]);

        if (shiftInfo.length === 0) {
            req.session.uiMessage = {
                type: 'error',
                title: 'Không tìm thấy ca khám',
                message: 'Không tìm thấy ca khám cần cập nhật.'
            };

            return res.redirect('/admin/quanLyCaKham');
        }

        await query("UPDATE CaKham SET id_bacSi = ? WHERE id_caKham = ?", [id_bacSiMoi, id_caKham]);
        
        const dateOfShift = new Date(shiftInfo[0].ngay);
        const dateRedirect = formatForSQL(dateOfShift);
        req.session.uiMessage = {
            type: 'success',
            title: 'Thành công',
            message: 'Cập nhật ca khám thành công.'
        };

        return res.redirect(`/admin/quanLyCaKham?week=${dateRedirect}`);
    } catch (err) {
        console.error(err);

        req.session.uiMessage = {
            type: 'error',
            title: 'Lỗi cập nhật',
            message: `Lỗi cập nhật: ${err.message}`
        };

        return res.redirect('/admin/quanLyCaKham');
    }
};

// ---------------------------------------------------------
// XỬ LÝ IMPORT EXCEL (Đã bọc middleware upload nội bộ)
// ---------------------------------------------------------
const postImportExcel = (req, res) => {
    uploadLichTruc(req, res, async function (err) {
        try {
            if (err) throw new Error("Lỗi tải file lên hệ thống: " + err.message);

            // 1. Kiểm tra file đầu vào
            if (!req.file) throw new Error("Vui lòng chọn file Excel!");

            let workbook;
            if (req.file.path) {
                workbook = xlsx.readFile(req.file.path);
            } else if (req.file.buffer) {
                workbook = xlsx.read(req.file.buffer, { type: 'buffer' });
            } else {
                throw new Error("Không tìm thấy dữ liệu file!");
            }

            if (!workbook.SheetNames || workbook.SheetNames.length === 0) throw new Error("File Excel rỗng!");

            const sheet = workbook.Sheets[workbook.SheetNames[0]];
            const rows = xlsx.utils.sheet_to_json(sheet, { header: 1 });

            if (!rows || rows.length === 0) throw new Error("File Excel không có dữ liệu!");

            // 2. Lấy năm từ dòng đầu tiên (Tiêu đề)
            let titleText = "";
            if (rows[0] && rows[0].length > 0) {
                titleText = String(rows[0][0]);
            }
            const yearMatch = titleText.match(/(\d{4})/);
            const year = yearMatch ? yearMatch[0] : new Date().getFullYear();

            // 3. Lấy dòng chứa danh sách ngày (Dòng 2)
            const dateRow = (rows.length > 1) ? rows[1] : null;
            if (!dateRow) throw new Error("Không tìm thấy dòng ngày tháng (Dòng thứ 2)!");

            const listDates = [];
            for (let i = 1; i < dateRow.length; i++) {
                const formattedDate = parseDateExcel(dateRow[i], year);
                if (formattedDate) {
                    listDates.push({ colIndex: i, date: formattedDate });
                }
            }
            if (listDates.length === 0) throw new Error("Không đọc được ngày nào hợp lệ từ file!");

            // --- 4. KIỂM TRA QUY TẮC THỜI GIAN (CHẶN QUÁ KHỨ/HIỆN TẠI) ---
            const sortedDates = listDates.map(d => d.date).sort();
            const minDateInFile = sortedDates[0];
            
            const now = new Date();
            const todayStr = now.toISOString().split('T')[0];

            if (minDateInFile <= todayStr) {
                throw new Error(`Không thể Import! File chứa lịch của ngày ${minDateInFile} (quá khứ hoặc hôm nay). Bạn chỉ được Import lịch cho tương lai (từ ngày mai trở đi).`);
            }

            const maxDateInFile = sortedDates[sortedDates.length - 1];

            // --- 5. THỰC HIỆN GHI ĐÈ (XÓA DỮ LIỆU CŨ TRONG KHOẢNG NGÀY) ---
            await query("DELETE FROM CaKham WHERE ngay >= ? AND ngay <= ?", [minDateInFile, maxDateInFile]);

            // --- 6. IMPORT DỮ LIỆU MỚI ---
            const dataRows = rows.slice(3); // Bỏ qua tiêu đề, dòng ngày, dòng thứ
            let count = 0;
            let skippedCount = 0;

            for (const row of dataRows) {
                if (!row || row.length < 2) continue;

                for (const item of listDates) {
                    if (item.colIndex >= row.length) continue;
                    
                    const tenBacSiRaw = row[item.colIndex];
                    if (tenBacSiRaw && typeof tenBacSiRaw === 'string' && tenBacSiRaw.trim() !== "") {
                        const tenBacSi = tenBacSiRaw.trim();

                        // Tìm bác sĩ theo tên
                        const bsResult = await query(
                            "SELECT id FROM NguoiDung WHERE hoTen LIKE ? AND vaiTro = 'BacSi' LIMIT 1",
                            [`%${tenBacSi}%`]
                        );
                        
                        if (bsResult && bsResult.length > 0) {
                            const idBacSi = bsResult[0].id;
                            try {
                                await query("INSERT INTO CaKham (ngay, id_bacSi) VALUES (?, ?)", [item.date, idBacSi]);
                                count++;
                            } catch (err) {
                                skippedCount++;
                            }
                        }
                    }
                }
            }
            
            const message = encodeURIComponent(`Thành công! Đã ghi đè ${count} ca trực từ ngày ${minDateInFile} đến ${maxDateInFile}.`);
            res.redirect(`/admin/quanLyCaKham?msg=${message}`);

        } catch (error) {
            const errorMessage = encodeURIComponent("Lỗi: " + error.message);
            res.redirect(`/admin/quanLyCaKham?msg=${errorMessage}`);
        }
    });
};

module.exports = {
    getQuanLyCaKham, 
    postImportExcel, 
    getBacSi, 
    postUpdateCaTruc, 
    updateBacSiCaKham
};
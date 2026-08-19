const express = require("express");
const router = express.Router();

require("dotenv").config();

// Import db connection (tương thích với cả mysql2/promise và mysql2 thường)
const db = require("../config/connectDatabase");

let aiClient = null;

const HOSPITAL_INFO = {
  tenBenhVien: "Bệnh viện Đa khoa Thành phố Cần Thơ",
  diaChi: "Số 04 Châu Văn Liêm, P. Ninh Kiều, TP. Cần Thơ",
  dienThoai: "(0292) 3 821 236",
  email: "bvdkhoa_tpct@cantho.gov.vn",
  gioiThieu:
    "Bệnh viện Đa khoa Thành phố Cần Thơ là bệnh viện đa khoa phục vụ khám, chữa bệnh cho người dân tại thành phố Cần Thơ và khu vực lân cận.",
};

const OUT_OF_SCOPE_REPLY =
  "Xin lỗi, tôi chỉ hỗ trợ các câu hỏi liên quan đến thông tin bệnh viện, chuyên khoa, bác sĩ, giá khám, phòng khám, dịch vụ khám và hướng dẫn sử dụng website.";

const GEMINI_BUSY_REPLY =
  "Hiện tại hệ thống AI đang quá tải, bạn vui lòng thử lại sau ít phút.";

const ALLOWED_INTENTS = [
  "THONG_TIN_BENH_VIEN",
  "CHUYEN_KHOA",
  "BAC_SI",
  "GIA_KHAM",
  "PHONG_KHAM",
  "DICH_VU_BENH_VIEN",
  "TRIEU_CHUNG",
  "HUONG_DAN_WEBSITE",
  "NGOAI_PHAM_VI",
];

// Hàm bổ trợ gọi Query Database an toàn, chống mất context 'this'
async function executeQuery(sql, params = []) {
  try {
    if (db.promise && typeof db.promise === "function") {
      const [rows] = await db.promise().query(sql, params);
      return rows;
    }
    if (typeof db.query === "function") {
      const result = await db.query(sql, params);
      return Array.isArray(result) && Array.isArray(result[0]) ? result[0] : result;
    }
    throw new Error("Không thể khởi tạo hàm query từ module connectDatabase.");
  } catch (err) {
    console.error("Lỗi khi truy vấn CSDL:", err.message);
    throw err;
  }
}

async function getGeminiClient() {
  if (!aiClient) {
    const { GoogleGenAI } = await import("@google/genai");

    aiClient = new GoogleGenAI({
      apiKey: process.env.GEMINI_API_KEY,
    });
  }

  return aiClient;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isGeminiBusyError(error) {
  const message = error && error.message ? error.message : "";

  return (
    error.status === 503 ||
    message.includes("503") ||
    message.includes("UNAVAILABLE") ||
    message.includes("high demand")
  );
}

async function generateContentWithRetry(ai, requestData) {
  const maxRetry = 2;

  for (let attempt = 1; attempt <= maxRetry + 1; attempt++) {
    try {
      const response = await ai.models.generateContent(requestData);
      return response;
    } catch (error) {
      if (isGeminiBusyError(error) && attempt <= maxRetry) {
        console.log(
          `Gemini đang quá tải, thử lại lần ${attempt}/${maxRetry}...`
        );

        await sleep(1000 * attempt);
        continue;
      }

      throw error;
    }
  }
}

function extractIntentFromGeminiText(text) {
  if (!text || typeof text !== "string") {
    return "NGOAI_PHAM_VI";
  }

  const cleanedText = text
    .replace(/```/g, "")
    .replace(/json/gi, "")
    .trim()
    .toUpperCase();

  for (const intent of ALLOWED_INTENTS) {
    if (cleanedText.includes(intent)) {
      return intent;
    }
  }

  return "NGOAI_PHAM_VI";
}

function cleanBotReply(reply) {
  if (!reply || typeof reply !== "string") {
    return "Hiện tại tôi chưa có thông tin này trong hệ thống.";
  }

  return reply
    .replace(/\*\*/g, "")
    .replace(/^\s*\*\s+/gm, "- ")
    .replace(/^\s*•\s+/gm, "- ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function formatMoney(value) {
  const number = Number(value || 0);
  return number.toLocaleString("vi-VN") + "đ";
}

function formatDate(value) {
  if (!value) return "Chưa cập nhật";

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return String(value);
  }

  return date.toLocaleDateString("vi-VN");
}

/* =========================================================
   LẦN 1: GEMINI PHÂN LOẠI INTENT
========================================================= */

async function classifyIntentByGemini(ai, userQuestion) {
  const classifyInstruction = `
Bạn là bộ phân loại intent cho chatbot của website Bệnh viện Đa khoa Thành phố Cần Thơ.

Nhiệm vụ:
- Đọc câu hỏi của khách hàng.
- Chọn đúng 1 intent duy nhất trong danh sách bên dưới.
- Chỉ trả về đúng tên intent.
- Không giải thích.
- Không thêm dấu câu.
- Không trả về JSON.
- Không trả lời nội dung câu hỏi.

Danh sách intent hợp lệ:

1. THONG_TIN_BENH_VIEN
Dùng khi khách hỏi về tên bệnh viện, địa chỉ, số điện thoại, email, liên hệ, giới thiệu, thông tin chung của bệnh viện.

2. CHUYEN_KHOA
Dùng khi khách hỏi bệnh viện có khoa nào, chuyên khoa nào, khoa Nội/Ngoại/Nhi/Sản/Tai mũi họng khám gì.

3. BAC_SI
Dùng khi khách hỏi danh sách bác sĩ, bác sĩ thuộc khoa nào, trình độ bác sĩ, thông tin bác sĩ.

4. GIA_KHAM
Dùng khi khách hỏi giá khám, phí khám, viện phí, khám thường, khám chuyên gia, bao nhiêu tiền.

5. PHONG_KHAM
Dùng khi khách hỏi phòng khám, số phòng, tầng, phòng ở đâu.

6. TRIEU_CHUNG
Dùng khi khách mô tả triệu chứng như đau bụng, đau đầu, ho, sốt, khó thở, chóng mặt, buồn nôn... để hỏi nên khám khoa nào.

7. NGOAI_PHAM_VI
Dùng khi câu hỏi không liên quan đến bệnh viện, khám bệnh, bác sĩ, chuyên khoa, giá khám, phòng khám hoặc website bệnh viện.

Ví dụ:
- "Bệnh viện ở đâu?" → THONG_TIN_BENH_VIEN
- "Có những chuyên khoa nào?" → CHUYEN_KHOA
- "Bệnh viện có bác sĩ nào?" → BAC_SI
- "Giá khám khoa Nhi bao nhiêu?" → GIA_KHAM
- "Tôi bị đau bụng nên khám khoa nào?" → TRIEU_CHUNG
- "Hôm nay đội nào đá bóng?" → NGOAI_PHAM_VI
`;

  const response = await generateContentWithRetry(ai, {
    model: process.env.GEMINI_MODEL || "gemini-1.5-flash",
    contents: userQuestion,
    config: {
      systemInstruction: classifyInstruction,
      temperature: 0,
      maxOutputTokens: 30,
    },
  });

  const rawIntent = response.text || "";
  const intent = extractIntentFromGeminiText(rawIntent);

  console.log("Gemini intent raw:", rawIntent);
  console.log("Gemini intent parsed:", intent);

  return intent;
}

/* =========================================================
   QUERY DATABASE THEO INTENT (Đã cập nhật hàm executeQuery)
========================================================= */

async function getChuyenKhoaData() {
  const rows = await executeQuery(`
    SELECT 
      id_chuyenKhoa,
      tenChuyenKhoa,
      moTa
    FROM ChuyenKhoa
    ORDER BY id_chuyenKhoa ASC
  `);
  console.log("Lấy dữ liệu Chuyên khoa thành công");
  return rows;
}

async function getBacSiData() {
  const rows = await executeQuery(`
    SELECT
      nd.id,
      nd.hoTen,
      bs.namTotNghiep,
      bs.trinhDo,
      bs.chiTiet,
      ck.tenChuyenKhoa
    FROM BacSi bs
    INNER JOIN NguoiDung nd ON bs.id = nd.id
    LEFT JOIN ChuyenKhoa ck ON bs.id_chuyenKhoa = ck.id_chuyenKhoa
    WHERE nd.vaiTro = 'BacSi'
    ORDER BY ck.id_chuyenKhoa ASC, nd.hoTen ASC
  `);
  console.log("Lấy dữ liệu Bác sĩ thành công");
  return rows;
}

async function getGiaKhamData() {
  const rows = await executeQuery(`
    SELECT
      gk.id_gia,
      ck.tenChuyenKhoa,
      gk.loaiKham,
      gk.donGia,
      gk.ngayApDung
    FROM GiaKham gk
    INNER JOIN ChuyenKhoa ck ON gk.id_chuyenKhoa = ck.id_chuyenKhoa
    ORDER BY ck.id_chuyenKhoa ASC, gk.loaiKham ASC
  `);
  console.log("Lấy dữ liệu Giá Khám thành công");
  return rows;
}

async function getPhongData() {
  const rows = await executeQuery(`
    SELECT
      p.soPhong,
      p.tang,
      p.ghiChu,
      ck.tenChuyenKhoa
    FROM Phong p
    LEFT JOIN ChuyenKhoa ck ON p.id_chuyenKhoa = ck.id_chuyenKhoa
    ORDER BY p.tang ASC, p.soPhong ASC
  `);
  console.log("Lấy dữ liệu Phòng thành công");
  return rows;
}

/* =========================================================
   FORMAT DATABASE ĐỂ GỬI CHO GEMINI LẦN 2
========================================================= */

function formatHospitalInfoForPrompt() {
  return `Tên bệnh viện: ${HOSPITAL_INFO.tenBenhVien}
Địa chỉ: ${HOSPITAL_INFO.diaChi}
Điện thoại: ${HOSPITAL_INFO.dienThoai}
Email: ${HOSPITAL_INFO.email}
Giới thiệu: ${HOSPITAL_INFO.gioiThieu}`;
}

function formatChuyenKhoaForPrompt(rows) {
  if (!rows || rows.length === 0) {
    return "Chưa có dữ liệu chuyên khoa trong database.";
  }

  return rows
    .map((row, index) => {
      return `${index + 1}. ${row.tenChuyenKhoa}
Mô tả: ${row.moTa || "Chưa có mô tả"}`;
    })
    .join("\n\n");
}

function formatBacSiForPrompt(rows) {
  if (!rows || rows.length === 0) {
    return "Chưa có dữ liệu bác sĩ trong database.";
  }

  return rows
    .map((row, index) => {
      return `${index + 1}. ${row.hoTen}
Chuyên khoa: ${row.tenChuyenKhoa || "Chưa phân khoa"}
Trình độ: ${row.trinhDo || "Chưa cập nhật"}
Năm tốt nghiệp: ${row.namTotNghiep || "Chưa cập nhật"}
Chi tiết: ${row.chiTiet || "Chưa cập nhật"}`;
    })
    .join("\n\n");
}

function formatGiaKhamForPrompt(rows) {
  if (!rows || rows.length === 0) {
    return "Chưa có dữ liệu giá khám trong database.";
  }

  const grouped = {};

  rows.forEach((row) => {
    const khoa = row.tenChuyenKhoa || "Chưa rõ chuyên khoa";

    if (!grouped[khoa]) {
      grouped[khoa] = [];
    }

    grouped[khoa].push({
      loaiKham: row.loaiKham,
      donGia: formatMoney(row.donGia),
      ngayApDung: formatDate(row.ngayApDung),
    });
  });

  return Object.keys(grouped)
    .map((tenKhoa) => {
      const giaList = grouped[tenKhoa]
        .map((item) => {
          return `- ${item.loaiKham}: ${item.donGia}`;
        })
        .join("\n");

      return `${tenKhoa}:\n${giaList}`;
    })
    .join("\n\n");
}

function formatPhongForPrompt(rows) {
  if (!rows || rows.length === 0) {
    return "Chưa có dữ liệu phòng khám trong database.";
  }

  return rows
    .map((row, index) => {
      return `${index + 1}. Phòng ${row.soPhong}
Tầng: ${row.tang}
Chuyên khoa: ${row.tenChuyenKhoa || "Chưa gắn chuyên khoa"}
Ghi chú: ${row.ghiChu || "Không có"}`;
    })
    .join("\n\n");
}

async function getDatabaseContextByIntent(intent) {
  const contextItems = [];

  contextItems.push({
    title: "THÔNG TIN CƠ BẢN BỆNH VIỆN",
    content: formatHospitalInfoForPrompt(),
  });

  if (
    intent === "CHUYEN_KHOA" ||
    intent === "TRIEU_CHUNG" ||
    intent === "DICH_VU_BENH_VIEN"
  ) {
    const chuyenKhoaRows = await getChuyenKhoaData();

    contextItems.push({
      title: "DỮ LIỆU CHUYÊN KHOA TỪ DATABASE",
      content: formatChuyenKhoaForPrompt(chuyenKhoaRows),
    });
  }

  if (intent === "BAC_SI") {
    const bacSiRows = await getBacSiData();

    contextItems.push({
      title: "DỮ LIỆU BÁC SĨ TỪ DATABASE",
      content: formatBacSiForPrompt(bacSiRows),
    });
  }

  if (intent === "GIA_KHAM") {
    const giaKhamRows = await getGiaKhamData();

    contextItems.push({
      title: "DỮ LIỆU GIÁ KHÁM TỪ DATABASE",
      content: formatGiaKhamForPrompt(giaKhamRows),
    });
  }

  if (intent === "PHONG_KHAM") {
    const phongRows = await getPhongData();

    contextItems.push({
      title: "DỮ LIỆU PHÒNG KHÁM TỪ DATABASE",
      content: formatPhongForPrompt(phongRows),
    });
  }

  return contextItems;
}

function buildDatabaseContextText(contextItems) {
  if (!contextItems || contextItems.length === 0) {
    return "Không có dữ liệu database phù hợp cho câu hỏi này.";
  }

  return contextItems
    .map((item) => {
      return `${item.title}\n${item.content}`;
    })
    .join("\n\n");
}

/* =========================================================
   LẦN 2: GEMINI NHẬN DATABASE CONTEXT VÀ TRẢ LỜI
========================================================= */

async function answerByGemini(ai, userQuestion, intent, databaseContextText) {
  const answerInstruction = `
Bạn là chatbot hỗ trợ khách hàng cho website Bệnh viện Đa khoa Thành phố Cần Thơ.

Intent của câu hỏi:
${intent}

Nhiệm vụ:
- Trả lời câu hỏi của khách hàng bằng tiếng Việt.
- Chỉ trả lời các câu hỏi liên quan đến bệnh viện.
- Chỉ sử dụng dữ liệu trong phần DATABASE CONTEXT.
- Không tự bịa thông tin nếu dữ liệu không có.
- Nếu dữ liệu không đủ để trả lời, hãy nói: "Hiện tại tôi chưa có thông tin này trong hệ thống."
- Trả lời ngắn gọn, lịch sự, dễ hiểu.
- Không dùng Markdown.
- Không dùng dấu ** để in đậm.
- Không dùng dấu * để tạo danh sách.
- Không dùng bảng.
- Không dùng ký hiệu ###.
- Không mở đầu bằng câu quá dài.
- Nếu trả lời danh sách, mỗi mục nằm trên một dòng riêng.
- Nếu dùng gạch đầu dòng, chỉ dùng dấu "-".
- Nếu trả lời giá khám, trình bày đúng dạng sau:

Bảng giá khám hiện tại:

Khoa Nội:
- Khám thường: 120.000đ
- Khám chuyên gia: 200.000đ

Khoa Nhi:
- Khám thường: 100.000đ
- Khám chuyên gia: 200.000đ

- Nếu khách hỏi triệu chứng, chỉ gợi ý chuyên khoa phù hợp ở mức tham khảo dựa trên danh sách chuyên khoa hiện có.
- Không chẩn đoán bệnh chắc chắn.
- Không kê đơn thuốc.
- Nếu khách mô tả triệu chứng khẩn cấp như đau ngực dữ dội, khó thở nặng, ngất, chảy máu nhiều, hãy khuyên đến cơ sở y tế gần nhất hoặc cấp cứu ngay.
- Không nói rằng bạn có thể đặt lịch trực tiếp trong cuộc trò chuyện.

DATABASE CONTEXT:
${databaseContextText}
`;

  const response = await generateContentWithRetry(ai, {
    model: process.env.GEMINI_MODEL || "gemini-1.5-flash",
    contents: userQuestion,
    config: {
      systemInstruction: answerInstruction,
      temperature: 0.1,
      maxOutputTokens: 700,
    },
  });

  const reply =
    response.text && response.text.trim() !== ""
      ? response.text.trim()
      : "Hiện tại tôi chưa có thông tin này trong hệ thống.";

  return cleanBotReply(reply);
}

/* =========================================================
   ROUTE TEST KẾT NỐI GEMINI
========================================================= */

router.get("/test", async (req, res) => {
  try {
    if (!process.env.GEMINI_API_KEY) {
      return res.status(500).json({
        success: false,
        message: "Thiếu GEMINI_API_KEY trong file .env",
      });
    }

    const ai = await getGeminiClient();

    const response = await generateContentWithRetry(ai, {
      model: process.env.GEMINI_MODEL || "gemini-1.5-flash",
      contents: "Chỉ trả lời đúng một chữ: OK",
    });

    return res.json({
      success: true,
      message: "Kết nối Gemini API thành công",
      geminiReply: response.text,
    });
  } catch (error) {
    console.error("Gemini test error:", error);

    if (isGeminiBusyError(error)) {
      return res.json({
        success: false,
        message: "Gemini API đang quá tải. Vui lòng thử lại sau ít phút.",
      });
    }

    return res.status(500).json({
      success: false,
      message: "Kết nối Gemini API thất bại",
      error: error.message,
    });
  }
});

/* =========================================================
   ROUTE CHATBOT MESSAGE
========================================================= */

router.post("/message", async (req, res) => {
  try {
    const { message } = req.body;

    if (!message || typeof message !== "string" || message.trim() === "") {
      return res.status(400).json({
        success: false,
        reply: "Vui lòng nhập nội dung cần hỏi.",
      });
    }

    if (!process.env.GEMINI_API_KEY) {
      return res.status(500).json({
        success: false,
        reply: "Thiếu GEMINI_API_KEY trong file .env",
      });
    }

    const userQuestion = message.trim();
    const ai = await getGeminiClient();

    console.log("Câu hỏi:", userQuestion);

    const intent = await classifyIntentByGemini(ai, userQuestion);

    console.log("Intent cuối cùng:", intent);

    if (intent === "NGOAI_PHAM_VI") {
      return res.json({
        success: true,
        intent: intent,
        allowed: false,
        source: "GEMINI_INTENT_ONLY",
        reply: OUT_OF_SCOPE_REPLY,
      });
    }

    const databaseContextItems = await getDatabaseContextByIntent(intent);
    const databaseContextText = buildDatabaseContextText(databaseContextItems);

    const reply = await answerByGemini(
      ai,
      userQuestion,
      intent,
      databaseContextText
    );

    return res.json({
      success: true,
      intent: intent,
      allowed: true,
      source: "GEMINI_INTENT_DATABASE_GEMINI",
      reply: reply,
    });
  } catch (error) {
    // In chi tiết lỗi ra Terminal để hỗ trợ debug khi cần
    console.error("Chatbot message error detail:", error);

    if (isGeminiBusyError(error)) {
      return res.json({
        success: false,
        reply: GEMINI_BUSY_REPLY,
      });
    }

    return res.status(500).json({
      success: false,
      reply: "Xin lỗi, hệ thống chatbot đang gặp lỗi. Vui lòng thử lại sau.",
    });
  }
});

module.exports = router;
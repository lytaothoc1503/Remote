# Tiến độ xử lý (VibeCode Remote)

## Đã hoàn thành

| # | Việc | Nơi thực hiện | Kiểm chứng |
|---|---|---|---|
| 1 | Xác thực: PIN bắt buộc, sinh ngẫu nhiên, từ chối PIN yếu, so sánh timing-safe, khóa 5 phút sau 5 lần sai, mặc định chỉ nghe `127.0.0.1` | `server/bridge.cjs` | Test: không PIN → 401; `/health` không PIN chỉ trả `{ok:true}` |
| 2 | Lọc đường dẫn: `/fs`, `/open`, `/context-artifact` giới hạn trong `VIBE_ROOT`; `/context-artifact` chỉ nhận `CLAUDE.md`, `AGENTS.md`, `.vibe-session-handoff.json`; `/cdp` kiểm tra tên method và đường dẫn DevTools | `server/bridge.cjs` | Test: `C:\Windows` → 400, `..\evil.txt` → 400 |
| 3 | `cai-dat.ps1` thật: không `Stop-Process -Force`, hỏi xác nhận trước khi đóng VS Code, kiểm tra cổng 9333/9334 trước khi chạy, không chạy bridge trùng, tường lửa chỉ mở khi `-Lan` (LocalSubnet + Private), Tunnel chỉ bật khi `-Tunnel` | `cai-dat.ps1` | Kiểm tra cú pháp; bridge lần hai tự thoát khi cổng bận |
| 4 | Hàng đợi lệnh CDP tuần tự: phía bridge (theo từng mục tiêu) và phía giao diện; tạm dừng Auto làm mới khi đang gửi lệnh; thêm timeout cho relay | `server/bridge.cjs`, `src/App.tsx` | Build qua |
| 5 | Khung React + Vite + Tailwind để build | `package.json`, `vite.config.ts`, `tsconfig.json`, `index.html`, `src/main.tsx` | `npm run build` thành công |
| 6 | Bổ sung TypeScript type definitions chuẩn hóa toàn bộ `src/App.tsx`, gỡ bỏ hoàn toàn `// @ts-nocheck` | `src/App.tsx` | `tsc --noEmit` & `npm run build` qua 100% không cảnh báo |
| 7 | Khắc phục lỗi video stream bị đen/trống khung hình bằng `activeScreenshotImgRef` preloader | `src/App.tsx` | Khung hình đồng bộ qua `Image.onload` trước khi vẽ lên canvas |
| 8 | Bổ sung công tắc bảo vệ chống chạm nhầm `[Chạm Click: BẬT/TẮT]` và xác nhận 2 lần (2-step confirmation) cho phím nguy hiểm `Ctrl+C` | `src/App.tsx` | Build qua, tránh gián đoạn tiến trình ngoài ý muốn trên mobile |
| + | Sửa lỗi ký tự thoát bị đôi (do bridge không còn nhúng trong chuỗi) | `server/bridge.cjs` | Bridge chạy đúng |
| + | Bỏ PIN mặc định `123456` ở giao diện, báo rõ "Sai PIN" | `src/App.tsx` | Build qua |

## Còn dang dở (cần môi trường thực tế)

- [ ] Chạy thử `cai-dat.ps1` trên máy thật và kiểm tra luồng giao diện với VS Code (cần chạy trực tiếp khi người dùng sẵn sàng bật VS Code cổng 9333).
- [ ] Thử relay `/cdp` với một mục tiêu CDP thật (cổng 9333).
- [ ] Khuyến nghị bảo mật mạng LAN: Khi điều khiển từ ngoài mạng LAN, luôn dùng cờ `-Tunnel` (Cloudflare Tunnel) để mã hóa toàn bộ dữ liệu và PIN qua HTTPS thay vì HTTP thường.

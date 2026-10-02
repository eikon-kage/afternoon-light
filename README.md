# Afternoon Light

App to-do theo hướng thiết kế "Afternoon Light". Màn hẹp dưới 900px dùng giao diện điện thoại, màn rộng dùng giao diện lịch tuần.

- Dữ liệu đồng bộ qua Supabase (Postgres, Auth, Realtime).
- Mất mạng vẫn dùng được.
- Cài được như app (PWA) và nhận thông báo đẩy khi đã đóng app.

## Chạy thử không cần Supabase

```bash
npm install
npm run dev          # mở http://localhost:5173/?demo
```

Dữ liệu demo chỉ lưu trong trình duyệt đang mở.

## Kiểm tra

```bash
npm test             # unit test: thời gian, trạng thái task, thống kê, quy tắc nhắc việc, hàng đợi offline
npm run dev & npm run smoke   # bấm thử thật trên Chrome: tạo, tick, kéo, đổi thời lượng, tìm, các view, bản điện thoại
```

## 1. Kết nối Supabase

1. Tạo project ở supabase.com.
2. Vào SQL Editor, chạy toàn bộ file `supabase/schema.sql`. File này tạo bảng, bật RLS (mỗi người chỉ đọc và ghi dữ liệu của mình), bật Realtime và tạo các bảng cho push.
3. Vào Authentication → URL Configuration, đặt Site URL là `http://localhost:5173`. Khi deploy thì thêm domain thật vào Redirect URLs.
4. Tạo file `.env.local` ở thư mục gốc:
   ```
   VITE_SUPABASE_URL=https://<project>.supabase.co
   VITE_SUPABASE_ANON_KEY=<anon key>
   VITE_VAPID_PUBLIC_KEY=<public key ở bước 2 phần dưới, có thể để trống lúc đầu>
   ```
   Anon key được phép nằm ở phía trình duyệt; RLS là thứ bảo vệ dữ liệu.
5. Chạy lại `npm run dev`, đăng nhập bằng email (magic link).

## 2. Thông báo đẩy khi đã đóng app

Cần cài Supabase CLI (`brew install supabase/tap/supabase`) và đăng nhập (`supabase login`).

1. Liên kết project: `supabase link --project-ref <PROJECT_REF>`.
2. Tạo cặp khóa VAPID: `npx web-push generate-vapid-keys`. Đưa Public Key vào `VITE_VAPID_PUBLIC_KEY`. Private Key giữ bí mật.
3. Đặt secret cho function:
   ```bash
   supabase secrets set VAPID_PUBLIC_KEY=... VAPID_PRIVATE_KEY=... VAPID_SUBJECT=mailto:ban@domain.com CRON_SECRET=<chuỗi ngẫu nhiên dài>
   ```
4. Deploy function: `supabase functions deploy send-reminders --no-verify-jwt`. Function tự kiểm tra `CRON_SECRET`.
5. Mở `supabase/cron.sql`, thay `<PROJECT_REF>` và `<CRON_SECRET>`, rồi chạy trong SQL Editor. Từ đó function chạy mỗi phút.
6. Trong app vào Settings → This device → bật Push notifications. Trên iPhone phải thêm app vào Màn hình chính trước (iOS 16.4 trở lên).

Quy tắc nhắc việc nằm ở một chỗ, `supabase/functions/_shared/rules.ts`. Cả app trong tab lẫn function đều dùng file này. Mỗi lời nhắc có một key riêng và được ghi vào `notification_log`, nên chỉ gửi một lần. Các nút Done / Snooze / Move to tomorrow trên thông báo mở app và thực hiện luôn thao tác đó.

## 3. Deploy web

App là trang tĩnh: `npm run build` tạo ra thư mục `dist/`.

- **Vercel:** import repo, framework Vite, thêm 3 biến `VITE_*` ở Environment Variables. `vercel.json` đã đặt header cache.
- **Netlify:** build `npm run build`, publish `dist`, thêm 3 biến `VITE_*`. `public/_headers` đã đặt header cache.

Sau khi có domain, thêm nó vào Supabase → Authentication → URL Configuration.

## Đồng bộ và offline

- Mọi thay đổi hiện lên giao diện ngay, rồi vào một hàng đợi lưu trong máy (`src/lib/outbox.ts`). Hàng đợi gửi lần lượt lên Supabase.
  - Mất mạng: thay đổi được giữ lại và tự gửi khi có mạng.
  - Server từ chối: thay đổi bị bỏ, app báo lỗi và tải lại dữ liệu.
- Realtime đẩy thay đổi sang các tab và thiết bị khác. Khi kết nối lại, app tải lại toàn bộ và áp lại các thay đổi chưa gửi lên trên.
- Mỗi máy giữ một bản sao để mở app khi offline. Bản sao này bị xoá khi đăng xuất.

## Task lặp lại

Trong form task, mục Repeat có: Every day, Weekdays, Every week, Pick days (chọn thứ).

- Mỗi ngày là một dòng riêng trong bảng `tasks`, cùng chung `series_id`. Ngày nào chưa làm thì vẫn nằm đó và được tính là chưa xong trong thống kê.
- App tạo sẵn 14 ngày tới, cộng thêm những ngày đang xem. Edge Function tạo task của hôm nay cho từng người, nên nhắc việc vẫn chạy dù không mở app.
- Ràng buộc `unique (user_id, series_id, date)` chặn việc hai nơi cùng tạo một ngày.
- Sửa một ngày thì áp dụng cho ngày đó và các ngày sau chưa xong.
- Xoá có hai lựa chọn: "Skip this day" chỉ ẩn ngày đó; "Stop repeating" xoá các ngày từ đó trở đi, các ngày trước được giữ làm lịch sử.
- Dòng task hiện quy tắc lặp (↻ Every day) và chuỗi ngày làm liên tiếp (5-day streak).

## Phím tắt (màn rộng)

`N` tạo task · `T` về hôm nay · `D` / `W` / `M` chọn Day, Week, Month · `←` `→` lùi hoặc tiến một khoảng.

Trên lưới tuần: kéo khối để đổi giờ hoặc ngày, kéo mép dưới để đổi thời lượng, bấm ô trống để tạo task ở giờ đó.

# Mô hình AI và cài đặt

## Các cài đặt nằm ở đâu

Mở **Cài đặt** từ hàng ở góc dưới bên trái của Trang chủ rồi chọn **AI**. Thứ bạn thấy đầu tiên là phần kết nối gói đăng ký. Hầu hết mọi người chỉ cần chừng đó, và phần này có bài riêng: [Kết nối gói đăng ký](help://subscription).

Mọi thứ cần đến khóa đều nằm trong **Nâng cao**, ở cuối chính trang đó. Mục này vẫn đóng cho đến khi bạn mở ra.

## Mặc định: gói đăng ký của bạn

- **AI sử dụng** ban đầu được đặt là **Tự động**: trong các gói đăng ký đã kết nối, Claude được ưu tiên trước, rồi đến ChatGPT, sau đó đến Codex.
- Tự động không bao giờ chọn thứ gì tốn thêm tiền. Khóa API chỉ được dùng trong lúc bạn tự chọn nhà cung cấp đó trong **AI sử dụng**.
- Danh sách mô hình ở cuối mỗi bảng AI hiển thị các gói đăng ký trước, rồi đến các nhà cung cấp dùng khóa mà bạn đã thiết lập xong. Dưới một gói đăng ký, **Mô hình mặc định** là mô hình tiêu chuẩn của gói đó.

## Khóa API (Nâng cao ▸ Mô hình AI)

Dành cho những ai muốn trả tiền trực tiếp cho nhà cung cấp, hoặc muốn chạy mô hình của riêng mình.

- Chọn **Nhà cung cấp**, nhập **Khóa API** của nhà cung cấp đó (và **URL cơ sở** nếu nhà cung cấp cần), chọn **Mô hình**, rồi nhấn **Lưu**. Danh sách gồm các máy chủ tương thích OpenAI, Anthropic, Gemini, DeepSeek, DashScope (qwen), Atlas Cloud và nhiều nhà cung cấp khác.
- Danh sách **Nhà cung cấp** ở đây chỉ quyết định các trường của nhà cung cấp nào hiện trên màn hình. Nó không thay đổi AI đang được dùng; việc đó luôn do **AI sử dụng** quyết định. Khi nhà cung cấp bạn đã lưu không phải AI đang dùng, nút **Dùng AI này** hiện ở phía trên; bấm vào đó để nhà cung cấp ấy trở thành **AI sử dụng**.
- Các cuộc trò chuyện qua nhà cung cấp dùng khóa sẽ dùng khóa của chính bạn, và nhà cung cấp đó tính phí bạn.
- Khóa được lưu trong tệp cài đặt của ứng dụng trên máy này và chỉ được gửi trong phần đầu yêu cầu.
- **Kiểm tra kết nối**: xác minh điểm cuối truy cập được và mô hình hiển thị trước khi lưu.
- URL cơ sở có thể kèm đường dẫn và chuỗi truy vấn (kiểu cổng kết nối); các đường dẫn điểm cuối được nối thêm một cách chính xác.
- Với các máy chủ do bạn tự vận hành, có thể lưu nhiều **điểm cuối** và chuyển đổi giữa chúng bất cứ lúc nào.
- **Tệp thực thi Codex** chỉ dành cho trường hợp chương trình Codex được cài ở một vị trí khác thường. Để trống thì chương trình sẽ được tìm tự động.

## Tính năng nào cần gì

| Tính năng                                       | Chạy bằng gì                                                                                                                                                                                                                                                                                                                                                                                                   |
| ----------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Trò chuyện và chỉnh sửa trong bảng AI           | Gói đăng ký của bạn, hoặc một nhà cung cấp dùng khóa do bạn tự chọn.                                                                                                                                                                                                                                                                                                                                           |
| Hiểu một hình ảnh                               | AI mà bạn đang trò chuyện sẽ tự xem hình ảnh. Không cần thêm khóa nào. Có thể chọn riêng một nhà cung cấp phân tích trong Nâng cao.                                                                                                                                                                                                                                                                            |
| Tạo một hình ảnh                                | **Bằng gói đăng ký Codex đã kết nối.** Nếu bạn chọn một nhà cung cấp hình ảnh trong Nâng cao ▸ Phương tiện AI & Tìm kiếm, nhà cung cấp đó được dùng trước. Khi lựa chọn đó không dùng được, cái nào dùng được trong gói đăng ký Codex và các nhà cung cấp đã thiết lập sẽ thay thế. Nếu không có cả hai, tính năng tạo hình ảnh không dùng được, và Slides sẽ dùng hình ảnh tìm được qua tìm kiếm để thay thế. |
| Phân tích video và âm thanh                     | Một nhà cung cấp dùng khóa có hỗ trợ video, được chọn trong Nâng cao ▸ Phương tiện AI & Tìm kiếm.                                                                                                                                                                                                                                                                                                              |
| Tìm kiếm web và hình ảnh, đọc trang qua địa chỉ | Mặc định miễn phí, không cần khóa. Khóa của nhà cung cấp tìm kiếm là tùy chọn.                                                                                                                                                                                                                                                                                                                                 |
| Tìm kiếm trong các tệp của chính bạn            | Chạy trên máy này. Việc xếp hạng lại kết quả qua một dịch vụ là tùy chọn và mặc định tắt.                                                                                                                                                                                                                                                                                                                      |

Trong **Nâng cao ▸ Phương tiện AI & Tìm kiếm**, khóa và URL cơ sở của một nhà cung cấp chỉ cần nhập một lần và được dùng chung cho mọi tính năng dùng nhà cung cấp đó.

## Thay đổi có hiệu lực khi nào

- Thay đổi mô hình và điểm cuối có hiệu lực ngay lập tức; một cuộc trò chuyện đang diễn ra vẫn dùng cấu hình cũ cho tới lượt kế tiếp của nó.

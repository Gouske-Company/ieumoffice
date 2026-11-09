# Model AI dan pengaturan

## Letak pengaturannya

Buka **Pengaturan** dari baris di kiri bawah Beranda, lalu pilih **AI**. Yang pertama terlihat adalah koneksi langganan. Bagi kebanyakan orang itu sudah cukup, dan ada artikel tersendiri untuknya: [Koneksi langganan](help://subscription).

Semua yang memerlukan kunci ada di bawah **Lanjutan**, di bagian bawah halaman yang sama. Bagian itu tetap tertutup sampai Anda membukanya.

## Bawaan: langganan Anda

- **AI yang digunakan** awalnya diatur ke **Otomatis**: dari langganan yang terhubung, Claude lebih dulu, lalu ChatGPT, lalu Codex.
- Mode Otomatis tidak pernah memilih apa pun yang menimbulkan biaya tambahan. Kunci API hanya dipakai selama Anda sendiri memilih penyedia itu di **AI yang digunakan**.
- Daftar model di bagian bawah setiap panel AI menampilkan langganan lebih dulu, lalu penyedia berbasis kunci yang penyiapannya sudah Anda selesaikan. Di bawah sebuah langganan, **Model bawaan** adalah model standar langganan itu.

## Kunci API (Lanjutan ▸ Model AI)

Untuk yang lebih suka membayar penyedia secara langsung, atau menjalankan model sendiri.

- Pilih **Penyedia**, masukkan **Kunci API**-nya (dan **Base URL** bila penyedia memerlukannya), pilih **Model**, lalu tekan **Simpan**. Daftarnya mencakup server yang kompatibel dengan OpenAI, Anthropic, Gemini, DeepSeek, DashScope (qwen), Atlas Cloud, dan lainnya.
- Daftar **Penyedia** di sini hanya menentukan kolom isian milik siapa yang tampil di layar. Daftar itu tidak mengubah AI mana yang dipakai; hal itu selalu ditentukan oleh **AI yang digunakan**. Jika penyedia yang Anda simpan bukan AI yang sedang dipakai, **Pakai AI ini** muncul di bagian atas; tekan untuk menjadikan penyedia itu **AI yang digunakan**.
- Obrolan lewat penyedia berbasis kunci memakai kunci Anda sendiri, dan penyedia itulah yang menagih Anda.
- Kunci disimpan di berkas pengaturan aplikasi pada mesin ini dan hanya dikirim di header permintaan.
- **Uji koneksi**: memastikan endpoint dapat dijangkau dan model terlihat sebelum disimpan.
- Base URL boleh memuat path dan query string (gaya gateway); path endpoint akan ditambahkan dengan benar.
- Untuk server yang Anda jalankan sendiri, beberapa **endpoint** dapat disimpan dan diganti-ganti kapan saja.
- **Berkas eksekusi Codex** hanya untuk program Codex yang terpasang di lokasi yang tidak biasa. Kosongkan saja, dan program akan ditemukan secara otomatis.

## Fitur mana memerlukan apa

| Fitur                                                 | Berjalan dengan apa                                                                                                                                                                                                                                                                                                                                                                                 |
| ----------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Obrolan dan penyuntingan di panel AI                  | Langganan Anda, atau penyedia berbasis kunci yang Anda pilih sendiri.                                                                                                                                                                                                                                                                                                                               |
| Memahami gambar                                       | AI yang sedang Anda ajak mengobrol melihat gambar itu sendiri. Tidak perlu kunci tambahan. Penyedia analisis terpisah dapat dipilih di bawah Lanjutan.                                                                                                                                                                                                                                              |
| Membuat gambar                                        | **Dengan langganan Codex yang terhubung.** Jika Anda memilih penyedia gambar di Lanjutan ▸ Media & Pencarian AI, penyedia itu dipakai lebih dulu. Jika yang dipilih tidak bisa dipakai, yang bisa dipakai di antara langganan Codex dan penyedia yang sudah disiapkan menggantikannya. Tanpa keduanya, pembuatan gambar tidak tersedia, dan Slides memakai gambar hasil pencarian sebagai gantinya. |
| Analisis video dan audio                              | Penyedia berbasis kunci yang mendukung video, dipilih di Lanjutan ▸ Media & Pencarian AI.                                                                                                                                                                                                                                                                                                           |
| Pencarian web dan gambar, membaca halaman dari alamat | Gratis secara bawaan, tanpa kunci. Kunci penyedia pencarian bersifat opsional.                                                                                                                                                                                                                                                                                                                      |
| Pencarian di dalam file Anda sendiri                  | Berjalan di mesin ini. Mengurutkan ulang hasilnya lewat sebuah layanan bersifat opsional dan nonaktif secara bawaan.                                                                                                                                                                                                                                                                                |

Di **Lanjutan ▸ Media & Pencarian AI**, kunci dan base URL sebuah penyedia cukup diisi sekali dan dipakai bersama oleh setiap fitur yang memakai penyedia itu.

## Kapan perubahan berlaku

- Perubahan model dan endpoint berlaku seketika; percakapan yang sedang berjalan memakai konfigurasi lama sampai putaran berikutnya.

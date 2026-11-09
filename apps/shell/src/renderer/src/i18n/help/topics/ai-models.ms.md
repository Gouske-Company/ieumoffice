# Model AI dan tetapan

## Di mana tetapannya

Buka **Tetapan** daripada baris di penjuru kiri bawah Laman Utama dan pilih **AI**. Perkara pertama yang anda lihat ialah sambungan langganan. Itu sahaja yang diperlukan oleh kebanyakan orang, dan ia mempunyai babnya sendiri: [Sambungan langganan](help://subscription).

Segala yang memerlukan kunci berada di bawah **Lanjutan**, di bahagian bawah halaman yang sama. Ia kekal tertutup sehingga anda membukanya.

## Lalai: langganan anda

- **AI yang digunakan** bermula pada **Automatik**: antara langganan yang disambungkan, Claude dahulu, kemudian ChatGPT, kemudian Codex.
- Automatik tidak pernah memilih apa-apa yang mengenakan kos tambahan. Kunci API digunakan hanya selagi anda sendiri memilih penyedia itu di bawah **AI yang digunakan**.
- Senarai model di bahagian bawah setiap panel AI memaparkan langganan dahulu, kemudian penyedia berasaskan kunci yang telah selesai anda sediakan. Di bawah sesuatu langganan, **Model lalai** ialah model standard bagi langganan itu.

## Kunci API (Lanjutan ▸ Model AI)

Untuk mereka yang lebih suka membayar terus kepada penyedia, atau menjalankan model sendiri.

- Pilih **Penyedia**, masukkan **Kunci API** (dan **Base URL** jika penyedia itu memerlukannya), pilih **Model**, kemudian tekan **Simpan**. Senarai itu merangkumi pelayan yang serasi dengan OpenAI, Anthropic, Gemini, DeepSeek, DashScope (qwen), Atlas Cloud dan lain-lain.
- Senarai **Penyedia** di sini hanya menentukan medan penyedia mana yang dipaparkan pada skrin. Ia tidak mengubah AI yang sedang digunakan; itu sentiasa ditentukan oleh **AI yang digunakan**. Jika penyedia yang anda simpan bukan AI yang sedang digunakan, **Guna AI ini** muncul di bahagian atas; tekan untuk menjadikan penyedia itu **AI yang digunakan**.
- Sembang melalui penyedia berasaskan kunci menggunakan kunci anda sendiri, dan penyedia itu mengenakan caj kepada anda.
- Kunci disimpan dalam fail tetapan aplikasi pada mesin ini dan dihantar hanya dalam pengepala permintaan.
- **Uji sambungan** menyemak ketercapaian titik akhir dan keterlihatan model sebelum disimpan.
- URL asas boleh mengandungi laluan dan rentetan pertanyaan, dan laluan titik akhir ditambah dengan betul.
- Bagi pelayan yang anda jalankan sendiri, beberapa **titik akhir** boleh disimpan dan ditukar ganti pada bila-bila masa.
- **Fail boleh laku Codex** hanya untuk program Codex yang dipasang di tempat yang luar biasa. Biarkan kosong dan program itu ditemui secara automatik.

## Ciri mana memerlukan apa

| Ciri                                                | Apa yang digunakannya                                                                                                                                                                                                                                                                                                                                                                                     |
| --------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Sembang dan penyuntingan dalam panel AI             | Langganan anda, atau penyedia berasaskan kunci yang anda pilih sendiri.                                                                                                                                                                                                                                                                                                                                   |
| Memahami gambar                                     | AI yang sedang bersembang dengan anda melihat gambar itu sendiri. Tiada kunci tambahan diperlukan. Penyedia analisis yang berasingan boleh dipilih di bawah Lanjutan.                                                                                                                                                                                                                                     |
| Menjana gambar                                      | **Dengan langganan Codex yang disambungkan.** Jika anda memilih penyedia imej di bawah Lanjutan ▸ Media & Carian AI, penyedia itu digunakan dahulu. Jika yang dipilih tidak boleh digunakan, yang boleh digunakan antara langganan Codex dan penyedia yang disediakan akan menggantikannya. Tanpa kedua-duanya, penjanaan imej tidak tersedia, dan Slides menggunakan gambar yang ditemui melalui carian. |
| Analisis video dan audio                            | Penyedia berasaskan kunci yang menyokong video, dipilih di bawah Lanjutan ▸ Media & Carian AI.                                                                                                                                                                                                                                                                                                            |
| Carian web dan imej, membaca halaman melalui alamat | Percuma secara lalai, tanpa kunci. Kunci penyedia carian adalah pilihan.                                                                                                                                                                                                                                                                                                                                  |
| Carian dalam fail anda sendiri                      | Berjalan pada mesin ini. Penyusunan semula hasil melalui perkhidmatan adalah pilihan dan dimatikan secara lalai.                                                                                                                                                                                                                                                                                          |

Di bawah **Lanjutan ▸ Media & Carian AI**, kunci dan URL asas sesebuah penyedia dimasukkan sekali sahaja dan dikongsi oleh setiap ciri yang menggunakan penyedia itu.

## Bila perubahan berkuat kuasa

- Perubahan pada model dan titik akhir berkuat kuasa serta-merta. Perbualan yang sedang berjalan akan menggunakan konfigurasi lama sehingga pusingan seterusnya.
